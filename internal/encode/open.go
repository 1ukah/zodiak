package encode

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

type guid struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

var (
	iidIMFTransform     = guid{0xBF94C121, 0x5B05, 0x4E6F, [8]byte{0x80, 0x00, 0xBA, 0x59, 0x89, 0x61, 0x41, 0x4D}}
	iidIUnknown         = guid{0x00000000, 0x0000, 0x0000, [8]byte{0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}}
	iidClassFactory     = guid{0x00000001, 0x0000, 0x0000, [8]byte{0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}}
	iidIMFActivate      = guid{0x7FEE9E9A, 0x4A89, 0x47A6, [8]byte{0x89, 0x9C, 0xB6, 0xA5, 0x3A, 0x70, 0xFB, 0x67}}
	clsidH264Enc        = guid{0x6CA50344, 0x051A, 0x4DED, [8]byte{0x97, 0x79, 0xA4, 0x33, 0x05, 0x16, 0x5E, 0x35}}
	clsidNvH264Enc      = guid{0x60F44560, 0x5A20, 0x4857, [8]byte{0xBF, 0xEF, 0xD2, 0x97, 0x73, 0xCB, 0x80, 0x40}}
	clsidH264Dec        = guid{0x62CE7E72, 0x4C71, 0x4D20, [8]byte{0xB1, 0x5D, 0x45, 0x28, 0x31, 0xA8, 0x7D, 0x9D}}
	mftCatVideoEnc      = guid{0xF79EAC7D, 0xE545, 0x4387, [8]byte{0xBD, 0xEE, 0xD6, 0x47, 0xD7, 0xBD, 0xE4, 0x2A}}
	mfMajorType         = guid{0x48EBA18E, 0xF8C9, 0x4687, [8]byte{0xBF, 0x11, 0x0A, 0x74, 0xC9, 0xF9, 0x6A, 0x8F}}
	mfSubtype           = guid{0xF7E34C9A, 0x42E8, 0x4714, [8]byte{0xB7, 0x4B, 0xCB, 0x29, 0xD7, 0x2C, 0x35, 0xE5}}
	mfFrameSize         = guid{0x1652C33D, 0xD6B2, 0x4012, [8]byte{0xB8, 0x34, 0x72, 0x03, 0x08, 0x49, 0xA3, 0x7D}}
	mfFrameRate         = guid{0xC459A2E8, 0x3D2C, 0x4E44, [8]byte{0xB1, 0x32, 0xFE, 0xE5, 0x15, 0x6C, 0x7B, 0xB0}}
	mfPixelAspect       = guid{0xC6376A1E, 0x8D0A, 0x4027, [8]byte{0xBE, 0x45, 0x6D, 0x9A, 0x0A, 0xD3, 0x9B, 0xB6}}
	mfDefaultStride     = guid{0x644B4E48, 0x1E02, 0x4516, [8]byte{0xB0, 0xEB, 0xC0, 0x1C, 0xA9, 0xD4, 0x9A, 0xC6}}
	mfYUVMatrix         = guid{0x3E23D450, 0x2C75, 0x4D25, [8]byte{0xA0, 0x0E, 0xB9, 0x16, 0x70, 0xD1, 0x23, 0x27}}
	mfVideoNominalRange = guid{0xC21B8EE5, 0xB956, 0x4071, [8]byte{0x8D, 0xAF, 0x32, 0x5E, 0xDF, 0x5C, 0xAB, 0x11}}
	mfInterlace         = guid{0xE2724BB8, 0xE676, 0x4806, [8]byte{0xB4, 0xB2, 0xA8, 0xD6, 0xEF, 0xB4, 0x4C, 0xCD}}
	mfAvgBitrate        = guid{0x20332624, 0xFB0D, 0x4D9E, [8]byte{0xBD, 0x0D, 0xCB, 0xF6, 0x78, 0x6C, 0x10, 0x2E}}
	mfMpeg2Profile      = guid{0xAD76A80B, 0x2D5C, 0x4E0B, [8]byte{0xB3, 0x75, 0x64, 0xE5, 0x20, 0x13, 0x70, 0x36}}
	mfIndependent       = guid{0xC9173739, 0x5E56, 0x461C, [8]byte{0xB7, 0x13, 0x46, 0xFB, 0x99, 0x5C, 0xB9, 0x5F}}
	mfMediaVideo        = guid{0x73646976, 0x0000, 0x0010, [8]byte{0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71}}
	mfNV12              = guid{0x3231564E, 0x0000, 0x0010, [8]byte{0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71}}
	mfH264              = guid{0x34363248, 0x0000, 0x0010, [8]byte{0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71}}
	mfLowLatency        = guid{0x9C27891A, 0xED7A, 0x40E1, [8]byte{0x88, 0xE8, 0xB2, 0x27, 0x27, 0xA0, 0x24, 0xEE}}
)

