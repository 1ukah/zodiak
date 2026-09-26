package audio

import (
	"encoding/binary"
	"errors"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

type guid struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

type waveFormatEx struct {
	FormatTag      uint16
	Channels       uint16
	SamplesPerSec  uint32
	AvgBytesPerSec uint32
	BlockAlign     uint16
	BitsPerSample  uint16
	Size           uint16
}

const (
	clsctxAll     = 23
	eRender       = 0
	eConsole      = 0
	shareShared   = 0
	loopbackFlags = 0x00020000 | 0x00040000 | 0x80000000
	silentFlag    = 2
	coinitMTA     = 0
)

var (
	ole32    = windows.NewLazySystemDLL("ole32.dll")
	mmdevapi = windows.NewLazySystemDLL("mmdevapi.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procCoCreateInstance            = ole32.NewProc("CoCreateInstance")
	procCoInitializeEx              = ole32.NewProc("CoInitializeEx")
	procActivateAudioInterfaceAsync = mmdevapi.NewProc("ActivateAudioInterfaceAsync")
	procCreateEventW                = kernel32.NewProc("CreateEventW")
	procSetEvent                    = kernel32.NewProc("SetEvent")
	procWaitForSingleObject         = kernel32.NewProc("WaitForSingleObject")
	procCloseHandle                 = kernel32.NewProc("CloseHandle")
	procLocalAlloc                  = kernel32.NewProc("LocalAlloc")
	procLocalFree                   = kernel32.NewProc("LocalFree")

	clsidEnumerator = guid{0xBCDE0395, 0xE52F, 0x467C, [8]byte{0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E}}
	iidEnumerator   = guid{0xA95664D2, 0x9614, 0x4F35, [8]byte{0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x17, 0xE6}}
	iidDevice       = guid{0xD666063F, 0x1587, 0x4E43, [8]byte{0x81, 0xF1, 0xB9, 0x48, 0xE8, 0x07, 0x36, 0x3F}}
	iidAudioClient  = guid{0x1CB9AD4C, 0xDBFA, 0x4C32, [8]byte{0xB1, 0x78, 0xC2, 0xF5, 0x68, 0xA7, 0x03, 0xB2}}
	iidCapture      = guid{0xC8ADBD64, 0xE71E, 0x48A0, [8]byte{0xA4, 0xDE, 0x18, 0x5C, 0x39, 0x5C, 0xD3, 0x17}}
	iidRender       = guid{0xF294ACFC, 0x3146, 0x4483, [8]byte{0xA7, 0xBF, 0xAD, 0xDC, 0xA7, 0xC2, 0x60, 0xE2}}
	iidUnknown      = guid{0x00000000, 0x0000, 0x0000, [8]byte{0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}}
	iidAgile        = guid{0x94EA2B94, 0xE9CC, 0x49E0, [8]byte{0xC0, 0xFF, 0xEE, 0x64, 0xCA, 0x8F, 0x5B, 0x90}}
	iidActivate     = guid{0x41D949AB, 0x9862, 0x444A, [8]byte{0x80, 0xF6, 0xC2, 0x61, 0x33, 0x4D, 0xA5, 0xEB}}
	iidAsyncOp      = guid{0x72A22D78, 0xCDE4, 0x431D, [8]byte{0xB8, 0xCC, 0x84, 0x3A, 0x71, 0x19, 0x9B, 0x6D}}
)

func CoInit() {
	procCoInitializeEx.Call(0, coinitMTA)
}

func vt(obj uintptr, idx int) uintptr {
	return *(*uintptr)(unsafe.Pointer(*(*uintptr)(unsafe.Pointer(obj)) + uintptr(idx)*unsafe.Sizeof(uintptr(0))))
}

func call(obj uintptr, idx int, args ...uintptr) uintptr {
	full := append([]uintptr{obj}, args...)
	r, _, _ := syscall.SyscallN(vt(obj, idx), full...)
	return r
}

func release(obj uintptr) {
	if obj != 0 {
		call(obj, 2)
	}
}

func pcmFormat() waveFormatEx {
	return waveFormatEx{
		FormatTag:      1,
		Channels:       2,
		SamplesPerSec:  48000,
		AvgBytesPerSec: 192000,
		BlockAlign:     4,
		BitsPerSample:  16,
	}
}

type Capture struct {
	client  uintptr
	capture uintptr
	event   windows.Handle
	stop    chan struct{}
	once    sync.Once
	// Read must finish before Close releases the COM interfaces. Releasing an
	// IAudioCaptureClient while another goroutine is inside GetBuffer or
	// ReleaseBuffer can otherwise cause an access violation in audioses.dll.
	readMu sync.Mutex
}

func OpenLoopback() (*Capture, string, error) {
	CoInit()
	mode := "system"
	pid := discordPID()
	var client uintptr
	if pid != 0 {
		if c, err := activateExclude(pid); err == nil {
			client = c
			mode = "exclude"
		}
	}
	if client == 0 {
		c, err := activateSystem()
		if err != nil {
			return nil, "", err
		}
		client = c
	}
	format := pcmFormat()
	hr := call(client, 3, shareShared, loopbackFlags, 0, 0, uintptr(unsafe.Pointer(&format)), 0)
	if hr != 0 {
		release(client)
		return nil, "", errors.New("system audio did not start")
	}
	ev, _, err := procCreateEventW.Call(0, 0, 0, 0)
	if ev == 0 {
		release(client)
		return nil, "", err
	}
	if call(client, 13, ev) != 0 {
		procCloseHandle.Call(ev)
		release(client)
		return nil, "", errors.New("system audio did not start")
	}
	var cap uintptr
	if call(client, 14, uintptr(unsafe.Pointer(&iidCapture)), uintptr(unsafe.Pointer(&cap))) != 0 || cap == 0 {
		procCloseHandle.Call(ev)
		release(client)
		return nil, "", errors.New("system audio did not start")
	}
	if call(client, 10) != 0 {
		release(cap)
		procCloseHandle.Call(ev)
		release(client)
		return nil, "", errors.New("system audio did not start")
	}
	return &Capture{client: client, capture: cap, event: windows.Handle(ev), stop: make(chan struct{})}, mode, nil
}

func (c *Capture) Close() {
	c.once.Do(func() {
		close(c.stop)
		if c.event != 0 {
			// Wake a Read that is waiting for the next packet before waiting for
			// it to leave the COM call path.
			procSetEvent.Call(uintptr(c.event))
		}
		c.readMu.Lock()
		defer c.readMu.Unlock()
		if c.client != 0 {
			call(c.client, 11)
		}
		release(c.capture)
		release(c.client)
		c.capture = 0
		c.client = 0
		if c.event != 0 {
			procCloseHandle.Call(uintptr(c.event))
			c.event = 0
		}
	})
}

func (c *Capture) Read() ([]int16, error) {
	c.readMu.Lock()
	defer c.readMu.Unlock()
	if c.capture == 0 || c.event == 0 {
		return nil, errors.New("system audio capture is closed")
	}
	for {
		select {
		case <-c.stop:
			return nil, errors.New("stopped")
		default:
		}
		procWaitForSingleObject.Call(uintptr(c.event), 200)
		for {
			var frames uint32
			if call(c.capture, 5, uintptr(unsafe.Pointer(&frames))) != 0 {
				return nil, errors.New("system audio capture failed")
			}
			if frames == 0 {
				break
			}
			var data uintptr
			var packet uint32
			var flags uint32
			var dev, qpc uint64
			if call(c.capture, 3, uintptr(unsafe.Pointer(&data)), uintptr(unsafe.Pointer(&packet)), uintptr(unsafe.Pointer(&flags)), uintptr(unsafe.Pointer(&dev)), uintptr(unsafe.Pointer(&qpc))) != 0 {
				return nil, errors.New("system audio capture failed")
			}
			n := int(packet) * 2
			out := make([]int16, n)
			if flags&silentFlag == 0 && data != 0 {
				bytes := unsafe.Slice((*byte)(unsafe.Pointer(data)), n*2)
				for i := 0; i < n; i++ {
					out[i] = int16(binary.LittleEndian.Uint16(bytes[i*2:]))
				}
			}
			call(c.capture, 4, uintptr(packet))
			if n > 0 {
				return out, nil
			}
		}
	}
}

func activateSystem() (uintptr, error) {
	var enum uintptr
	r, _, _ := procCoCreateInstance.Call(
		uintptr(unsafe.Pointer(&clsidEnumerator)),
		0,
		uintptr(clsctxAll),
		uintptr(unsafe.Pointer(&iidEnumerator)),
		uintptr(unsafe.Pointer(&enum)),
	)
	if r != 0 || enum == 0 {
		return 0, errors.New("system audio capture failed")
	}
	defer release(enum)
	var device uintptr
	if call(enum, 4, eRender, eConsole, uintptr(unsafe.Pointer(&device))) != 0 || device == 0 {
		return 0, errors.New("system audio capture failed")
	}
	defer release(device)
	var client uintptr
	if call(device, 3, uintptr(unsafe.Pointer(&iidAudioClient)), clsctxAll, 0, uintptr(unsafe.Pointer(&client))) != 0 || client == 0 {
		return 0, errors.New("system audio capture failed")
	}
	return client, nil
}
