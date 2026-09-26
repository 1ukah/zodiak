package audio

import (
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

func discordPID() uint32 {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return 0
	}
	defer windows.CloseHandle(snap)
	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Process32First(snap, &entry); err != nil {
		return 0
	}
	type info struct {
		pid    uint32
		parent uint32
		name   string
	}
	var all []info
	for {
		name := strings.ToLower(windows.UTF16ToString(entry.ExeFile[:]))
		all = append(all, info{pid: entry.ProcessID, parent: entry.ParentProcessID, name: name})
		if windows.Process32Next(snap, &entry) != nil {
			break
		}
	}
	discord := map[uint32]bool{}
	for _, p := range all {
		if p.name == "discord.exe" {
			discord[p.pid] = true
		}
	}
	var best uint32
	var bestScore int64 = -1
	for _, p := range all {
		if !discord[p.pid] {
			continue
		}
		if discord[p.parent] {
			continue
		}
		if isRenderer(p.pid) {
			continue
		}
		var score int64
		if sz, path := processScore(p.pid); true {
			score += sz
			if strings.Contains(strings.ToLower(path), `\app-`) {
				score += 1 << 61
			}
		}
		if hasWindow(p.pid) {
			score += 1 << 62
		}
		if score > bestScore {
			bestScore = score
			best = p.pid
		}
	}
	return best
}

func isRenderer(pid uint32) bool {
	cmd := commandLine(pid)
	return strings.Contains(strings.ToLower(cmd), "--type=")
}

func commandLine(pid uint32) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	buf := make([]uint16, 512)
	n := uint32(len(buf))
	proc := windows.NewLazySystemDLL("kernel32.dll").NewProc("QueryFullProcessImageNameW")
	r, _, _ := proc.Call(uintptr(h), 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&n)))
	if r == 0 {
		return ""
	}
	return windows.UTF16ToString(buf)
}

func processScore(pid uint32) (int64, string) {
	path := commandLine(pid)
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return 0, path
	}
	defer windows.CloseHandle(h)
	var pmc struct {
		Cb                 uint32
		PageFaultCount     uint32
		PeakWorkingSetSize uintptr
		WorkingSetSize     uintptr
		QuotaPeakPaged     uintptr
		QuotaPaged         uintptr
		QuotaPeakNonPaged  uintptr
		QuotaNonPaged      uintptr
		PagefileUsage      uintptr
		PeakPagefileUsage  uintptr
	}
	pmc.Cb = uint32(unsafe.Sizeof(pmc))
	psapi := windows.NewLazySystemDLL("psapi.dll").NewProc("GetProcessMemoryInfo")
	psapi.Call(uintptr(h), uintptr(unsafe.Pointer(&pmc)), uintptr(pmc.Cb))
	return int64(pmc.WorkingSetSize), path
}

func hasWindow(pid uint32) bool {
	found := false
	cb := syscall.NewCallback(func(hwnd windows.HWND, lparam uintptr) uintptr {
		var got uint32
		windows.GetWindowThreadProcessId(hwnd, &got)
		if got == pid && windows.IsWindowVisible(hwnd) {
			found = true
			return 0
		}
		return 1
	})
	windows.NewLazySystemDLL("user32.dll").NewProc("EnumWindows").Call(cb, 0)
	return found
}

func activateExclude(pid uint32) (uintptr, error) {
	type params struct {
		ActivationType      int32
		TargetProcessID     uint32
		ProcessLoopbackMode int32
	}
	p := params{ActivationType: 1, TargetProcessID: pid, ProcessLoopbackMode: 1}
	blob, _, _ := procLocalAlloc.Call(0x0040, unsafe.Sizeof(p))
	if blob == 0 {
		return 0, syscall.ENOMEM
	}
	defer procLocalFree.Call(blob)
	*(*params)(unsafe.Pointer(blob)) = p
	type propBlob struct {
		cbSize    uint32
		pBlobData uintptr
	}
	type propVariant struct {
		vt         uint16
		r1, r2, r3 uint16
		blob       propBlob
	}
	pv := propVariant{vt: 65}
	pv.blob.cbSize = uint32(unsafe.Sizeof(p))
	pv.blob.pBlobData = blob
	variant, _, _ := procLocalAlloc.Call(0x0040, unsafe.Sizeof(pv))
	if variant == 0 {
		return 0, syscall.ENOMEM
	}
	defer procLocalFree.Call(variant)
	*(*propVariant)(unsafe.Pointer(variant)) = pv

	h := newActivationHandler()
	name, _ := windows.UTF16PtrFromString(`VAD\Process_Loopback`)
	var op uintptr
	hr, _, _ := procActivateAudioInterfaceAsync.Call(
		uintptr(unsafe.Pointer(name)),
		uintptr(unsafe.Pointer(&iidAudioClient)),
		variant,
		h.ptr(),
		uintptr(unsafe.Pointer(&op)),
	)
	if hr != 0 {
		return 0, syscall.Errno(hr)
	}
	client := h.wait()
	release(op)
	if client == 0 {
		return 0, syscall.EINVAL
	}
	return client, nil
}