const (
	clsctxInproc         = 1
	mfVideoProgressive   = 2
	h264ProfileMain      = 77
	mftMsgBeginStreaming = 0x10000000
	mftMsgStartOfStream  = 0x10000003
	mftSetInputType      = 15
	mftSetOutputType     = 16
	mftProcessMessage    = 23
)

func (e *Encoder) open() error {
	mft, err := createTransform(&clsidH264Enc)
	if err != nil {
		return err
	}
	var attrs uintptr
	if call(mft, 8, uintptr(unsafe.Pointer(&attrs))) == 0 && attrs != 0 {
		call(attrs, 21, uintptr(unsafe.Pointer(&mfLowLatency)), 1)
		release(attrs)
	}
	inType, err := createMediaType()
	if err != nil {
		release(mft)
		return err
	}
	outType, err := createMediaType()
	if err != nil {
		release(inType)
		release(mft)
		return err
	}
	if err := setVideo(outType, mfH264, e.width, e.height, e.fps, e.bitrate, true, e.matrix); err != nil {
		release(outType)
		release(inType)
		release(mft)
		return err
	}
	if call(mft, mftSetOutputType, 0, outType, 0) != 0 {
		release(outType)
		release(inType)
		release(mft)
		return errors.New("H.264 encoder rejected the output type")
	}
	if err := setVideo(inType, mfNV12, e.width, e.height, e.fps, 0, false, e.matrix); err != nil {
		release(outType)
		release(inType)
		release(mft)
		return err
	}
	if call(mft, mftSetInputType, 0, inType, 0) != 0 {
		release(outType)
		release(inType)
		release(mft)
		return errors.New("H.264 encoder rejected the input type")
	}
	call(mft, mftProcessMessage, mftMsgBeginStreaming, 0)
	call(mft, mftProcessMessage, mftMsgStartOfStream, 0)
	e.mft = mft
	e.inType = inType
	e.outType = outType
	return nil
}

func (d *Decoder) open() error {
	mft, err := createTransform(&clsidH264Dec)
	if err != nil {
		return err
	}
	inType, err := createMediaType()
	if err != nil {
		release(mft)
		return err
	}
	outType, err := createMediaType()
	if err != nil {
		release(inType)
		release(mft)
		return err
	}
	if err := setVideo(inType, mfH264, d.width, d.height, 30, 0, true, d.matrix); err != nil {
		release(outType)
		release(inType)
		release(mft)
		return err
	}
	if err := setVideo(outType, mfNV12, d.width, d.height, 30, 0, false, d.matrix); err != nil {
		release(outType)
		release(inType)
		release(mft)
		return err
	}
	if call(mft, mftSetInputType, 0, inType, 0) != 0 {
		release(outType)
		release(inType)
		release(mft)
		return errors.New("H.264 decoder rejected the input type")
	}
	if call(mft, mftSetOutputType, 0, outType, 0) != 0 {
		release(outType)
		release(inType)
		release(mft)
		return errors.New("H.264 decoder rejected the output type")
	}
	d.stride = mediaTypeStride(outType, d.width)
	var currentType uintptr
	if call(mft, 18, 0, uintptr(unsafe.Pointer(&currentType))) == 0 && currentType != 0 {
		if stride := mediaTypeStride(currentType, d.width); stride >= d.width {
			d.stride = stride
		}
		release(currentType)
	}
	call(mft, mftProcessMessage, mftMsgBeginStreaming, 0)
	call(mft, mftProcessMessage, mftMsgStartOfStream, 0)
	release(inType)
	release(outType)
	d.mft = mft
	return nil
}

