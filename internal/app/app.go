package app

import (
	"sync"

	"golang.org/x/sys/windows"
	"sharescreen/internal/capture"
	"sharescreen/internal/config"
	lk "sharescreen/internal/lk"
	"sharescreen/internal/present"
	"sharescreen/internal/quality"
	"sharescreen/internal/rooms"
	"sharescreen/internal/session"
	"sharescreen/internal/ui"
	"sharescreen/internal/w32"
)

type App struct {
	mu         sync.Mutex
	cfg        config.Config
	sess       *session.Session
	room       string
	sources    []capture.Source
	screens    []session.Screen
	watching   map[string]windows.HWND
	local      *present.Sink
	ui         *ui.UI
	listing    bool
	refreshing bool
	busy       bool
	joinEpoch  uint64
	listEpoch  uint64
}

func Run() {
	a := &App{
		cfg:      config.Load(),
		watching: map[string]windows.HWND{},
	}
	a.sess = session.New(session.Hooks{
		OnStatus:       func(v string) { a.ui.SetPresence(v) },
		OnTracks:       func() { a.refreshTracks() },
		OnError:        func(v string) { a.ui.SetStatus(v) },
		OnSharing:      func(on bool) { a.setSharing(on) },
		OnDisconnected: func() { a.disconnected() },
		OnLocal: func(bgra []byte, w, h int) {
			a.mu.Lock()
			sink := a.local
			a.mu.Unlock()
			if sink != nil {
				sink.Draw(bgra, w, h)
			}
		},
	})
	a.ui = ui.New(a)
	a.ui.Run(a.cfg)
}

func (a *App) Save(cfg config.Config) {
	next, err := config.Save(cfg)
	if err != nil {
		a.ui.SetStatus(err.Error())
		return
	}
	a.mu.Lock()
	a.cfg = next
	a.mu.Unlock()
	a.ui.SetServerURL(next.URL)
	a.ui.SetStatus("Settings saved")
}

func (a *App) Connect(cfg config.Config) {
	next, err := config.Save(cfg)
	if err != nil {
		a.ui.SetStatus(err.Error())
		return
	}
	a.mu.Lock()
	a.cfg = next
	a.listing = true
	a.listEpoch++
	a.mu.Unlock()
	a.ui.SetServerURL(next.URL)
	a.ui.StartListing()
	a.ui.SetStatus("Connecting...")
	a.RefreshRooms()
}

func (a *App) RefreshRooms() {
	a.mu.Lock()
	if !a.listing || a.refreshing {
		a.mu.Unlock()
		return
	}
	a.refreshing = true
	cfg := a.cfg
	epoch := a.listEpoch
	a.mu.Unlock()
	go func() {
		list, err := rooms.List(cfg)
		a.mu.Lock()
		a.refreshing = false
		stale := epoch != a.listEpoch || !a.listing
		inRoom := a.room != ""
		a.mu.Unlock()
		if stale {
			return
		}
		if err != nil {
			// Keep the last successful room list visible during transient
			// network errors. Polling will retry on the next timer tick.
			if !inRoom {
				a.ui.SetStatus(err.Error())
			}
			return
		}
		a.ui.SetRooms(list)
		if !inRoom {
			a.ui.SetStatus("Connected")
		}
	}()
}

func (a *App) CreateRoom(name string) {
	go func() {
		a.mu.Lock()
		cfg := a.cfg
		a.mu.Unlock()
		if _, err := rooms.Create(cfg, name, cfg.DisplayName); err != nil {
			a.ui.SetStatus(err.Error())
			return
		}
		a.ui.ClearNewRoom()
		a.RefreshRooms()
	}()
}

func (a *App) DeleteRoom(name string) {
	go func() {
		a.mu.Lock()
		cfg := a.cfg
		a.mu.Unlock()
		if err := rooms.Delete(cfg, name); err != nil {
			a.ui.SetStatus(err.Error())
			return
		}
		a.RefreshRooms()
	}()
}

func (a *App) Join(roomName string) {
	a.mu.Lock()
	if a.busy {
		a.mu.Unlock()
		return
	}
	a.busy = true
	a.joinEpoch++
	epoch := a.joinEpoch
	cfg := a.cfg
	a.mu.Unlock()
	go func() {
		defer func() {
			a.mu.Lock()
			a.busy = false
			a.mu.Unlock()
		}()
		display, err := config.RequireDisplayName(cfg.DisplayName)
		if err != nil {
			a.ui.SetStatus(err.Error())
			return
		}
		room, err := config.RequireRoom(roomName)
		if err != nil {
			a.ui.SetStatus(err.Error())
			return
		}
		a.ui.SetStatus("Joining " + room + "...")
		server, err := lk.Connect(cfg)
		if err != nil {
			a.ui.SetStatus(err.Error())
			return
		}
		token, _, err := lk.MemberToken(server, room, display)
		if err != nil {
			a.ui.SetStatus(err.Error())
			return
		}
		if err := a.sess.Join(server.SignalURL, token); err != nil {
			a.mu.Lock()
			stale := a.joinEpoch != epoch
			a.mu.Unlock()
			if !stale {
				a.ui.SetStatus(err.Error())
			}
			return
		}
		a.mu.Lock()
		if a.joinEpoch != epoch {
			a.mu.Unlock()
			a.sess.Leave()
			return
		}
		a.room = room
		a.mu.Unlock()
		a.ui.SetInRoom(room)
		a.refreshTracks()
	}()
}

