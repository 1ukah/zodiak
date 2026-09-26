package encode

import (
	"errors"
	"fmt"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

type Encoder struct {
	mu      sync.Mutex
	mft     uintptr
	inType  uintptr
	outType uintptr
	width   int
	height  int
	fps     int
	bitrate int
	matrix  uint32
	pts     int64
	nv12    []byte
}

type Decoder struct {
	mu     sync.Mutex
	mft    uintptr
	width  int
	height int
	stride int
	matrix uint32
	inited bool
}

const (
	mfVideoTransferMatrixBT709 uint32 = 1
	mfVideoTransferMatrixBT601 uint32 = 2
)

var (
	mfStartOnce              sync.Once
	mfStartErr               error
	mfplat                   = windows.NewLazySystemDLL("mfplat.dll")
	mf                       = windows.NewLazySystemDLL("mf.dll")
	ole32                    = windows.NewLazySystemDLL("ole32.dll")
	procMFStartup            = mfplat.NewProc("MFStartup")
	procMFShutdown           = mfplat.NewProc("MFShutdown")
	procMFCreateMediaType    = mfplat.NewProc("MFCreateMediaType")
	procMFCreateMemoryBuffer = mfplat.NewProc("MFCreateMemoryBuffer")
	procMFCreateSample       = mfplat.NewProc("MFCreateSample")
	procMFTEnum              = mfplat.NewProc("MFTEnum")
	procCoCreateInstance     = ole32.NewProc("CoCreateInstance")
	procCoInitializeEx       = ole32.NewProc("CoInitializeEx")
	procCoTaskMemFree        = ole32.NewProc("CoTaskMemFree")
)

const (
	mfVersion = 0x00020070
)

func Align(width, height int) (int, int) {
	width &^= 1
	height &^= 1
	if width < 2 {
		width = 2
	}
	if height < 2 {
		height = 2
	}
	return width, height
}

func CoInit() {
	procCoInitializeEx.Call(0, 0)
}

func Startup() error {
	CoInit()
	mfStartOnce.Do(func() {
		r, _, _ := procMFStartup.Call(uintptr(mfVersion), 0)
		if r != 0 {
			mfStartErr = errors.New("Media Foundation did not start")
		}
	})
	return mfStartErr
}

func Shutdown() {
	procMFShutdown.Call()
}

func NewEncoder(width, height, fps, bitrate int) (*Encoder, error) {
	if err := Startup(); err != nil {
		return nil, err
	}
	if fps <= 0 {
		fps = 30
	}
	if bitrate <= 0 {
		bitrate = 6_000_000
	}
	width, height = Align(width, height)
	e := &Encoder{
		width: width, height: height, fps: fps, bitrate: bitrate,
		matrix: matrixForHeight(height), nv12: make([]byte, width*height*3/2),
	}
	if err := e.open(); err != nil {
		e.Close()
		return nil, err
	}
	return e, nil
}

func (e *Encoder) Close() {
	e.mu.Lock()
	defer e.mu.Unlock()
	release(e.mft)
	release(e.inType)
	release(e.outType)
	e.mft = 0
}

func (e *Encoder) Encode(bgra []byte) ([]byte, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.mft == 0 {
		return nil, errors.New("encoder is closed")
	}
	if len(bgra) < e.width*e.height*4 {
		return nil, errors.New("frame is too small")
	}
	bgraToNV12Matrix(bgra, e.nv12, e.width, e.height, e.matrix)
	dur := int64(10_000_000 / e.fps)
	if dur < 1 {
		dur = 1
	}
	sample, err := createSample(e.nv12, e.pts, dur)
	if err != nil {
		return nil, err
	}
	e.pts += dur
	defer release(sample)
	if err := processInput(e.mft, sample); err != nil {
		return nil, err
	}
	return processOutput(e.mft)
}

func NewDecoder(width, height int) (*Decoder, error) {
	if err := Startup(); err != nil {
		return nil, err
	}
	if width <= 0 || height <= 0 {
		width, height = 1920, 1080
	}
	width, height = Align(width, height)
	d := &Decoder{width: width, height: height, stride: width, matrix: matrixForHeight(height)}
	if err := d.open(); err != nil {
		d.Close()
		return nil, err
	}
	return d, nil
}

func (d *Decoder) Close() {
	d.mu.Lock()
	defer d.mu.Unlock()
	release(d.mft)
	d.mft = 0
}

func (d *Decoder) Decode(annexB []byte) (bgra []byte, width, height int, err error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.mft == 0 {
		return nil, 0, 0, errors.New("decoder is closed")
	}
	if len(annexB) == 0 {
		return nil, d.width, d.height, nil
	}
	sample, err := createSample(annexB, 0, 0)
	if err != nil {
		return nil, 0, 0, err
	}
	defer release(sample)
	if err := processInput(d.mft, sample); err != nil {
		return nil, 0, 0, err
	}
	raw, err := processOutput(d.mft)
	if err != nil || len(raw) == 0 {
		return nil, d.width, d.height, err
	}
	if d.width == 0 || d.height == 0 {
		d.width, d.height = guessSize(len(raw))
	}
	if d.width == 0 || d.height == 0 {
		return nil, 0, 0, nil
	}
	stride := d.stride
	rows := d.height + d.height/2
	if rows > 0 && len(raw)%rows == 0 {
		candidate := len(raw) / rows
		if candidate >= d.width && candidate%2 == 0 {
			stride = candidate
		}
	}
	bgra = nv12ToBGRAWithStride(raw, d.width, d.height, stride, d.matrix)
	if len(bgra) == 0 {
		return nil, 0, 0, errors.New("decoder returned an incomplete NV12 frame")
	}
	return bgra, d.width, d.height, nil
}

func (d *Decoder) SetSize(width, height int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.width = width
	d.height = height
	d.stride = width
	d.matrix = matrixForHeight(height)
}

func guessSize(n int) (int, int) {
	pixels := n * 2 / 3
	for _, h := range []int{2160, 1440, 1080, 720, 480} {
		for _, w := range []int{3840, 2560, 1920, 1280, 854, 848} {
			if w*h == pixels {
				return w, h
			}
		}
	}
	return 0, 0
}

func bgraToNV12(bgra, nv12 []byte, w, h int) {
	bgraToNV12Matrix(bgra, nv12, w, h, mfVideoTransferMatrixBT601)
}

func bgraToNV12Matrix(bgra, nv12 []byte, w, h int, matrix uint32) {
	if w <= 0 || h <= 0 || w%2 != 0 || h%2 != 0 || len(bgra) < w*h*4 || len(nv12) < w*h*3/2 {
		return
	}
	yPlane := nv12[:w*h]
	uv := nv12[w*h : w*h*3/2]
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			i := (y*w + x) * 4
			b := int(bgra[i])
			g := int(bgra[i+1])
			r := int(bgra[i+2])
			value := ((66*r + 129*g + 25*b + 128) >> 8) + 16
			if matrix == mfVideoTransferMatrixBT709 {
				value = ((47*r + 157*g + 16*b + 128) >> 8) + 16
			}
			yPlane[y*w+x] = clampByte(value)
		}
	}

	// NV12 stores one U/V pair for every 2x2 luma block. Average all four
	// pixels so ClearType's red/blue subpixels do not become shifted color halos.
	for y := 0; y < h; y += 2 {
		for x := 0; x < w; x += 2 {
			var uSum, vSum int
			for dy := 0; dy < 2; dy++ {
				for dx := 0; dx < 2; dx++ {
					i := ((y+dy)*w + x + dx) * 4
					b := int(bgra[i])
					g := int(bgra[i+1])
					r := int(bgra[i+2])
					if matrix == mfVideoTransferMatrixBT709 {
						uSum += -26*r - 87*g + 112*b
						vSum += 112*r - 102*g - 10*b
					} else {
						uSum += -38*r - 74*g + 112*b
						vSum += 112*r - 94*g - 18*b
					}
				}
			}
			u := ((uSum + 512) >> 10) + 128
			v := ((vSum + 512) >> 10) + 128
			i := (y/2)*w + x
			uv[i] = clampByte(u)
			uv[i+1] = clampByte(v)
		}
	}
}

