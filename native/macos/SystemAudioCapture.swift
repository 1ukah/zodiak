import CoreAudio
import Foundation
import Dispatch

let discordBundlePrefixes = ["com.hnc.Discord", "com.hnc.DiscordPTB", "com.hnc.DiscordCanary"]

struct CaptureError: Error, CustomStringConvertible {
    let description: String
}

func checkStatus(_ status: OSStatus, _ operation: String) throws {
    guard status == noErr else {
        throw CaptureError(description: "\(operation) failed (\(status))")
    }
}

func propertyAddress(_ selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: scope,
        mElement: kAudioObjectPropertyElementMain
    )
}

func processObjectIDs() throws -> [(AudioObjectID, String, pid_t)] {
    var address = propertyAddress(kAudioHardwarePropertyProcessObjectList)
    var size: UInt32 = 0
    try checkStatus(AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size), "Reading audio processes")
    let count = Int(size) / MemoryLayout<AudioObjectID>.size
    guard count > 0 else { return [] }
    var ids = [AudioObjectID](repeating: kAudioObjectUnknown, count: count)
    try checkStatus(ids.withUnsafeMutableBufferPointer { buffer in
        AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, buffer.baseAddress!)
    }, "Reading audio processes")
    return ids.compactMap { id in
        var bundleAddress = propertyAddress(kAudioProcessPropertyBundleID)
        var bundleID: CFString = "" as CFString
        var bundleSize = UInt32(MemoryLayout<CFString>.size)
        let bundleStatus = withUnsafeMutablePointer(to: &bundleID) { value in
            AudioObjectGetPropertyData(id, &bundleAddress, 0, nil, &bundleSize, value)
        }
        guard bundleStatus == noErr else { return nil }
        var pidAddress = propertyAddress(kAudioProcessPropertyPID)
        var pid: pid_t = 0
        var pidSize = UInt32(MemoryLayout<pid_t>.size)
        let pidStatus = withUnsafeMutablePointer(to: &pid) { value in
            AudioObjectGetPropertyData(id, &pidAddress, 0, nil, &pidSize, value)
        }
        guard pidStatus == noErr else { return nil }
        return (id, bundleID as String, pid)
    }
}

final class PCM16Resampler {
    private let step: Double
    private var position = 0.0
    private var samples: [Float] = []

    init(inputRate: Double) {
        step = inputRate / 48_000.0
    }

    func encode(_ buffers: UnsafeMutableAudioBufferListPointer, frameCount: Int) -> Data {
        guard frameCount > 0, buffers.count > 0 else { return Data() }
        let first = buffers[0]
        guard let firstData = first.mData else { return Data() }
        let channelCount = Int(first.mNumberChannels)
        if channelCount >= 2 {
            let raw = UnsafeRawPointer(firstData)
            for frame in 0..<frameCount {
                samples.append(raw.loadUnaligned(fromByteOffset: frame * channelCount * MemoryLayout<Float>.size, as: Float.self))
                samples.append(raw.loadUnaligned(fromByteOffset: (frame * channelCount + 1) * MemoryLayout<Float>.size, as: Float.self))
            }
        } else if buffers.count >= 2, let secondData = buffers[1].mData {
            let left = UnsafeRawPointer(firstData)
            let right = UnsafeRawPointer(secondData)
            for frame in 0..<frameCount {
                samples.append(left.loadUnaligned(fromByteOffset: frame * MemoryLayout<Float>.size, as: Float.self))
                samples.append(right.loadUnaligned(fromByteOffset: frame * MemoryLayout<Float>.size, as: Float.self))
            }
        } else {
            return Data()
        }

        let availableFrames = samples.count / 2
        var output = Data()
        while position + 1 < Double(availableFrames) {
            let lower = Int(position)
            let fraction = Float(position - Double(lower))
            for channel in 0..<2 {
                let firstSample = samples[lower * 2 + channel]
                let secondSample = samples[(lower + 1) * 2 + channel]
                let value = max(-1.0, min(1.0, firstSample + (secondSample - firstSample) * fraction))
                var sample = Int16((value * 32767.0).rounded()).littleEndian
                withUnsafeBytes(of: &sample) { output.append(contentsOf: $0) }
            }
            position += step
        }

        let discardedFrames = min(max(Int(position), 0), availableFrames - 1)
        if discardedFrames > 0 {
            samples.removeFirst(discardedFrames * 2)
            position -= Double(discardedFrames)
        }
        return output
    }
}

