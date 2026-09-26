package capture

import (
	"fmt"
	"image"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
	"sharescreen/internal/w32"
)

type Kind int

const (
	KindScreen Kind = iota
	KindWindow
)

type Source struct {
	ID     string
	Name   string
	Kind   Kind
	Bounds image.Rectangle
	HWND   windows.HWND
	Index  int
}

type Frame struct {
	BGRA   []byte
	Width  int
	Height int
}

const maxFrameBytes = 256 << 20

type monitor struct {
	r     w32.Rect
	index int
}

func List() []Source {
	var out []Source
	monitors := listMonitors()
	for i, m := range monitors {
		w := int(m.r.Right - m.r.Left)
		h := int(m.r.Bottom - m.r.Top)
		name := fmt.Sprintf("Screen %d (%dx%d)", i+1, w, h)
		if i == 0 {
			name = fmt.Sprintf("Primary screen (%dx%d)", w, h)
		}
		out = append(out, Source{
			ID:     fmt.Sprintf("screen:%d", i),
			Name:   name,
			Kind:   KindScreen,
			Bounds: image.Rect(int(m.r.Left), int(m.r.Top), int(m.r.Right), int(m.r.Bottom)),
			Index:  i,
		})
	}
	w32.EnumTopWindows(func(hwnd windows.HWND) bool {
		if !w32.IsVisible(hwnd) {
			return true
		}
		title := w32.WindowTitle(hwnd)
		if title == "" || title == "Welfare Office" {
			return true
		}
		r := windowRect(hwnd)
		w := int(r.Right - r.Left)
		h := int(r.Bottom - r.Top)
		if w < 64 || h < 64 {
			return true
		}
		out = append(out, Source{
			ID:     fmt.Sprintf("window:%d", hwnd),
			Name:   title,
			Kind:   KindWindow,
			Bounds: image.Rect(int(r.Left), int(r.Top), int(r.Right), int(r.Bottom)),
			HWND:   hwnd,
		})
		return true
	})
	return out
}

func Grab(src Source) (Frame, error) {
	x, y, w, h, err := sourceRect(src)
	if err != nil {
		return Frame{}, err
	}
	window := windows.HWND(0)
	if src.Kind == KindWindow && src.HWND != 0 {
		window = src.HWND
	}
	pixels, err := w32.BitBltCapture(window, x, y, w, h)
	if err != nil {
		return Frame{}, err
	}
	return Frame{BGRA: pixels, Width: w, Height: h}, nil
}

// Dimensions returns the current capture dimensions without reading a full
// frame. Window dimensions are refreshed so a resized source starts with an
// encoder sized for its current client.
func Dimensions(src Source) (int, int, error) {
	_, _, w, h, err := sourceRect(src)
	return w, h, err
}

// GrabScaled captures directly into the encoded stream dimensions. It avoids
// the native-resolution BGRA allocation and second full-frame resample on
// every share tick.
func GrabScaled(src Source, width, height int) (Frame, error) {
	x, y, w, h, err := sourceRect(src)
	if err != nil {
		return Frame{}, err
	}
	if !validFrameSize(width, height) {
		return Frame{}, syscall.EINVAL
	}
	window := windows.HWND(0)
	if src.Kind == KindWindow && src.HWND != 0 {
		window = src.HWND
	}
	pixels, err := w32.StretchBltCapture(window, x, y, w, h, width, height)
	if err != nil {
		return Frame{}, err
	}
	return Frame{BGRA: pixels, Width: width, Height: height}, nil
}

func sourceRect(src Source) (x, y, width, height int, err error) {
	if src.Kind == KindWindow {
		if src.HWND == 0 {
			return 0, 0, 0, 0, syscall.EINVAL
		}
		r := windowRect(src.HWND)
		width = int(r.Right - r.Left)
		height = int(r.Bottom - r.Top)
	} else {
		x = src.Bounds.Min.X
		y = src.Bounds.Min.Y
		width = src.Bounds.Dx()
		height = src.Bounds.Dy()
	}
	if width <= 0 || height <= 0 {
		return 0, 0, 0, 0, syscall.EINVAL
	}
	if !validFrameSize(width, height) {
		return 0, 0, 0, 0, fmt.Errorf("selected source is too large to capture")
	}
	return x, y, width, height, nil
}

func Scale(frame Frame, width, height int) Frame {
	if width <= 0 || height <= 0 || (width == frame.Width && height == frame.Height) {
		return frame
	}
	if !validFrameSize(width, height) || !validFrameSize(frame.Width, frame.Height) || len(frame.BGRA) < frame.Width*frame.Height*4 {
		return Frame{}
	}
	out := w32.ScaleBGRA(frame.BGRA, frame.Width, frame.Height, width, height)
	if len(out) != width*height*4 {
		return Frame{}
	}
	return Frame{BGRA: out, Width: width, Height: height}
}

func validFrameSize(width, height int) bool {
	if width <= 0 || height <= 0 {
		return false
	}
	return width <= maxFrameBytes/4/height
}

func Fit(srcW, srcH, maxW, maxH int) (int, int) {
	if maxW <= 0 || maxH <= 0 {
		return srcW, srcH
	}
	if srcW <= maxW && srcH <= maxH {
		w, h := srcW&^1, srcH&^1
		if w < 2 {
			w = 2
		}
		if h < 2 {
			h = 2
		}
		return w, h
	}
	rw := float64(maxW) / float64(srcW)
	rh := float64(maxH) / float64(srcH)
	scale := rw
	if rh < rw {
		scale = rh
	}
	w := int(float64(srcW) * scale)
	h := int(float64(srcH) * scale)
	if w < 2 {
		w = 2
	}
	if h < 2 {
		h = 2
	}
	w &^= 1
	h &^= 1
	return w, h
}

func listMonitors() []monitor {
	var list []monitor
	cb := syscall.NewCallback(func(hmonitor uintptr, hdc uintptr, rect *w32.Rect, lparam uintptr) uintptr {
		list = append(list, monitor{r: *rect, index: len(list)})
		return 1
	})
	user32 := windows.NewLazySystemDLL("user32.dll")
	proc := user32.NewProc("EnumDisplayMonitors")
	proc.Call(0, 0, cb, 0)
	if len(list) == 0 {
		smx := windows.NewLazySystemDLL("user32.dll").NewProc("GetSystemMetrics")
		cx, _, _ := smx.Call(0)
		cy, _, _ := smx.Call(1)
		list = append(list, monitor{r: w32.Rect{Right: int32(cx), Bottom: int32(cy)}})
	}
	return list
}

func windowRect(hwnd windows.HWND) w32.Rect {
	var r w32.Rect
	user32 := windows.NewLazySystemDLL("user32.dll")
	proc := user32.NewProc("GetWindowRect")
	proc.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&r)))
	return r
}
