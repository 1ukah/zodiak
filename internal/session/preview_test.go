package session

import "testing"

func TestLocalPreviewToggle(t *testing.T) {
	s := New(Hooks{})
	if !s.localPreviewEnabled() {
		t.Fatal("local preview should be enabled by default")
	}

	s.SetLocalPreview(false)
	if s.localPreviewEnabled() {
		t.Fatal("local preview remained enabled after disabling it")
	}

	s.SetLocalPreview(true)
	if !s.localPreviewEnabled() {
		t.Fatal("local preview remained disabled after enabling it")
	}
}
