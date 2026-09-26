package present

import "testing"

func TestFitRectPreservesAspectRatio(t *testing.T) {
	tests := []struct {
		name                       string
		destW, destH, srcW, srcH   int32
		wantX, wantY, wantW, wantH int32
	}{
		{
			name:  "sixteen by nine in tall pane",
			destW: 802, destH: 692, srcW: 1920, srcH: 1080,
			wantX: 0, wantY: 120, wantW: 802, wantH: 451,
		},
		{
			name:  "four by three in wide pane",
			destW: 1920, destH: 1080, srcW: 1024, srcH: 768,
			wantX: 240, wantY: 0, wantW: 1440, wantH: 1080,
		},
		{
			name:  "matching aspect",
			destW: 1280, destH: 720, srcW: 1920, srcH: 1080,
			wantX: 0, wantY: 0, wantW: 1280, wantH: 720,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			x, y, w, h := fitRect(tt.destW, tt.destH, tt.srcW, tt.srcH)
			if x != tt.wantX || y != tt.wantY || w != tt.wantW || h != tt.wantH {
				t.Fatalf("fitRect() = (%d, %d, %d, %d), want (%d, %d, %d, %d)", x, y, w, h, tt.wantX, tt.wantY, tt.wantW, tt.wantH)
			}
		})
	}
}
