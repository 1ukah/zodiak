package audio

import "sync"

const maxBufferedSamples = 48_000 * 2 * 3 // at most three seconds per source

type Mixer struct {
	mu      sync.Mutex
	buffers map[string][]int16
	muted   map[string]bool
}

func NewMixer() *Mixer {
	return &Mixer{buffers: map[string][]int16{}, muted: map[string]bool{}}
}

func (m *Mixer) Push(id string, pcm []int16) {
	if len(pcm) == 0 {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	buf := append(m.buffers[id], pcm...)
	if len(buf) > maxBufferedSamples {
		// Keep the newest audio. This bounds memory when playback is unavailable
		// or a remote sender runs faster than the output device.
		buf = append([]int16(nil), buf[len(buf)-maxBufferedSamples:]...)
	}
	m.buffers[id] = buf
}

func (m *Mixer) SetMute(id string, mute bool) {
	m.mu.Lock()
	m.muted[id] = mute
	m.mu.Unlock()
}

func (m *Mixer) Remove(id string) {
	m.mu.Lock()
	delete(m.buffers, id)
	delete(m.muted, id)
	m.mu.Unlock()
}

func (m *Mixer) Pull(frames int) []int16 {
	n := frames * 2
	mix := make([]int32, n)
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, buf := range m.buffers {
		if m.muted[id] || len(buf) == 0 {
			continue
		}
		take := n
		if take > len(buf) {
			take = len(buf)
		}
		for i := 0; i < take; i++ {
			mix[i] += int32(buf[i])
		}
		m.buffers[id] = buf[take:]
	}
	out := make([]int16, n)
	for i, v := range mix {
		if v > 32767 {
			v = 32767
		}
		if v < -32768 {
			v = -32768
		}
		out[i] = int16(v)
	}
	return out
}