func createTransform(clsid *guid) (uintptr, error) {
	obj, cErr := coCreateTransform(clsid)
	if cErr == nil {
		return obj, nil
	}
	if *clsid != clsidH264Enc {
		return 0, cErr
	}
	obj, dErr := createFromDLL("mfh264enc.dll", clsid)
	if dErr == nil {
		return obj, nil
	}
	obj, nErr := createFromDLL(findNvEnc(), &clsidNvH264Enc)
	if nErr == nil {
		return obj, nil
	}
	obj, mErr := enumCreate(mftCatVideoEnc)
	if mErr == nil {
		return obj, nil
	}
	return 0, fmt.Errorf("could not create the H.264 transform (%v; %v; %v; %v)", cErr, dErr, nErr, mErr)
}

func coCreateTransform(clsid *guid) (uintptr, error) {
	var obj uintptr
	r, _, _ := procCoCreateInstance.Call(
		uintptr(unsafe.Pointer(clsid)),
		0,
		uintptr(clsctxInproc),
		uintptr(unsafe.Pointer(&iidIMFTransform)),
		uintptr(unsafe.Pointer(&obj)),
	)
	if r != 0 || obj == 0 {
		return 0, fmt.Errorf("cocreate %08x", uint32(r))
	}
	return obj, nil
}

func findNvEnc() string {
	matches, _ := filepath.Glob(`C:\Windows\System32\DriverStore\FileRepository\*\nvEncMFTH264x.dll`)
	if len(matches) == 0 {
		return ""
	}
	return matches[0]
}

