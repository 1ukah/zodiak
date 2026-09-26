package audio

func LinearToUlaw(sample int16) byte {
	const bias = 0x84
	sign := byte(0)
	x := int(sample)
	if x < 0 {
		sign = 0x80
		x = -x
		if x < 0 {
			x = 0x7FFF
		}
	}
	x += bias
	if x > 0x7FFF {
		x = 0x7FFF
	}
	exp := byte(7)
	for mask := 0x4000; mask != 0x80 && (x&mask) == 0; mask >>= 1 {
		exp--
	}
	mant := byte((x >> (exp + 3)) & 0x0F)
	return ^(sign | (exp << 4) | mant)
}

func UlawToLinear(u byte) int16 {
	u = ^u
	sign := u & 0x80
	exp := (u >> 4) & 0x07
	mant := u & 0x0F
	x := (int(mant) << 4) + 0x84
	x <<= exp
	x -= 0x84
	if sign != 0 {
		return int16(-x)
	}
	return int16(x)
}

func Downsample48kStereoTo8kMono(in []int16) []int16 {
	step := 12
	n := len(in) / step
	if n == 0 {
		return nil
	}
	out := make([]int16, n)
	for i := 0; i < n; i++ {
		base := i * step
		sum := int32(in[base]) + int32(in[base+1])
		out[i] = int16(sum / 2)
	}
	return out
}

func UlawTo48kStereo(ulaw []byte) []int16 {
	out := make([]int16, len(ulaw)*12)
	o := 0
	for _, b := range ulaw {
		s := UlawToLinear(b)
		for j := 0; j < 6; j++ {
			out[o] = s
			out[o+1] = s
			o += 2
		}
	}
	return out
}

func EncodePCMU(mono8k []int16) []byte {
	out := make([]byte, len(mono8k))
	for i, s := range mono8k {
		out[i] = LinearToUlaw(s)
	}
	return out
}
