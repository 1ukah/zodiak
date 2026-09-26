package ui

import (
	"runtime"
	"strconv"
	"sync"

	"golang.org/x/sys/windows"
	"sharescreen/internal/capture"
	"sharescreen/internal/config"
	"sharescreen/internal/quality"
	"sharescreen/internal/rooms"
	"sharescreen/internal/session"
	"sharescreen/internal/w32"
)

const (
	idName     = 101
	idURL      = 102
	idKey      = 103
	idSecret   = 104
	idSave     = 105
	idNewRoom  = 106
	idCreate   = 107
	idRooms    = 108
	idJoin     = 109
	idDelete   = 110
	idTracks   = 111
	idShare    = 112
	idStop     = 113
	idLeave    = 114
	idStatus   = 115
	idPresence = 116
	idConnect  = 117
	idPreview  = 118
	idSources  = 201
	idRes      = 202
	idFPS      = 203
	idBitrate  = 204
	idAudio    = 205
	idGoLive   = 206
	idCancel   = 207
	idDynamic  = 208
	idMuteBase = 400

	msgStatus     = w32.WM_APP + 1
	msgPresence   = w32.WM_APP + 2
	msgRooms      = w32.WM_APP + 3
	msgTracks     = w32.WM_APP + 4
	msgInRoom     = w32.WM_APP + 5
	msgSharing    = w32.WM_APP + 6
	msgClearNew   = w32.WM_APP + 7
	msgClearPanes = w32.WM_APP + 8
)

type Host interface {
	Save(cfg config.Config)
	Connect(cfg config.Config)
	RefreshRooms()
	CreateRoom(name string)
	DeleteRoom(name string)
	Join(room string)
	Leave()
	OpenShare()
	StartShare(sourceID string, res quality.Res, fps, bitrate int, dynamic, audio bool)
	StopShare()
	SetLocalPreview(on bool)
	SetWatch(sid string, on bool)
	SetMute(sid string, mute bool)
	Paint(hwnd windows.HWND)
}

type pane struct {
	sid   string
	host  windows.HWND
	video windows.HWND
	mute  windows.HWND
}

type UI struct {
	host     Host
	hwnd     windows.HWND
	name     windows.HWND
	url      windows.HWND
	key      windows.HWND
	secret   windows.HWND
	newRoom  windows.HWND
	rooms    windows.HWND
	tracks   windows.HWND
	share    windows.HWND
	stop     windows.HWND
	leave    windows.HWND
	preview  windows.HWND
	status   windows.HWND
	presence windows.HWND
	stage    windows.HWND
	join     windows.HWND
	del      windows.HWND
	save     windows.HWND
	connect  windows.HWND
	create   windows.HWND
	listing  bool

	dlg        windows.HWND
	dlgSources windows.HWND
	dlgRes     windows.HWND
	dlgFPS     windows.HWND
	dlgBitrate windows.HWND
	dlgRateLbl windows.HWND
	dlgDynamic windows.HWND
	dlgAudio   windows.HWND
	sourceIDs  []string

	mu        sync.Mutex
	statusT   string
	presenceT string
	roomList  []rooms.Summary
	trackList []session.Screen
	inRoom    string
	sharing   bool
	panes     []pane
	local     pane
	ignore    bool
}

var (
	uis    sync.Map
	videos sync.Map
)

func New(host Host) *UI {
	return &UI{host: host}
}

func (u *UI) Run(cfg config.Config) {
	// A Win32 window and the message queue that services it belong to the OS
	// thread that created them. Go goroutines may otherwise move between OS
	// threads after any syscall, leaving the window without a message pump and
	// making Windows report the process as AppHangB1.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	w32.InitCommon()
	mainProc := w32.NewCallback(mainWnd)
	videoProc := w32.NewCallback(videoWnd)
	_ = w32.RegisterClass("WelfareOfficeMain", mainProc, w32.COLOR_BTNFACE)
	_ = w32.RegisterClass("WelfareOfficeVideo", videoProc, w32.COLOR_WINDOW)
	u.hwnd = w32.Create(w32.WS_EX_APPWINDOW, w32.WS_OVERLAPPEDWINDOW|w32.WS_VISIBLE|w32.WS_CLIPCHILDREN, "WelfareOfficeMain", "Welfare Office", 80, 40, 1180, 780, 0, 0)
	uis.Store(u.hwnd, u)
	u.build(cfg)
	w32.Show(u.hwnd, w32.SW_SHOW)
	w32.Update(u.hwnd)
	w32.Loop()
}

