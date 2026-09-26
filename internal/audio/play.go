package audio

import (
	"errors"
	"runtime"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

type Player struct {
	client uintptr
	render uintptr
	event  windows.Handle
	stop   chan struct{}
	done   chan struct{}
	once   sync.Once
	mixer  *Mixer
}

func OpenPlayer(mixer *Mixer) (*Player, error) {
	CoInit()
	var enum uintptr
	r, _, _ := procCoCreateInstance.Call(
		uintptr(unsafe.Pointer(&clsidEnumerator)),
		0,
		uintptr(clsctxAll),
		uintptr(unsafe.Pointer(&iidEnumerator)),
		uintptr(unsafe.Pointer(&enum)),
	)
	if r != 0 || enum == 0 {
		return nil, errors.New("could not open playback")
	}
	defer release(enum)
	var device uintptr
	if call(enum, 4, eRender, eConsole, uintptr(unsafe.Pointer(&device))) != 0 || device == 0 {
		return nil, errors.New("could not open playback")
	}
	defer release(device)
	var client uintptr
	if call(device, 3, uintptr(unsafe.Pointer(&iidAudioClient)), clsctxAll, 0, uintptr(unsafe.Pointer(&client))) != 0 || client == 0 {
		return nil, errors.New("could not open playback")
	}
	format := pcmFormat()
	flags := uint32(0x00040000 | 0x80000000)
	if call(client, 3, shareShared, uintptr(flags), 0, 0, uintptr(unsafe.Pointer(&format)), 0) != 0 {
		release(client)
		return nil, errors.New("could not open playback")
	}
	ev, _, err := procCreateEventW.Call(0, 0, 0, 0)
	if ev == 0 {
		release(client)
		return nil, err
	}
	if call(client, 13, ev) != 0 {
		procCloseHandle.Call(ev)
		release(client)
		return nil, errors.New("could not open playback")
	}
	var render uintptr
	if call(client, 14, uintptr(unsafe.Pointer(&iidRender)), uintptr(unsafe.Pointer(&render))) != 0 || render == 0 {
		procCloseHandle.Call(ev)
		release(client)
		return nil, errors.New("could not open playback")
	}
	var bufferFrames uint32
	if call(client, 4, uintptr(unsafe.Pointer(&bufferFrames))) != 0 || bufferFrames == 0 {
		release(render)
		procCloseHandle.Call(ev)
		release(client)
		return nil, errors.New("could not open playback")
	}
	if call(client, 10) != 0 {
		release(render)
		procCloseHandle.Call(ev)
		release(client)
		return nil, errors.New("could not open playback")
	}
	p := &Player{
		client: client,
		render: render,
		event:  windows.Handle(ev),
		stop:   make(chan struct{}),
		done:   make(chan struct{}),
		mixer:  mixer,
	}
	go p.loop(bufferFrames)
	return p, nil
}

func (p *Player) Close() {
	p.once.Do(func() {
		close(p.stop)
		if p.event != 0 {
			procSetEvent.Call(uintptr(p.event))
		}
		if p.done != nil {
			<-p.done
		}
		if p.client != 0 {
			call(p.client, 11)
		}
		release(p.render)
		release(p.client)
		p.render = 0
		p.client = 0
		if p.event != 0 {
			procCloseHandle.Call(uintptr(p.event))
			p.event = 0
		}
	})
}

func (p *Player) loop(bufferFrames uint32) {
	defer close(p.done)
	runtime.LockOSThread()
	CoInit()
	for {
		select {
		case <-p.stop:
			return
		default:
		}
		procWaitForSingleObject.Call(uintptr(p.event), 200)
		select {
		case <-p.stop:
			return
		default:
		}
		var padding uint32
		if call(p.client, 6, uintptr(unsafe.Pointer(&padding))) != 0 {
			continue
		}
		if padding >= bufferFrames {
			continue
		}
		avail := int(bufferFrames - padding)
		if avail <= 0 {
			continue
		}
		pcm := p.mixer.Pull(avail)
		var dest uintptr
		if call(p.render, 3, uintptr(avail), uintptr(unsafe.Pointer(&dest))) != 0 || dest == 0 {
			continue
		}
		out := unsafe.Slice((*int16)(unsafe.Pointer(dest)), avail*2)
		copy(out, pcm)
		call(p.render, 4, uintptr(avail), 0)
	}
}
