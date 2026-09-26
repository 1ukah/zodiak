package audio

import (
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

type handlerVtbl struct {
	queryInterface    uintptr
	addRef            uintptr
	release           uintptr
	activateCompleted uintptr
}

type activationHandler struct {
	vtbl   *handlerVtbl
	refs   int32
	done   chan uintptr
	once   sync.Once
	pinned *activationHandler
}

func newActivationHandler() *activationHandler {
	h := &activationHandler{done: make(chan uintptr, 1), refs: 1}
	h.vtbl = &handlerVtbl{
		queryInterface:    syscall.NewCallback(handlerQI),
		addRef:            syscall.NewCallback(handlerAddRef),
		release:           syscall.NewCallback(handlerRelease),
		activateCompleted: syscall.NewCallback(handlerDone),
	}
	h.pinned = h
	return h
}

func (h *activationHandler) ptr() uintptr {
	return uintptr(unsafe.Pointer(h))
}

func (h *activationHandler) wait() uintptr {
	select {
	case client := <-h.done:
		return client
	case <-time.After(8 * time.Second):
		return 0
	}
}

func handlerQI(this uintptr, riid *guid, ppv *uintptr) uintptr {
	if ppv == nil {
		return 0x80004003
	}
	id := *riid
	if id == iidUnknown || id == iidAgile || id == iidActivate {
		*ppv = this
		handlerAddRef(this)
		return 0
	}
	*ppv = 0
	return 0x80004002
}

func handlerAddRef(this uintptr) uintptr {
	h := (*activationHandler)(unsafe.Pointer(this))
	return uintptr(atomicAdd(&h.refs, 1))
}

func handlerRelease(this uintptr) uintptr {
	h := (*activationHandler)(unsafe.Pointer(this))
	n := atomicAdd(&h.refs, -1)
	return uintptr(n)
}

func handlerDone(this uintptr, op uintptr) uintptr {
	h := (*activationHandler)(unsafe.Pointer(this))
	var hr uintptr
	var unk uintptr
	call(op, 3, uintptr(unsafe.Pointer(&hr)), uintptr(unsafe.Pointer(&unk)))
	client := uintptr(0)
	if hr == 0 && unk != 0 {
		if call(unk, 0, uintptr(unsafe.Pointer(&iidAudioClient)), uintptr(unsafe.Pointer(&client))) != 0 {
			client = unk
		} else {
			release(unk)
		}
	}
	h.once.Do(func() {
		h.done <- client
	})
	return 0
}

func atomicAdd(p *int32, d int32) int32 {
	return atomic.AddInt32(p, d)
}