func (u *UI) build(cfg config.Config) {
	u.presence = label(u.hwnd, idPresence, "offline", 10, 10, 320, 18)
	label(u.hwnd, 0, "Name", 10, 34, 320, 16)
	u.name = edit(u.hwnd, idName, cfg.DisplayName, 10, 52, 320, 22)
	label(u.hwnd, 0, "LiveKit URL", 10, 80, 320, 16)
	u.url = edit(u.hwnd, idURL, cfg.URL, 10, 98, 320, 22)
	label(u.hwnd, 0, "API key", 10, 126, 320, 16)
	u.key = edit(u.hwnd, idKey, cfg.APIKey, 10, 144, 320, 22)
	label(u.hwnd, 0, "API secret", 10, 172, 320, 16)
	u.secret = w32.Create(w32.WS_EX_CLIENTEDGE, w32.WS_CHILD|w32.WS_VISIBLE|w32.WS_TABSTOP|w32.ES_AUTOHSCROLL|w32.ES_PASSWORD, "EDIT", cfg.APISecret, 10, 190, 320, 22, u.hwnd, idSecret)
	w32.Font(u.secret)
	u.save = button(u.hwnd, idSave, "Save settings", 10, 220, 154, 28)
	u.connect = button(u.hwnd, idConnect, "Connect", 176, 220, 154, 28)
	label(u.hwnd, 0, "New room", 10, 258, 320, 16)
	u.newRoom = edit(u.hwnd, idNewRoom, "", 10, 276, 210, 22)
	u.create = button(u.hwnd, idCreate, "Create", 226, 274, 104, 26)
	u.rooms = w32.Create(w32.WS_EX_CLIENTEDGE, w32.WS_CHILD|w32.WS_VISIBLE|w32.WS_VSCROLL|w32.LBS_NOTIFY|w32.LBS_NOINTEGRALHEIGHT, "LISTBOX", "", 10, 308, 320, 150, u.hwnd, idRooms)
	w32.Font(u.rooms)
	u.join = button(u.hwnd, idJoin, "Join", 10, 464, 154, 28)
	u.del = button(u.hwnd, idDelete, "Delete", 176, 464, 154, 28)
	u.tracks = w32.Create(0, w32.WS_CHILD|w32.WS_VISIBLE|w32.LVS_REPORT|w32.LVS_SINGLESEL|w32.LVS_SHOWSELALWAYS|w32.WS_BORDER, "SysListView32", "", 10, 500, 320, 140, u.hwnd, idTracks)
	w32.Font(u.tracks)
	w32.LvSetExtended(u.tracks, w32.LVS_EX_CHECKBOXES|w32.LVS_EX_FULLROWSELECT)
	w32.LvInsertColumn(u.tracks, 0, "Watch", 54)
	w32.LvInsertColumn(u.tracks, 1, "Sharer", 250)
	u.share = button(u.hwnd, idShare, "Share", 10, 646, 100, 28)
	u.stop = button(u.hwnd, idStop, "Stop", 116, 646, 100, 28)
	u.leave = button(u.hwnd, idLeave, "Leave", 222, 646, 108, 28)
	u.preview = button(u.hwnd, idPreview, "Hide own preview", 10, 680, 320, 26)
	u.status = label(u.hwnd, idStatus, "", 10, 710, 320, 24)
	u.stage = w32.Create(w32.WS_EX_CLIENTEDGE, w32.WS_CHILD|w32.WS_VISIBLE|w32.WS_CLIPCHILDREN, "STATIC", "", 340, 10, 810, 700, u.hwnd, 0)
	u.setSharing(false)
	u.setInRoom("")
	w32.SetText(u.status, "Click Connect to reach LiveKit")
}

func (u *UI) SetStatus(text string) {
	u.mu.Lock()
	u.statusT = text
	u.mu.Unlock()
	w32.Post(u.hwnd, msgStatus, 0, 0)
}

func (u *UI) SetPresence(text string) {
	u.mu.Lock()
	u.presenceT = text
	u.mu.Unlock()
	w32.Post(u.hwnd, msgPresence, 0, 0)
}

func (u *UI) SetRooms(list []rooms.Summary) {
	u.mu.Lock()
	u.roomList = append([]rooms.Summary(nil), list...)
	u.mu.Unlock()
	w32.Post(u.hwnd, msgRooms, 0, 0)
}