final class SystemAudioCapture {
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var ioProcID: AudioDeviceIOProcID?
    private var converter: PCM16Resampler?
    private let ioQueue = DispatchQueue(label: "app.sharescreen.audio.capture")

    func start() throws -> String {
        let processes = try processObjectIDs()
        let excluded = processes.filter { item in
            discordBundlePrefixes.contains { item.1 == $0 || item.1.hasPrefix($0 + ".") }
        }
        if !excluded.isEmpty {
            do {
                try start(excluding: excluded.map(\.0))
                return "exclude " + excluded.map { String($0.2) }.joined(separator: ",")
            } catch {
                stop()
                fputs("note exclude failed \(error)\n", stderr)
            }
        }
        try start(excluding: [])
        return "system"
    }

    private func start(excluding processIDs: [AudioObjectID]) throws {
        do {
            let description = CATapDescription(stereoGlobalTapButExcludeProcesses: processIDs)
            description.name = "Welfare Office System Audio"
            description.isPrivate = true
            description.muteBehavior = CATapMuteBehavior(rawValue: 0)!
            try checkStatus(AudioHardwareCreateProcessTap(description, &tapID), "Creating system audio tap")

            var tapAddress = propertyAddress(kAudioTapPropertyUID)
            var tapUID: CFString = "" as CFString
            var tapSize = UInt32(MemoryLayout<CFString>.size)
            try checkStatus(withUnsafeMutablePointer(to: &tapUID) { value in
                AudioObjectGetPropertyData(tapID, &tapAddress, 0, nil, &tapSize, value)
            }, "Reading system audio tap")

            let aggregateDescription: [String: Any] = [
                kAudioAggregateDeviceNameKey: "Welfare Office System Audio",
                kAudioAggregateDeviceUIDKey: UUID().uuidString,
                kAudioAggregateDeviceIsPrivateKey: 1,
                kAudioAggregateDeviceIsStackedKey: 0,
                kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: tapUID]],
                kAudioAggregateDeviceTapAutoStartKey: 1,
            ]
            try checkStatus(AudioHardwareCreateAggregateDevice(aggregateDescription as CFDictionary, &aggregateID), "Creating system audio device")

            var formatAddress = propertyAddress(kAudioDevicePropertyStreamFormat, scope: kAudioDevicePropertyScopeInput)
            var format = AudioStreamBasicDescription()
            var formatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
            try checkStatus(AudioObjectGetPropertyData(aggregateID, &formatAddress, 0, nil, &formatSize, &format), "Reading system audio format")
            guard format.mChannelsPerFrame >= 2,
                  format.mBitsPerChannel == 32,
                  format.mFormatFlags & kAudioFormatFlagIsFloat != 0,
                  format.mSampleRate > 0 else {
                throw CaptureError(description: "Unsupported system audio format")
            }
            converter = PCM16Resampler(inputRate: format.mSampleRate)

            try checkStatus(AudioDeviceCreateIOProcIDWithBlock(&ioProcID, aggregateID, ioQueue) { _, inputData, _, _, _ in
                guard let converter = self.converter else { return }
                let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inputData))
                let channels = Int(buffers.first?.mNumberChannels ?? 0)
                let bytesPerFrame = channels * MemoryLayout<Float>.size
                guard bytesPerFrame > 0, let firstBuffer = buffers.first else { return }
                let frames = Int(firstBuffer.mDataByteSize) / bytesPerFrame
                let data = converter.encode(buffers, frameCount: frames)
                if !data.isEmpty {
                    FileHandle.standardOutput.write(data)
                }
            }, "Creating audio capture callback")
            try checkStatus(AudioDeviceStart(aggregateID, ioProcID), "Starting system audio capture")
        } catch {
            stop()
            throw error
        }
    }

    func stop() {
        if aggregateID != kAudioObjectUnknown, let ioProcID {
            AudioDeviceStop(aggregateID, ioProcID)
            AudioDeviceDestroyIOProcID(aggregateID, ioProcID)
        }
        ioProcID = nil
        converter = nil
        if aggregateID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = kAudioObjectUnknown
        }
        if tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = kAudioObjectUnknown
        }
    }
}

let capture = SystemAudioCapture()
do {
    let mode = try capture.start()
    fputs("ready \(mode)\n", stderr)
    fflush(stderr)
    dispatchMain()
} catch {
    fputs("error \(error)\n", stderr)
    exit(EXIT_FAILURE)
}