func nv12ToBGRA(nv12 []byte, w, h int) []byte {
	return nv12ToBGRAWithStride(nv12, w, h, w, mfVideoTransferMatrixBT601)
}

func nv12ToBGRAWithStride(nv12 []byte, w, h, stride int, matrix uint32) []byte {
	if w <= 0 || h <= 0 || w%2 != 0 || h%2 != 0 || stride < w || len(nv12) < stride*(h+h/2) {
		return nil
	}
	yPlane := nv12[:stride*h]
	uv := nv12[stride*h : stride*(h+h/2)]
	out := make([]byte, w*h*4)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			Y := int(yPlane[y*stride+x]) - 16
			ui := (y/2)*stride + (x &^ 1)
			U := int(uv[ui]) - 128
			V := int(uv[ui+1]) - 128
			C := 298 * Y
			var r, g, b int
			if matrix == mfVideoTransferMatrixBT709 {
				r = (C + 459*V + 128) >> 8
				g = (C - 55*U - 136*V + 128) >> 8
				b = (C + 541*U + 128) >> 8
			} else {
				r = (C + 409*V + 128) >> 8
				g = (C - 100*U - 208*V + 128) >> 8
				b = (C + 516*U + 128) >> 8
			}
			i := (y*w + x) * 4
			out[i] = clampByte(b)
			out[i+1] = clampByte(g)
			out[i+2] = clampByte(r)
			out[i+3] = 255
		}
	}
	return out
}