func (u *UI) SetTracks(list []session.Screen) {
	u.mu.Lock()
	u.trackList = append([]session.Screen(nil), list...)
	u.mu.Unlock()
	w32.Post(u.hwnd, msgTracks, 0, 0)
}

func (u *UI) SetInRoom(name string) {
	u.mu.Lock()
	u.inRoom = name
	u.mu.Unlock()
	w32.Post(u.hwnd, msgInRoom, 0, 0)
}

func (u *UI) SetSharing(on bool) {
	u.mu.Lock()
	u.sharing = on
	u.mu.Unlock()
	w32.Post(u.hwnd, msgSharing, 0, 0)
}

func (u *UI) ClearNewRoom() {
	w32.Post(u.hwnd, msgClearNew, 0, 0)
}

func (u *UI) SetServerURL(url string) {
	if u.url != 0 {
		w32.SetText(u.url, url)
	}
}

func (u *UI) SetCaptureExcluded(exclude bool) bool {
	return w32.SetWindowDisplayAffinity(u.hwnd, exclude)
}

func (u *UI) StartListing() {
	u.listing = true
	// Keep room counts and live status current even while connected to a room.
	w32.SetTimer(u.hwnd, 1, 5000)
}

func (u *UI) ShowShare(sources []capture.Source) {
	if u.dlg != 0 {
		w32.Destroy(u.dlg)
	}
	u.sourceIDs = nil
	u.dlg = w32.Create(w32.WS_EX_DLGMODALFRAME, w32.WS_CAPTION|w32.WS_SYSMENU|w32.WS_POPUP|w32.WS_VISIBLE, "WelfareOfficeMain", "Share screen", 200, 80, 520, 620, u.hwnd, 0)
	uis.Store(u.dlg, u)
	label(u.dlg, 0, "Screen or window", 12, 12, 480, 16)
	u.dlgSources = w32.Create(w32.WS_EX_CLIENTEDGE, w32.WS_CHILD|w32.WS_VISIBLE|w32.WS_VSCROLL|w32.LBS_NOTIFY|w32.LBS_NOINTEGRALHEIGHT, "LISTBOX", "", 12, 32, 480, 260, u.dlg, idSources)
	w32.Font(u.dlgSources)
	for _, src := range sources {
		w32.ListAdd(u.dlgSources, src.Name)
		u.sourceIDs = append(u.sourceIDs, src.ID)
	}
	label(u.dlg, 0, "Resolution", 12, 304, 220, 16)
	u.dlgRes = w32.Create(0, w32.WS_CHILD|w32.WS_VISIBLE|w32.CBS_DROPDOWNLIST|w32.WS_TABSTOP, "COMBOBOX", "", 12, 322, 220, 160, u.dlg, idRes)
	w32.Font(u.dlgRes)
	for _, t := range quality.Labels() {
		w32.ComboAdd(u.dlgRes, t)
	}
	w32.ComboSet(u.dlgRes, int(quality.Res1080))
	label(u.dlg, 0, "FPS", 250, 304, 242, 16)
	u.dlgFPS = w32.Create(0, w32.WS_CHILD|w32.WS_VISIBLE|w32.CBS_DROPDOWNLIST|w32.WS_TABSTOP, "COMBOBOX", "", 250, 322, 242, 160, u.dlg, idFPS)
	w32.Font(u.dlgFPS)
	u.dlgRateLbl = label(u.dlg, 0, "Bitrate", 12, 360, 480, 16)
	u.dlgBitrate = w32.Create(0, w32.WS_CHILD|w32.WS_VISIBLE|w32.WS_TABSTOP, "msctls_trackbar32", "", 12, 378, 480, 32, u.dlg, idBitrate)
	u.dlgDynamic = w32.Create(0, w32.WS_CHILD|w32.WS_VISIBLE|w32.BS_AUTOCHECKBOX, "BUTTON", "Dynamic bitrate", 12, 418, 480, 22, u.dlg, idDynamic)
	w32.Font(u.dlgDynamic)
	w32.SetChecked(u.dlgDynamic, true)
	u.dlgAudio = w32.Create(0, w32.WS_CHILD|w32.WS_VISIBLE|w32.BS_AUTOCHECKBOX, "BUTTON", "Share system audio (except Discord)", 12, 446, 480, 22, u.dlg, idAudio)
	w32.Font(u.dlgAudio)
	w32.SetChecked(u.dlgAudio, true)
	button(u.dlg, idGoLive, "Go live", 12, 484, 230, 32)
	button(u.dlg, idCancel, "Cancel", 262, 484, 230, 32)
	u.fillFPS(30)
	u.syncShareBitrate()
}