func createFromDLL(name string, clsid *guid) (uintptr, error) {
	if name == "" {
		return 0, errors.New("no encoder dll")
	}
	var lazy *windows.LazyDLL
	if strings.ContainsAny(name, `/\`) {
		lazy = windows.NewLazyDLL(name)
	} else {
		lazy = windows.NewLazySystemDLL(name)
	}
	proc := lazy.NewProc("DllGetClassObject")
	if err := proc.Find(); err != nil {
		return 0, err
	}
	var factory uintptr
	r, _, _ := proc.Call(
		uintptr(unsafe.Pointer(clsid)),
		uintptr(unsafe.Pointer(&iidClassFactory)),
		uintptr(unsafe.Pointer(&factory)),
	)
	if r != 0 || factory == 0 {
		return 0, fmt.Errorf("dllget %08x", uint32(r))
	}
	defer release(factory)
	var obj uintptr
	hr := call(factory, 3, 0, uintptr(unsafe.Pointer(&iidIMFTransform)), uintptr(unsafe.Pointer(&obj)))
	if hr == 0 && obj != 0 {
		return obj, nil
	}
	var unk uintptr
	hr = call(factory, 3, 0, uintptr(unsafe.Pointer(&iidIUnknown)), uintptr(unsafe.Pointer(&unk)))
	if hr != 0 || unk == 0 {
		return 0, fmt.Errorf("factory %08x", uint32(hr))
	}
	defer release(unk)
	if obj, ok := asTransform(unk); ok {
		return obj, nil
	}
	return 0, fmt.Errorf("qi %08x", uint32(hr))
}

func asTransform(unk uintptr) (uintptr, bool) {
	var obj uintptr
	if call(unk, 0, uintptr(unsafe.Pointer(&iidIMFTransform)), uintptr(unsafe.Pointer(&obj))) == 0 && obj != 0 {
		return obj, true
	}
	var act uintptr
	if call(unk, 0, uintptr(unsafe.Pointer(&iidIMFActivate)), uintptr(unsafe.Pointer(&act))) != 0 || act == 0 {
		return 0, false
	}
	defer release(act)
	obj = 0
	if call(act, 33, uintptr(unsafe.Pointer(&iidIMFTransform)), uintptr(unsafe.Pointer(&obj))) == 0 && obj != 0 {
		return obj, true
	}
	return 0, false
}

func enumCreate(category guid) (uintptr, error) {
	if err := procMFTEnum.Find(); err != nil {
		return 0, err
	}
	var clsids uintptr
	var n uint32
	r, _, _ := procMFTEnum.Call(
		uintptr(unsafe.Pointer(&category)),
		0,
		0,
		0,
		0,
		uintptr(unsafe.Pointer(&clsids)),
		uintptr(unsafe.Pointer(&n)),
	)
	if r != 0 || n == 0 || clsids == 0 {
		return 0, fmt.Errorf("mftenum %08x n=%d", uint32(r), n)
	}
	defer procCoTaskMemFree.Call(clsids)
	var ids []string
	for i := uint32(0); i < n; i++ {
		clsid := *(*guid)(unsafe.Pointer(clsids + uintptr(i)*unsafe.Sizeof(guid{})))
		ids = append(ids, fmt.Sprintf("%08x-%04x-%04x-%02x%02x-%02x%02x%02x%02x%02x%02x", clsid.Data1, clsid.Data2, clsid.Data3, clsid.Data4[0], clsid.Data4[1], clsid.Data4[2], clsid.Data4[3], clsid.Data4[4], clsid.Data4[5], clsid.Data4[6], clsid.Data4[7]))
		obj, err := coCreateTransform(&clsid)
		if err == nil {
			if mftHasH264Out(obj) {
				return obj, nil
			}
			release(obj)
			ids[len(ids)-1] += "/noh264"
			continue
		}
		ids[len(ids)-1] += fmt.Sprintf("/%v", err)
	}
	return 0, fmt.Errorf("mftenum none of %v", ids)
}

func mftHasH264Out(obj uintptr) bool {
	for i := uintptr(0); i < 64; i++ {
		var mt uintptr
		if call(obj, 14, 0, i, uintptr(unsafe.Pointer(&mt))) != 0 {
			return false
		}
		var sub guid
		ok := call(mt, 10, uintptr(unsafe.Pointer(&mfSubtype)), uintptr(unsafe.Pointer(&sub))) == 0 && sub == mfH264
		release(mt)
		if ok {
			return true
		}
	}
	return false
}

func createMediaType() (uintptr, error) {
	var mt uintptr
	r, _, _ := procMFCreateMediaType.Call(uintptr(unsafe.Pointer(&mt)))
	if r != 0 || mt == 0 {
		return 0, errors.New("could not create a media type")
	}
	return mt, nil
}

func setVideo(mt uintptr, subtype guid, width, height, fps, bitrate int, encoded bool, matrix uint32) error {
	if call(mt, 24, uintptr(unsafe.Pointer(&mfMajorType)), uintptr(unsafe.Pointer(&mfMediaVideo))) != 0 {
		return errors.New("could not set media type")
	}
	if call(mt, 24, uintptr(unsafe.Pointer(&mfSubtype)), uintptr(unsafe.Pointer(&subtype))) != 0 {
		return errors.New("could not set media subtype")
	}
	size := uint64(width)<<32 | uint64(uint32(height))
	if call(mt, 22, uintptr(unsafe.Pointer(&mfFrameSize)), uintptr(size)) != 0 {
		return errors.New("could not set frame size")
	}
	if fps <= 0 {
		fps = 30
	}
	rate := uint64(fps)<<32 | 1
	call(mt, 22, uintptr(unsafe.Pointer(&mfFrameRate)), uintptr(rate))
	par := uint64(1)<<32 | 1
	call(mt, 22, uintptr(unsafe.Pointer(&mfPixelAspect)), uintptr(par))
	call(mt, 21, uintptr(unsafe.Pointer(&mfInterlace)), uintptr(mfVideoProgressive))
	call(mt, 21, uintptr(unsafe.Pointer(&mfIndependent)), 1)
	call(mt, 21, uintptr(unsafe.Pointer(&mfYUVMatrix)), uintptr(matrix))
	// The BGRA-to-NV12 path writes video-range samples (16..235 luma,
	// 16..240 chroma). Declare that range explicitly so the encoder and
	// decoder don't infer a different range on systems with different MFTs.
	call(mt, 21, uintptr(unsafe.Pointer(&mfVideoNominalRange)), 2)
	if subtype == mfNV12 {
		call(mt, 21, uintptr(unsafe.Pointer(&mfDefaultStride)), uintptr(width))
	}
	if encoded {
		call(mt, 21, uintptr(unsafe.Pointer(&mfMpeg2Profile)), uintptr(h264ProfileMain))
		if bitrate > 0 {
			call(mt, 21, uintptr(unsafe.Pointer(&mfAvgBitrate)), uintptr(bitrate))
		}
	}
	return nil
}

func mediaTypeStride(mt uintptr, fallback int) int {
	var stride uint32
	if call(mt, 7, uintptr(unsafe.Pointer(&mfDefaultStride)), uintptr(unsafe.Pointer(&stride))) != 0 {
		return fallback
	}
	value := int(int32(stride))
	if value < 0 {
		value = -value
	}
	if value < fallback {
		return fallback
	}
	return value
}
