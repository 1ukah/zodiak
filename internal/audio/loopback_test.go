package audio

import (
	"os"
	"testing"
	"time"
)

// TestNativeAudioLifecycle verifies that a pending capture read is safely
// released during shutdown. This is the path used when a user stops sharing or
// leaves a room while system audio is active.
func TestNativeAudioLifecycle(t *testing.T) {
	if os.Getenv("WELFARE_NATIVE_TEST") != "1" {
		t.Skip("set WELFARE_NATIVE_TEST=1 to run the native audio smoke test")
	}
	capture, _, err := OpenLoopback()
	if err != nil {
		t.Fatalf("open loopback: %v", err)
	}
	done := make(chan struct{})
	go func() {
		_, _ = capture.Read()
		close(done)
	}()
	time.Sleep(100 * time.Millisecond)
	capture.Close()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("capture read did not exit after Close")
	}
}