func (u *UI) EnsurePane(sid string) windows.HWND {
	for _, p := range u.panes {
		if p.sid == sid {
			return p.video
		}
	}
	p := u.makePane(sid, false)
	u.panes = append(u.panes, p)
	u.layoutPanes()
	return p.video
}

func (u *UI) EnsureLocalPane() windows.HWND {
	if u.local.video != 0 {
		return u.local.video
	}
	u.local = u.makePane("local", true)
	w32.SetText(u.preview, "Hide own preview")
	return u.local.video
}

func (u *UI) RemoveLocalPane() {
	if u.local.host != 0 {
		w32.Destroy(u.local.host)
		videos.Delete(u.local.video)
		u.local = pane{}
	}
	w32.SetText(u.preview, "Show own preview")
	u.layoutPanes()
}

func (u *UI) LayoutPanes() {
	u.layoutPanes()
}

func (u *UI) RemovePane(sid string) {
	var next []pane
	for _, p := range u.panes {
		if p.sid == sid {
			w32.Destroy(p.host)
			videos.Delete(p.video)
			continue
		}
		next = append(next, p)
	}
	u.panes = next
	u.layoutPanes()
}

func (u *UI) ClearPanes() {
	w32.Post(u.hwnd, msgClearPanes, 0, 0)
}

func (u *UI) clearPanes() {
	for _, p := range u.panes {
		w32.Destroy(p.host)
		videos.Delete(p.video)
	}
	u.panes = nil
	if u.local.host != 0 {
		w32.Destroy(u.local.host)
		videos.Delete(u.local.video)
		u.local = pane{}
	}
}

func (u *UI) makePane(sid string, local bool) pane {
	title := sid
	if local {
		title = "You"
	}
	host := w32.Create(0, w32.WS_CHILD|w32.WS_VISIBLE|w32.WS_BORDER|w32.WS_CLIPCHILDREN, "STATIC", "", 0, 0, 200, 160, u.stage, 0)
	video := w32.Create(0, w32.WS_CHILD|w32.WS_VISIBLE, "WelfareOfficeVideo", title, 0, 0, 200, 130, host, 0)
	mute := windows.HWND(0)
	if !local {
		mute = w32.Create(0, w32.WS_CHILD|w32.WS_VISIBLE|w32.BS_AUTOCHECKBOX, "BUTTON", "Mute", 4, 132, 80, 22, host, uintptr(idMuteBase))
		w32.Font(mute)
	}
	videos.Store(video, u)
	return pane{sid: sid, host: host, video: video, mute: mute}
}

func (u *UI) layoutPanes() {
	r := w32.ClientRect(u.stage)
	var all []pane
	if u.local.host != 0 {
		all = append(all, u.local)
	}
	all = append(all, u.panes...)
	n := len(all)
	if n == 0 {
		return
	}
	cols := 1
	if n > 1 {
		cols = 2
	}
	if n > 4 {
		cols = 3
	}
	rows := (n + cols - 1) / cols
	pw := int(r.Right) / cols
	ph := int(r.Bottom) / rows
	for i, p := range all {
		x := int32((i % cols) * pw)
		y := int32((i / cols) * ph)
		w32.Move(p.host, x, y, int32(pw)-4, int32(ph)-4)
		if p.mute != 0 {
			w32.Move(p.video, 0, 0, int32(pw)-8, int32(ph)-32)
			w32.Move(p.mute, 4, int32(ph)-30, 80, 22)
		} else {
			w32.Move(p.video, 0, 0, int32(pw)-8, int32(ph)-8)
		}
	}
}

func (u *UI) applyRooms() {
	sel := u.selectedRoom()
	w32.ListClear(u.rooms)
	u.mu.Lock()
	list := u.roomList
	u.mu.Unlock()
	for _, r := range list {
		state := "idle"
		if r.Sharing {
			state = "live"
		}
		w32.ListAdd(u.rooms, r.Name+"  ("+itoa(int(r.Participants))+" · "+state+")")
	}
	if sel != "" {
		for i, r := range list {
			if r.Name == sel {
				w32.Send(u.rooms, w32.LB_SETCURSEL, uintptr(i), 0)
			}
		}
	}
}

