using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Runtime.InteropServices;

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject
{
}

[ComImport]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator
{
    [PreserveSig]
    int EnumAudioEndpoints(int dataFlow, uint stateMask, out IntPtr devices);

    [PreserveSig]
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}

[ComImport]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice
{
    [PreserveSig]
    int Activate(ref Guid iid, uint classContext, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
}

[ComImport]
[Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioClient
{
    [PreserveSig]
    int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, ref WaveFormatEx format, IntPtr sessionGuid);

    [PreserveSig]
    int GetBufferSize(out uint frameCount);

    [PreserveSig]
    int GetStreamLatency(out long latency);

    [PreserveSig]
    int GetCurrentPadding(out uint padding);

    [PreserveSig]
    int IsFormatSupported(int shareMode, ref WaveFormatEx format, IntPtr closest);

    [PreserveSig]
    int GetMixFormat(out IntPtr deviceFormat);

    [PreserveSig]
    int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);

    [PreserveSig]
    int Start();

    [PreserveSig]
    int Stop();

    [PreserveSig]
    int Reset();

    [PreserveSig]
    int SetEventHandle(IntPtr eventHandle);

    [PreserveSig]
    int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
}

[ComImport]
[Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioCaptureClient
{
    [PreserveSig]
    int GetBuffer(out IntPtr data, out uint frameCount, out uint flags, out ulong devicePosition, out ulong qpcPosition);

    [PreserveSig]
    int ReleaseBuffer(uint frameCount);

    [PreserveSig]
    int GetNextPacketSize(out uint frameCount);
}

[ComImport]
[Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IActivateAudioInterfaceAsyncOperation
{
    [PreserveSig]
    int GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
}

[ComImport]
[Guid("41D949AB-9862-444A-80F6-C261334DA5EB")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IActivateAudioInterfaceCompletionHandler
{
    [PreserveSig]
    int ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation);
}

[ComImport]
[Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAgileObject
{
}

[StructLayout(LayoutKind.Sequential, Pack = 1)]
struct WaveFormatEx
{
    public ushort wFormatTag;
    public ushort nChannels;
    public uint nSamplesPerSec;
    public uint nAvgBytesPerSec;
    public ushort nBlockAlign;
    public ushort wBitsPerSample;
    public ushort cbSize;
}

[StructLayout(LayoutKind.Sequential)]
struct AudioClientActivationParams
{
    public int ActivationType;
    public uint TargetProcessId;
    public int ProcessLoopbackMode;
}

[StructLayout(LayoutKind.Sequential)]
struct PropVariantBlob
{
    public uint cbSize;
    public IntPtr pBlobData;
}

[StructLayout(LayoutKind.Sequential)]
struct PropVariant
{
    public ushort vt;
    public ushort reserved1;
    public ushort reserved2;
    public ushort reserved3;
    public PropVariantBlob blob;
}

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
struct ProcessEntry32
{
    public uint dwSize;
    public uint cntUsage;
    public uint th32ProcessID;
    public IntPtr th32DefaultHeapID;
    public uint th32ModuleID;
    public uint cntThreads;
    public uint th32ParentProcessID;
    public int pcPriClassBase;
    public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
    public string szExeFile;
}

[ComVisible(true)]
[ClassInterface(ClassInterfaceType.None)]
sealed class AudioActivationHandler : IActivateAudioInterfaceCompletionHandler, IAgileObject
{
    public int Result = unchecked((int)0x80004005);
    public IAudioClient Client;
    public readonly System.Threading.ManualResetEvent Done = new System.Threading.ManualResetEvent(false);

    public int ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation)
    {
        try
        {
            int hr;
            object activated;
            int call = operation.GetActivateResult(out hr, out activated);
            if (call < 0)
            {
                Result = call;
            }
            else
            {
                Result = hr;
                Client = activated as IAudioClient;
                if (hr >= 0 && Client == null) Result = unchecked((int)0x80004002);
            }
        }
        catch (Exception)
        {
            Result = unchecked((int)0x80004005);
        }
        Done.Set();
        return 0;
    }
}

public static class SystemAudioCapture
{
    const uint LoopbackFlags = 0x00020000u | 0x00040000u | 0x80000000u;
    const uint SilentFlag = 2;

    static IAudioCaptureClient captureClient;
    static IntPtr sampleEvent;
    static byte[] packetBytes = new byte[0];
    static byte[] silentBytes = new byte[0];

    [DllImport("ole32.dll")]
    static extern int CoInitializeEx(IntPtr reserved, uint coinit);

    [DllImport("mmdevapi.dll", ExactSpelling = true, PreserveSig = true)]
    static extern int ActivateAudioInterfaceAsync(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
        ref Guid riid,
        IntPtr activationParams,
        IActivateAudioInterfaceCompletionHandler completionHandler,
        out IActivateAudioInterfaceAsyncOperation operation);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateEvent(IntPtr attributes, bool manualReset, bool initialState, IntPtr name);

    [DllImport("kernel32.dll")]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool Process32First(IntPtr snapshot, ref ProcessEntry32 entry);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry32 entry);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);

    [MTAThread]
    public static int Main()
    {
        CoInitializeEx(IntPtr.Zero, 0);
        try
        {
            string mode;
            IAudioClient client = OpenClient(out mode);
            if (client == null)
            {
                Console.Error.WriteLine("error System audio capture failed");
                return 1;
            }
            int hr = Prepare(client);
            if (hr < 0)
            {
                Console.Error.WriteLine("error System audio capture failed (" + hr.ToString("X8") + ")");
                return 1;
            }
            Console.Error.WriteLine("ready " + mode);
            Console.Error.Flush();
            hr = client.Start();
            if (hr < 0)
            {
                Console.Error.WriteLine("error System audio capture failed (" + hr.ToString("X8") + ")");
                return 1;
            }
            return Pump();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("error " + ex.Message);
            return 1;
        }
    }

    static IAudioClient OpenClient(out string mode)
    {
        mode = "system";
        uint pid = FindDiscordPid();
        if (pid != 0)
        {
            int activateHr;
            IAudioClient excluded = ActivateExclude(pid, out activateHr);
            if (excluded != null)
            {
                mode = "exclude " + pid.ToString();
                return excluded;
            }
            Console.Error.WriteLine("note exclude failed " + pid.ToString() + " " + activateHr.ToString("X8"));
        }
        return ActivateSystem();
    }

    static IAudioClient ActivateExclude(uint pid, out int activateHr)
    {
        activateHr = unchecked((int)0x80004005);
        AudioClientActivationParams activation = new AudioClientActivationParams();
        activation.ActivationType = 1;
        activation.TargetProcessId = pid;
        activation.ProcessLoopbackMode = 1;
        int size = Marshal.SizeOf(typeof(AudioClientActivationParams));
        IntPtr blob = Marshal.AllocCoTaskMem(size);
        Marshal.StructureToPtr(activation, blob, false);
        PropVariant prop = new PropVariant();
        prop.vt = 65;
        prop.blob.cbSize = (uint)size;
        prop.blob.pBlobData = blob;
        IntPtr variant = Marshal.AllocCoTaskMem(Marshal.SizeOf(typeof(PropVariant)));
        Marshal.StructureToPtr(prop, variant, false);
        AudioActivationHandler handler = new AudioActivationHandler();
        Guid iid = typeof(IAudioClient).GUID;
        IActivateAudioInterfaceAsyncOperation operation;
        activateHr = ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iid, variant, handler, out operation);
        if (activateHr < 0)
        {
            Marshal.FreeCoTaskMem(variant);
            Marshal.FreeCoTaskMem(blob);
            return null;
        }
        if (!handler.Done.WaitOne(8000))
        {
            activateHr = unchecked((int)0x80004005);
            return null;
        }
        GC.KeepAlive(operation);
        GC.KeepAlive(handler);
        Marshal.FreeCoTaskMem(variant);
        Marshal.FreeCoTaskMem(blob);
        activateHr = handler.Result;
        if (handler.Result < 0 || handler.Client == null) return null;
        return handler.Client;
    }

    static IAudioClient ActivateSystem()
    {
        IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        IMMDevice device;
        int hr = enumerator.GetDefaultAudioEndpoint(0, 0, out device);
        if (hr < 0) return null;
        Guid iid = typeof(IAudioClient).GUID;
        object activated;
        hr = device.Activate(ref iid, 23, IntPtr.Zero, out activated);
        if (hr < 0) return null;
        return activated as IAudioClient;
    }

    static int Prepare(IAudioClient client)
    {
        WaveFormatEx format = new WaveFormatEx();
        format.wFormatTag = 1;
        format.nChannels = 2;
        format.nSamplesPerSec = 48000;
        format.wBitsPerSample = 16;
        format.nBlockAlign = 4;
        format.nAvgBytesPerSec = 192000;
        format.cbSize = 0;
        int hr = client.Initialize(0, LoopbackFlags, 0, 0, ref format, IntPtr.Zero);
        if (hr < 0) return hr;
        sampleEvent = CreateEvent(IntPtr.Zero, false, false, IntPtr.Zero);
        if (sampleEvent == IntPtr.Zero) return Marshal.GetHRForLastWin32Error();
        hr = client.SetEventHandle(sampleEvent);
        if (hr < 0) return hr;
        Guid iid = typeof(IAudioCaptureClient).GUID;
        object service;
        hr = client.GetService(ref iid, out service);
        if (hr < 0) return hr;
        captureClient = service as IAudioCaptureClient;
        if (captureClient == null) return unchecked((int)0x80004002);
        return 0;
    }

    static int Pump()
    {
        Stream stdout = Console.OpenStandardOutput();
        while (true)
        {
            WaitForSingleObject(sampleEvent, 200);
            while (true)
            {
                uint frames;
                int hr = captureClient.GetNextPacketSize(out frames);
                if (hr < 0) return Fail(hr);
                if (frames == 0) break;
                IntPtr data;
                uint packetFrames;
                uint flags;
                ulong devicePosition;
                ulong qpcPosition;
                hr = captureClient.GetBuffer(out data, out packetFrames, out flags, out devicePosition, out qpcPosition);
                if (hr < 0) return Fail(hr);
                int bytes = checked((int)packetFrames * 4);
                if ((flags & SilentFlag) != 0 || data == IntPtr.Zero)
                {
                    if (silentBytes.Length < bytes) silentBytes = new byte[bytes];
                    stdout.Write(silentBytes, 0, bytes);
                }
                else
                {
                    if (packetBytes.Length < bytes) packetBytes = new byte[bytes];
                    Marshal.Copy(data, packetBytes, 0, bytes);
                    stdout.Write(packetBytes, 0, bytes);
                }
                hr = captureClient.ReleaseBuffer(packetFrames);
                if (hr < 0) return Fail(hr);
            }
            stdout.Flush();
        }
    }

    static int Fail(int hr)
    {
        Console.Error.WriteLine("error System audio capture failed (" + hr.ToString("X8") + ")");
        return 1;
    }

    static uint FindDiscordPid()
    {
        Process[] processes = Process.GetProcessesByName("Discord");
        if (processes.Length == 0) return 0;
        Dictionary<int, int> parents = LoadParents();
        Dictionary<int, bool> discordIds = new Dictionary<int, bool>();
        for (int i = 0; i < processes.Length; i++) discordIds[processes[i].Id] = true;
        uint bestPid = 0;
        long bestScore = long.MinValue;
        for (int i = 0; i < processes.Length; i++)
        {
            Process process = processes[i];
            try
            {
                if (IsRenderer(process.Id)) continue;
                int parent;
                if (parents.TryGetValue(process.Id, out parent) && discordIds.ContainsKey(parent)) continue;
                long score = 0;
                try { score += process.WorkingSet64; } catch (Exception) { }
                if (process.MainWindowHandle != IntPtr.Zero) score += 1L << 62;
                if (ImagePath(process).IndexOf("\\app-", StringComparison.OrdinalIgnoreCase) >= 0) score += 1L << 61;
                if (score > bestScore)
                {
                    bestScore = score;
                    bestPid = (uint)process.Id;
                }
            }
            catch (Exception)
            {
            }
            finally
            {
                process.Dispose();
            }
        }
        return bestPid;
    }

    static bool IsRenderer(int pid)
    {
        string command = CommandLine(pid);
        return command.IndexOf("--type=", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    static string CommandLine(int pid)
    {
        try
        {
            using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE ProcessId = " + pid.ToString()))
            using (ManagementObjectCollection results = searcher.Get())
            {
                foreach (ManagementObject item in results)
                {
                    using (item)
                    {
                        object value = item["CommandLine"];
                        if (value == null) return "";
                        return value.ToString();
                    }
                }
            }
        }
        catch (Exception)
        {
        }
        return "";
    }

    static string ImagePath(Process process)
    {
        try
        {
            ProcessModule module = process.MainModule;
            if (module == null || module.FileName == null) return "";
            return module.FileName;
        }
        catch (Exception)
        {
            return "";
        }
    }

    static Dictionary<int, int> LoadParents()
    {
        Dictionary<int, int> map = new Dictionary<int, int>();
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1)) return map;
        try
        {
            ProcessEntry32 entry = new ProcessEntry32();
            entry.dwSize = (uint)Marshal.SizeOf(typeof(ProcessEntry32));
            if (!Process32First(snapshot, ref entry)) return map;
            do
            {
                map[(int)entry.th32ProcessID] = (int)entry.th32ParentProcessID;
                entry.dwSize = (uint)Marshal.SizeOf(typeof(ProcessEntry32));
            }
            while (Process32Next(snapshot, ref entry));
        }
        finally
        {
            CloseHandle(snapshot);
        }
        return map;
    }
}