func matrixForHeight(height int) uint32 {
	if height > 576 {
		return mfVideoTransferMatrixBT709
	}
	return mfVideoTransferMatrixBT601
}

func clampByte(v int) byte {
	if v < 0 {
		return 0
	}
	if v > 255 {
		return 255
	}
	return byte(v)
}

func vt(obj uintptr, idx int) uintptr {
	return *(*uintptr)(unsafe.Pointer(*(*uintptr)(unsafe.Pointer(obj)) + uintptr(idx)*unsafe.Sizeof(uintptr(0))))
}

func call(obj uintptr, idx int, args ...uintptr) uintptr {
	full := append([]uintptr{obj}, args...)
	r, _, _ := syscallN(vt(obj, idx), full...)
	return r
}

func syscallN(trap uintptr, args ...uintptr) (uintptr, uintptr, error) {
	return syscall.SyscallN(trap, args...)
}

func release(obj uintptr) {
	if obj == 0 {
		return
	}
	call(obj, 2)
}

func createSample(data []byte, time, duration int64) (uintptr, error) {
	var buf uintptr
	r, _, _ := procMFCreateMemoryBuffer.Call(uintptr(len(data)), uintptr(unsafe.Pointer(&buf)))
	if r != 0 {
		return 0, errors.New("could not create media buffer")
	}
	var max, cur uint32
	var ptr uintptr
	if call(buf, 3, uintptr(unsafe.Pointer(&ptr)), uintptr(unsafe.Pointer(&max)), uintptr(unsafe.Pointer(&cur))) != 0 {
		release(buf)
		return 0, errors.New("could not lock media buffer")
	}
	copy(unsafe.Slice((*byte)(unsafe.Pointer(ptr)), len(data)), data)
	call(buf, 4)
	call(buf, 6, uintptr(len(data)))
	var sample uintptr
	r, _, _ = procMFCreateSample.Call(uintptr(unsafe.Pointer(&sample)))
	if r != 0 {
		release(buf)
		return 0, errors.New("could not create sample")
	}
	// IMFSample inherits all 30 IMFAttributes methods. Its IMFSample-specific
	// methods therefore begin at slot 33 (after IUnknown), making AddBuffer,
	// SetSampleTime, and SetSampleDuration slots 42, 36, and 38.
	if call(sample, 42, buf) != 0 {
		release(sample)
		release(buf)
		return 0, errors.New("could not add buffer")
	}
	release(buf)
	call(sample, 36, uintptr(time))
	if duration > 0 {
		call(sample, 38, uintptr(duration))
	}
	return sample, nil
}

func processInput(mft, sample uintptr) error {
	r := call(mft, 24, 0, sample, 0)
	if r != 0 {
		return fmt.Errorf("media transform rejected the frame (0x%08x)", uint32(r))
	}
	return nil
}

