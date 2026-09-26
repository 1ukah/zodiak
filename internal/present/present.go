package present

import (
	"sync"

	"golang.org/x/sys/windows"
	"sharescreen/internal/w32"
)

type Sink struct {
	hwnd    windows.HWND
	mu      sync.Mutex
	pixels  []byte
	width   int
	height  int
	pending bool
	closed  bool
}

func New(hwnd windows.HWND) *Sink {
	s := &Sink{hwnd: hwnd}
	return s
}

func (s *Sink) Handle() windows.HWND {
	return s.hwnd
}

func (s *Sink) Draw(bgra []byte, width, height int) {
	if width <= 0 || height <= 0 || len(bgra) == 0 {
		return
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	// Captured and decoded frames are immutable after Draw returns. Retaining
	// the newest frame avoids copying several megabytes on every preview tick.
	s.pixels = bgra
	s.width = width
	s.height = height
	need := !s.pending
	s.pending = true
	s.mu.Unlock()
	if need {
		w32.Invalidate(s.hwnd)
	}
}

// Close detaches a sink from future decoded frames and invalidates its last
// image. This prevents a frame already in flight from repainting a stale
// stream after the UI removes its pane.
func (s *Sink) Close() {
	s.mu.Lock()
	s.closed = true
	s.pixels = nil
	s.width = 0
	s.height = 0
	s.pending = false
	s.mu.Unlock()
	w32.Invalidate(s.hwnd)
}

func (s *Sink) Paint() {
	var ps w32.PaintStruct
	hdc := w32.BeginPaint(s.hwnd, &ps)
	r := w32.ClientRect(s.hwnd)
	s.mu.Lock()
	px := s.pixels
	w := s.width
	h := s.height
	s.pending = false
	s.mu.Unlock()
	if hdc == 0 {
		return
	}
	if len(px) == 0 || w == 0 || h == 0 {
		w32.Fill(hdc, &r, w32.COLOR_WINDOW)
	} else {
		dw := r.Right - r.Left
		dh := r.Bottom - r.Top
		if dw > 0 && dh > 0 {
			x, y, fittedW, fittedH := fitRect(dw, dh, int32(w), int32(h))
			// Replace the previous picture before touching the letterbox area.
			// Clearing the whole pane first causes a visible flash while a
			// filtered stretch is being calculated and painted.
			w32.StretchBGRA(hdc, x, y, fittedW, fittedH, int32(w), int32(h), px)
			fillLetterbox(hdc, dw, dh, x, y, fittedW, fittedH)
		}
	}
	w32.EndPaint(s.hwnd, &ps)
}

func fillLetterbox(hdc uintptr, paneW, paneH, x, y, width, height int32) {
	fill := func(left, top, right, bottom int32) {
		if right <= left || bottom <= top {
			return
		}
		r := w32.Rect{Left: left, Top: top, Right: right, Bottom: bottom}
		w32.Fill(hdc, &r, w32.COLOR_WINDOW)
	}

	fill(0, 0, paneW, y)
	fill(0, y+height, paneW, paneH)
	fill(0, y, x, y+height)
	fill(x+width, y, paneW, y+height)
}

func fitRect(destW, destH, srcW, srcH int32) (x, y, width, height int32) {
	if destW <= 0 || destH <= 0 || srcW <= 0 || srcH <= 0 {
		return 0, 0, 0, 0
	}

	width = destW
	height = int32(int64(destW) * int64(srcH) / int64(srcW))
	if height > destH {
		height = destH
		width = int32(int64(destH) * int64(srcW) / int64(srcH))
	}
	if width < 1 {
		width = 1
	}
	if height < 1 {
		height = 1
	}
	x = (destW - width) / 2
	y = (destH - height) / 2
	return x, y, width, height
}
