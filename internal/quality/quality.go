package quality

type Res int

const (
	Res480 Res = iota
	Res720
	Res1080
	Res4K
)

type Preset struct {
	Width  int
	Height int
	FPS    int
	Fixed  int
	Min    int
	Max    int
}

func Labels() []string {
	return []string{"480p", "720p", "1080p", "4K"}
}

func Size(res Res) (int, int) {
	switch res {
	case Res480:
		return 848, 480
	case Res720:
		return 1280, 720
	case Res1080:
		return 1920, 1080
	case Res4K:
		return 3840, 2160
	default:
		return 1920, 1080
	}
}

func FPSOptions(res Res) []int {
	switch res {
	case Res480, Res720:
		return []int{15, 24, 30, 60, 120}
	case Res1080:
		return []int{15, 24, 30, 60}
	case Res4K:
		return []int{24}
	default:
		return []int{30}
	}
}

func Lookup(res Res, fps int) Preset {
	w, h := Size(res)
	fps = clampFPS(res, fps)
	minKbps, maxKbps, fixedKbps := rates(res, fps)
	return Preset{
		Width:  w,
		Height: h,
		FPS:    fps,
		Fixed:  fixedKbps * 1000,
		Min:    minKbps * 1000,
		Max:    maxKbps * 1000,
	}
}

func clampFPS(res Res, fps int) int {
	opts := FPSOptions(res)
	for _, v := range opts {
		if v == fps {
			return fps
		}
	}
	for _, v := range opts {
		if v == 30 {
			return 30
		}
	}
	return opts[0]
}

func rates(res Res, fps int) (minKbps, maxKbps, fixedKbps int) {
	switch res {
	case Res480:
		switch fps {
		case 15:
			return 800, 2000, 1500
		case 24:
			return 1000, 3000, 2000
		case 30:
			return 1200, 3500, 2500
		case 60:
			return 2000, 5500, 4000
		case 120:
			return 3500, 9000, 7000
		}
	case Res720:
		switch fps {
		case 15:
			return 1500, 3500, 2500
		case 24:
			return 2000, 5000, 3500
		case 30:
			return 2500, 6000, 4500
		case 60:
			return 4000, 10000, 7500
		case 120:
			return 6000, 16000, 12000
		}
	case Res1080:
		switch fps {
		case 15:
			return 2500, 6000, 4500
		case 24:
			return 3500, 9000, 6500
		case 30:
			return 4000, 10000, 8000
		case 60:
			return 6000, 16000, 12000
		}
	case Res4K:
		return 12000, 32000, 25000
	}
	return 4000, 10000, 8000
}
