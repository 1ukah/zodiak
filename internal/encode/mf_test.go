package encode

import (
	"os"
	"testing"
)

// TestNativeH264RoundTrip exercises the Media Foundation COM path that backs
// screen sharing. It is opt-in because hosted Windows runners do not always
// expose an H.264 transform. Run it locally with WELFARE_NATIVE_TEST=1.
func TestNativeH264RoundTrip(t *testing.T) {
	if os.Getenv("WELFARE_NATIVE_TEST") != "1" {
		t.Skip("set WELFARE_NATIVE_TEST=1 to run the native codec smoke test")
	}
	const width, height = 320, 180
	frame := make([]byte, width*height*4)
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			i := (y*width + x) * 4
			frame[i] = byte(x)
			frame[i+1] = byte(y)
			frame[i+2] = byte(x + y)
			frame[i+3] = 255
		}
	}

	enc, err := NewEncoder(width, height, 15, 1_000_000)
	if err != nil {
		t.Fatalf("open encoder: %v", err)
	}
	defer enc.Close()

	dec, err := NewDecoder(width, height)
	if err != nil {
		t.Fatalf("open decoder: %v", err)
	}
	defer dec.Close()

	decoded := false
	for i := 0; i < 45; i++ {
		frame[(i%width)*4] = byte(i * 5)
		nal, err := enc.Encode(frame)
		if err != nil {
			t.Fatalf("encode frame %d: %v", i, err)
		}
		if len(nal) == 0 {
			continue
		}
		bgra, gotW, gotH, err := dec.Decode(nal)
		if err != nil {
			t.Fatalf("decode frame %d: %v", i, err)
		}
		if len(bgra) > 0 {
			if gotW != width || gotH != height {
				t.Fatalf("decoded %dx%d, want %dx%d", gotW, gotH, width, height)
			}
			decoded = true
		}
	}
	if !decoded {
		t.Fatal("encoder produced no decodable H.264 frame")
	}
}