type mftOutputDataBuffer struct {
	dwStreamID uint32
	_          uint32
	pSample    uintptr
	dwStatus   uint32
	_          uint32
	pEvents    uintptr
}

type mftOutputStreamInfo struct {
	dwFlags     uint32
	cbSize      uint32
	cbAlignment uint32
}

func emptySample(max int) (uintptr, error) {
	if max < 1 {
		max = 1
	}
	var buf uintptr
	r, _, _ := procMFCreateMemoryBuffer.Call(uintptr(max), uintptr(unsafe.Pointer(&buf)))
	if r != 0 {
		return 0, errors.New("could not create media buffer")
	}
	var sample uintptr
	r, _, _ = procMFCreateSample.Call(uintptr(unsafe.Pointer(&sample)))
	if r != 0 {
		release(buf)
		return 0, errors.New("could not create sample")
	}
	if call(sample, 42, buf) != 0 {
		release(sample)
		release(buf)
		return 0, errors.New("could not add buffer")
	}
	release(buf)
	return sample, nil
}

func processOutput(mft uintptr) ([]byte, error) {
	return processOutputWithRetry(mft, true)
}

func processOutputWithRetry(mft uintptr, allowStreamChange bool) ([]byte, error) {
	var info mftOutputStreamInfo
	call(mft, 7, 0, uintptr(unsafe.Pointer(&info)))
	provides := info.dwFlags&0x100 != 0
	var sample uintptr
	if !provides {
		sz := int(info.cbSize)
		if sz == 0 {
			sz = 1 << 20
		}
		s, err := emptySample(sz)
		if err != nil {
			return nil, err
		}
		sample = s
	}
	out := mftOutputDataBuffer{pSample: sample}
	var status uint32
	hr := call(mft, 25, 0, 1, uintptr(unsafe.Pointer(&out)), uintptr(unsafe.Pointer(&status)))
	if sample != 0 && out.pSample != 0 && out.pSample != sample {
		release(sample)
		sample = out.pSample
	} else if sample == 0 {
		sample = out.pSample
	}
	if uint32(hr) == 0xC00D6D61 && allowStreamChange {
		if sample != 0 {
			release(sample)
		}
		if err := resetOutputType(mft); err != nil {
			return nil, err
		}
		return processOutputWithRetry(mft, false)
	}
	if uint32(hr) == 0xC00D6D72 || sample == 0 {
		if sample != 0 {
			release(sample)
		}
		return nil, nil
	}
	if hr != 0 {
		release(sample)
		return nil, fmt.Errorf("media transform output failed (0x%08x)", uint32(hr))
	}
	defer release(sample)
	var buf uintptr
	// IMFSample.GetBufferByIndex follows the 30 inherited IMFAttributes
	// methods and is therefore slot 40.
	if call(sample, 40, 0, uintptr(unsafe.Pointer(&buf))) != 0 {
		return nil, nil
	}
	defer release(buf)
	var max, cur uint32
	var ptr uintptr
	if call(buf, 3, uintptr(unsafe.Pointer(&ptr)), uintptr(unsafe.Pointer(&max)), uintptr(unsafe.Pointer(&cur))) != 0 {
		return nil, nil
	}
	n := int(cur)
	if n == 0 {
		call(buf, 4)
		return nil, nil
	}
	data := make([]byte, n)
	copy(data, unsafe.Slice((*byte)(unsafe.Pointer(ptr)), n))
	call(buf, 4)
	return data, nil
}

// Some decoders only expose their final output type after seeing SPS/PPS.
// Handle MF_E_TRANSFORM_STREAM_CHANGE before submitting another sample, or the
// transform remains in MF_E_NOTACCEPTING and video reception stalls forever.
func resetOutputType(mft uintptr) error {
	for i := uintptr(0); i < 64; i++ {
		var mt uintptr
		if hr := call(mft, 14, 0, i, uintptr(unsafe.Pointer(&mt))); hr != 0 || mt == 0 {
			break
		}
		hr := call(mft, 16, 0, mt, 0)
		release(mt)
		if hr == 0 {
			return nil
		}
	}
	return errors.New("media transform did not provide a usable output type")
}