func (u *UI) applyTracks() {
	u.mu.Lock()
	list := u.trackList
	u.mu.Unlock()
	available := make(map[string]struct{}, len(list))
	for _, track := range list {
		available[track.SID] = struct{}{}
	}
	// A removed publication must not leave its old last frame on screen.
	// Track updates are applied on the UI thread, so child windows can be
	// destroyed here without racing the Win32 message pump.
	kept := u.panes[:0]
	removed := false
	for _, p := range u.panes {
		if _, ok := available[p.sid]; !ok {
			removed = true
			w32.Destroy(p.host)
			videos.Delete(p.video)
			continue
		}
		kept = append(kept, p)
	}
	u.panes = kept
	u.ignore = true
	w32.LvClear(u.tracks)
	checked := map[string]bool{}
	for _, p := range u.panes {
		checked[p.sid] = true
	}
	for i, t := range list {
		w32.LvInsert(u.tracks, i, "", 0)
		w32.LvSetText(u.tracks, i, 1, t.Name)
		if checked[t.SID] {
			w32.LvSetChecked(u.tracks, i, true)
		}
	}
	u.ignore = false
	if removed {
		u.layoutPanes()
	}
}

func (u *UI) selectedRoom() string {
	u.mu.Lock()
	list := u.roomList
	u.mu.Unlock()
	i := w32.ListSel(u.rooms)
	if i < 0 || i >= len(list) {
		return ""
	}
	return list[i].Name
}

func (u *UI) selectedSource() string {
	i := w32.ListSel(u.dlgSources)
	if i < 0 || i >= len(u.sourceIDs) {
		return ""
	}
	return u.sourceIDs[i]
}

func (u *UI) selectedRes() quality.Res {
	i := w32.ComboSel(u.dlgRes)
	if i < int(quality.Res480) || i > int(quality.Res4K) {
		return quality.Res1080
	}
	return quality.Res(i)
}

func (u *UI) selectedFPS() int {
	res := u.selectedRes()
	opts := quality.FPSOptions(res)
	i := w32.ComboSel(u.dlgFPS)
	if i < 0 || i >= len(opts) {
		return quality.Lookup(res, 30).FPS
	}
	return opts[i]
}

func (u *UI) fillFPS(keep int) {
	res := u.selectedRes()
	opts := quality.FPSOptions(res)
	w32.ComboClear(u.dlgFPS)
	sel := 0
	matched := false
	for i, fps := range opts {
		w32.ComboAdd(u.dlgFPS, itoa(fps))
		if fps == keep {
			sel = i
			matched = true
		}
	}
	if !matched && len(opts) > 0 {
		for i, fps := range opts {
			if fps == 30 {
				sel = i
			}
		}
		if keep > opts[len(opts)-1] {
			sel = len(opts) - 1
		}
	}
	w32.ComboSet(u.dlgFPS, sel)
}

func (u *UI) syncShareBitrate() {
	if u.dlgBitrate == 0 {
		return
	}
	p := quality.Lookup(u.selectedRes(), u.selectedFPS())
	w32.TrackRange(u.dlgBitrate, p.Min/1000, p.Max/1000)
	w32.TrackSet(u.dlgBitrate, p.Fixed/1000)
	dyn := u.dlgDynamic != 0 && w32.Checked(u.dlgDynamic)
	w32.Enable(u.dlgBitrate, !dyn)
	u.updateShareBitrateLabel()
}

func (u *UI) updateShareBitrateLabel() {
	if u.dlgRateLbl == 0 {
		return
	}
	p := quality.Lookup(u.selectedRes(), u.selectedFPS())
	if u.dlgDynamic != 0 && w32.Checked(u.dlgDynamic) {
		w32.SetText(u.dlgRateLbl, "Bitrate  "+formatMbps(p.Fixed/1000)+"  ("+formatMbps(p.Min/1000)+"-"+formatMbps(p.Max/1000)+" dynamic)")
		return
	}
	w32.SetText(u.dlgRateLbl, "Bitrate  "+formatMbps(w32.TrackPos(u.dlgBitrate)))
}

func (u *UI) shareBitrate() int {
	p := quality.Lookup(u.selectedRes(), u.selectedFPS())
	if u.dlgDynamic != 0 && w32.Checked(u.dlgDynamic) {
		return p.Fixed
	}
	kbps := w32.TrackPos(u.dlgBitrate)
	bps := kbps * 1000
	if bps < p.Min {
		return p.Min
	}
	if bps > p.Max {
		return p.Max
	}
	return bps
}

