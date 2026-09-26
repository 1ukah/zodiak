package capture

import (
	"os"
	"testing"
)

func TestFitKeepsEvenBoundedDimensions(t *testing.T) {
	w, h := Fit(3840, 2160, 1280, 720)
	if w != 1280 || h != 720 {
		t.Fatalf("Fit() = %dx%d, want 1280x720", w, h)
	}
	if w%2 != 0 || h%2 != 0 {
		t.Fatalf("Fit() returned odd dimensions %dx%d", w, h)
	}
}

// TestNativeCaptureSmoke exercises GDI capture without requiring a UI test
// runner. It is opt-in because some CI environments do not have an interactive
// desktop. Run it locally with WELFARE_NATIVE_TEST=1.
func TestNativeCaptureSmoke(t *testing.T) {
	if os.Getenv("WELFARE_NATIVE_TEST") != "1" {
		t.Skip("set WELFARE_NATIVE_TEST=1 to run the native capture smoke test")
	}
	var screen *Source
	for _, source := range List() {
		if source.Kind == KindScreen {
			candidate := source
			screen = &candidate
			break
		}
	}
	if screen == nil {
		t.Fatal("no screen source found")
	}
	frame, err := Grab(*screen)
	if err != nil {
		t.Fatalf("capture screen: %v", err)
	}
	if frame.Width <= 0 || frame.Height <= 0 || len(frame.BGRA) != frame.Width*frame.Height*4 {
		t.Fatalf("invalid frame: %dx%d (%d bytes)", frame.Width, frame.Height, len(frame.BGRA))
	}
	scaled := Scale(frame, 320, 180)
	if scaled.Width != 320 || scaled.Height != 180 || len(scaled.BGRA) != 320*180*4 {
		t.Fatalf("invalid scaled frame: %dx%d (%d bytes)", scaled.Width, scaled.Height, len(scaled.BGRA))
	}
}