func (a *App) Leave() {
	a.mu.Lock()
	a.joinEpoch++
	a.room = ""
	a.watching = map[string]windows.HWND{}
	a.local = nil
	a.mu.Unlock()
	a.ui.SetInRoom("")
	a.ui.ClearPanes()
	// Disconnecting WebRTC and stopping native capture can wait on network and
	// driver callbacks. Never make the Win32 window procedure wait for them.
	go a.sess.Leave()
}

func (a *App) OpenShare() {
	a.sources = capture.List()
	a.ui.ShowShare(a.sources)
}

func (a *App) StartShare(sourceID string, res quality.Res, fps, bitrateBps int, dynamic, withAudio bool) {
	var src capture.Source
	found := false
	for _, s := range a.sources {
		if s.ID == sourceID {
			src = s
			found = true
			break
		}
	}
	if !found {
		a.ui.SetStatus("Choose a screen or window")
		return
	}
	p := quality.Lookup(res, fps)
	w, h := p.Width, p.Height
	bps := bitrateBps
	if dynamic {
		bps = p.Fixed
	} else {
		if bps < p.Min {
			bps = p.Min
		}
		if bps > p.Max {
			bps = p.Max
		}
	}
	hwnd := a.ui.EnsureLocalPane()
	a.mu.Lock()
	a.local = present.New(hwnd)
	a.mu.Unlock()
	a.sess.SetLocalPreview(true)
	a.ui.LayoutPanes()
	hiddenFromCapture := a.ui.SetCaptureExcluded(true)
	a.ui.SetSharing(true)
	if hiddenFromCapture || src.Kind != capture.KindScreen {
		a.ui.SetStatus("Sharing")
	} else {
		a.ui.SetStatus("Sharing; this Windows version may include the app window in the capture")
	}
	go func() {
		err := a.sess.Share(session.ShareOptions{
			Source:  src,
			Width:   w,
			Height:  h,
			FPS:     p.FPS,
			Bitrate: bps,
			Audio:   withAudio,
		})
		if err != nil {
			a.setSharing(false)
			a.ui.SetStatus(err.Error())
			return
		}
		note := a.sess.FPSNote()
		if note != "" {
			a.ui.SetStatus(note)
		}
	}()
}

func (a *App) StopShare() {
	a.ui.SetStatus("Stopping share...")
	// StopShare waits for capture, audio, encoder, and unpublish cleanup. Keep
	// that work off the UI thread so the app remains responsive if a driver or
	// the server is slow.
	go func() {
		a.sess.StopShare()
		a.setSharing(false)
		a.ui.SetStatus("Share stopped")
	}()
}

func (a *App) SetLocalPreview(on bool) {
	if !on {
		a.sess.SetLocalPreview(false)
		a.mu.Lock()
		a.local = nil
		a.mu.Unlock()
		a.ui.RemoveLocalPane()
		return
	}

	hwnd := a.ui.EnsureLocalPane()
	a.mu.Lock()
	a.local = present.New(hwnd)
	a.mu.Unlock()
	a.sess.SetLocalPreview(true)
	a.ui.LayoutPanes()
}

func (a *App) SetWatch(sid string, on bool) {
	if on {
		hwnd := a.ui.EnsurePane(sid)
		// Register intent before subscribing so a near-simultaneous
		// publication-ended callback can reconcile and close this pane.
		a.mu.Lock()
		a.watching[sid] = hwnd
		a.mu.Unlock()
		if err := a.sess.Watch(sid, hwnd); err != nil {
			a.mu.Lock()
			delete(a.watching, sid)
			a.mu.Unlock()
			a.ui.SetStatus(err.Error())
			a.ui.RemovePane(sid)
			return
		}
		return
	}
	a.mu.Lock()
	delete(a.watching, sid)
	a.mu.Unlock()
	a.sess.Unwatch(sid)
	a.ui.RemovePane(sid)
}

func (a *App) SetMute(sid string, mute bool) {
	a.sess.SetMute(sid, mute)
}

func (a *App) Paint(hwnd windows.HWND) {
	a.mu.Lock()
	local := a.local
	a.mu.Unlock()
	if local != nil && local.Handle() == hwnd {
		local.Paint()
		return
	}
	if a.sess.Paint(hwnd) {
		return
	}
	var ps w32.PaintStruct
	hdc := w32.BeginPaint(hwnd, &ps)
	if hdc != 0 {
		w32.EndPaint(hwnd, &ps)
	}
}

func (a *App) refreshTracks() {
	screens := a.sess.Screens()
	available := make(map[string]struct{}, len(screens))
	for _, screen := range screens {
		available[screen.SID] = struct{}{}
	}
	a.mu.Lock()
	a.screens = screens
	var ended []string
	for sid := range a.watching {
		if _, ok := available[sid]; !ok {
			ended = append(ended, sid)
			delete(a.watching, sid)
		}
	}
	a.mu.Unlock()
	for _, sid := range ended {
		// The publication may already be gone. Unwatch is generation-safe and
		// still closes any decoder and audio state left behind for that SID.
		a.sess.Unwatch(sid)
	}
	a.ui.SetTracks(screens)
}

func (a *App) setSharing(on bool) {
	a.ui.SetCaptureExcluded(on)
	if !on {
		a.mu.Lock()
		a.local = nil
		a.mu.Unlock()
	}
	a.ui.SetSharing(on)
}

func (a *App) disconnected() {
	a.mu.Lock()
	a.joinEpoch++
	a.room = ""
	a.watching = map[string]windows.HWND{}
	a.local = nil
	a.mu.Unlock()
	a.ui.SetInRoom("")
	a.ui.SetCaptureExcluded(false)
	a.ui.SetSharing(false)
	a.ui.SetTracks(nil)
	a.ui.ClearPanes()
}