func (u *UI) cfgFromFields() config.Config {
	return config.Config{
		URL:         w32.GetText(u.url),
		APIKey:      w32.GetText(u.key),
		APISecret:   w32.GetText(u.secret),
		DisplayName: w32.GetText(u.name),
	}
}

func (u *UI) setInRoom(name string) {
	in := name != ""
	w32.Enable(u.share, in)
	w32.Enable(u.stop, in && u.sharing)
	w32.Enable(u.leave, in)
	w32.Enable(u.join, !in)
	w32.Enable(u.tracks, in)
	if in {
		w32.SetText(u.presence, "in "+name)
	}
}

func (u *UI) setSharing(on bool) {
	w32.Enable(u.stop, on)
	w32.Enable(u.share, !on && u.inRoom != "")
	w32.Enable(u.preview, on)
	if !on {
		w32.SetText(u.preview, "Hide own preview")
	}
}

func (u *UI) command(id int) {
	switch id {
	case idSave:
		u.host.Save(u.cfgFromFields())
	case idConnect:
		u.host.Connect(u.cfgFromFields())
	case idCreate:
		u.host.Save(u.cfgFromFields())
		u.host.CreateRoom(w32.GetText(u.newRoom))
	case idJoin:
		u.host.Save(u.cfgFromFields())
		u.host.Join(u.selectedRoom())
	case idDelete:
		u.host.DeleteRoom(u.selectedRoom())
	case idShare:
		u.host.OpenShare()
	case idStop:
		u.host.StopShare()
	case idPreview:
		u.host.SetLocalPreview(u.local.host == 0)
	case idLeave:
		u.host.Leave()
	case idDynamic:
		u.syncShareBitrate()
	case idGoLive:
		u.host.StartShare(u.selectedSource(), u.selectedRes(), u.selectedFPS(), u.shareBitrate(), w32.Checked(u.dlgDynamic), w32.Checked(u.dlgAudio))
		if u.dlg != 0 {
			w32.Destroy(u.dlg)
			uis.Delete(u.dlg)
			u.dlg = 0
		}
	case idCancel:
		if u.dlg != 0 {
			w32.Destroy(u.dlg)
			uis.Delete(u.dlg)
			u.dlg = 0
		}
	default:
		if id >= idMuteBase {
			for _, p := range u.panes {
				if p.mute != 0 && w32.Parent(p.mute) != 0 {
					u.host.SetMute(p.sid, w32.Checked(p.mute))
				}
			}
		}
	}
}

func mainWnd(hwnd windows.HWND, msg uint32, wParam, lParam uintptr) uintptr {
	v, ok := uis.Load(hwnd)
	if !ok {
		if msg == w32.WM_DESTROY {
			w32.Quit()
		}
		return w32.DefProc(hwnd, msg, wParam, lParam)
	}
	u := v.(*UI)
	switch msg {
	case w32.WM_SIZE:
		r := w32.ClientRect(hwnd)
		w32.Move(u.stage, 340, 10, r.Right-350, r.Bottom-20)
		u.layoutPanes()
		return 0
	case w32.WM_TIMER:
		if u.listing {
			u.host.RefreshRooms()
		}
		return 0
	case w32.WM_HSCROLL:
		if u.dlg != 0 && windows.HWND(lParam) == u.dlgBitrate && (u.dlgDynamic == 0 || !w32.Checked(u.dlgDynamic)) {
			u.updateShareBitrateLabel()
		}
		return 0
	case w32.WM_COMMAND:
		id := w32.ControlID(wParam)
		code := w32.NotifyCode(wParam)
		if u.dlg != 0 && hwnd == u.dlg && (id == idRes || id == idFPS) && code == w32.CBN_SELCHANGE {
			if id == idRes {
				keep, _ := strconv.Atoi(w32.ComboText(u.dlgFPS))
				u.fillFPS(keep)
			}
			u.syncShareBitrate()
			return 0
		}
		if code == 0 || code == w32.BN_CLICKED || id == idGoLive || id == idCancel {
			u.command(id)
		}
		if id >= idMuteBase && u.panes != nil {
			for _, p := range u.panes {
				if p.mute != 0 {
					u.host.SetMute(p.sid, w32.Checked(p.mute))
				}
			}
		}
		return 0
	case w32.WM_NOTIFY:
		nm := w32.GetNotify(lParam)
		if nm.HwndFrom == u.tracks && nm.Code == w32.LVN_ITEMCHANGED && !u.ignore {
			lv := w32.GetListViewNotify(lParam)
			if lv.UChanged&w32.LVIF_STATE != 0 && (lv.UNewState^lv.UOldState)&w32.LVIS_STATEIMAGEMASK != 0 {
				u.mu.Lock()
				list := u.trackList
				u.mu.Unlock()
				i := int(lv.IItem)
				if i >= 0 && i < len(list) {
					u.host.SetWatch(list[i].SID, w32.LvChecked(u.tracks, i))
				}
			}
		}
		return 0
	case msgStatus:
		u.mu.Lock()
		t := u.statusT
		u.mu.Unlock()
		w32.SetText(u.status, t)
		return 0
	case msgPresence:
		u.mu.Lock()
		t := u.presenceT
		in := u.inRoom
		u.mu.Unlock()
		if in != "" {
			w32.SetText(u.presence, t+" · "+in)
		} else {
			w32.SetText(u.presence, t)
		}
		return 0
	case msgRooms:
		u.applyRooms()
		return 0
	case msgTracks:
		u.applyTracks()
		return 0
	case msgInRoom:
		u.mu.Lock()
		name := u.inRoom
		u.mu.Unlock()
		u.setInRoom(name)
		return 0
	case msgSharing:
		u.mu.Lock()
		on := u.sharing
		u.mu.Unlock()
		u.setSharing(on)
		if !on && u.local.host != 0 {
			w32.Destroy(u.local.host)
			videos.Delete(u.local.video)
			u.local = pane{}
			u.layoutPanes()
		}
		return 0
	case msgClearNew:
		w32.SetText(u.newRoom, "")
		return 0
	case msgClearPanes:
		u.clearPanes()
		return 0
	case w32.WM_CLOSE:
		if hwnd == u.hwnd {
			u.host.Leave()
			w32.Destroy(hwnd)
			return 0
		}
		if hwnd == u.dlg {
			uis.Delete(hwnd)
			u.dlg = 0
		}
		return w32.DefProc(hwnd, msg, wParam, lParam)
	case w32.WM_DESTROY:
		if hwnd == u.hwnd {
			w32.Quit()
		}
		return 0
	}
	return w32.DefProc(hwnd, msg, wParam, lParam)
}

func videoWnd(hwnd windows.HWND, msg uint32, wParam, lParam uintptr) uintptr {
	if msg == w32.WM_PAINT {
		if v, ok := videos.Load(hwnd); ok {
			v.(*UI).host.Paint(hwnd)
			return 0
		}
		var ps w32.PaintStruct
		hdc := w32.BeginPaint(hwnd, &ps)
		if hdc != 0 {
			w32.EndPaint(hwnd, &ps)
		}
		return 0
	}
	if msg == w32.WM_ERASEBKGND {
		return 1
	}
	return w32.DefProc(hwnd, msg, wParam, lParam)
}

func label(parent windows.HWND, id int, text string, x, y, w, h int32) windows.HWND {
	hnd := w32.Create(0, w32.WS_CHILD|w32.WS_VISIBLE, "STATIC", text, x, y, w, h, parent, uintptr(id))
	w32.Font(hnd)
	return hnd
}

func edit(parent windows.HWND, id int, text string, x, y, w, h int32) windows.HWND {
	hnd := w32.Create(w32.WS_EX_CLIENTEDGE, w32.WS_CHILD|w32.WS_VISIBLE|w32.WS_TABSTOP|w32.ES_AUTOHSCROLL, "EDIT", text, x, y, w, h, parent, uintptr(id))
	w32.Font(hnd)
	return hnd
}

func button(parent windows.HWND, id int, text string, x, y, w, h int32) windows.HWND {
	hnd := w32.Create(0, w32.WS_CHILD|w32.WS_VISIBLE|w32.WS_TABSTOP, "BUTTON", text, x, y, w, h, parent, uintptr(id))
	w32.Font(hnd)
	return hnd
}

func itoa(n int) string {
	return strconv.Itoa(n)
}

func formatMbps(kbps int) string {
	if kbps%1000 == 0 {
		return strconv.Itoa(kbps/1000) + " Mbps"
	}
	return strconv.Itoa(kbps/1000) + "." + strconv.Itoa((kbps/100)%10) + " Mbps"
}
