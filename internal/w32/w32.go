package w32

import (
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	WS_OVERLAPPEDWINDOW = 0x00CF0000
	WS_VISIBLE          = 0x10000000
	WS_CHILD            = 0x40000000
	WS_VSCROLL          = 0x00200000
	WS_BORDER           = 0x00800000
	WS_CAPTION          = 0x00C00000
	WS_SYSMENU          = 0x00080000
	WS_POPUP            = 0x80000000
	WS_CLIPSIBLINGS     = 0x04000000
	WS_CLIPCHILDREN     = 0x02000000
	WS_TABSTOP          = 0x00010000
	WS_GROUP            = 0x00020000
	DS_MODALFRAME       = 0x00000080

	WS_EX_CLIENTEDGE    = 0x00000200
	WS_EX_CONTROLPARENT = 0x00010000
	WS_EX_APPWINDOW     = 0x00040000
	WS_EX_DLGMODALFRAME = 0x00000001

	WDA_EXCLUDEFROMCAPTURE = 0x00000011

	CW_USEDEFAULT = ^0x7fffffff

	WM_CREATE     = 0x0001
	WM_DESTROY    = 0x0002
	WM_SIZE       = 0x0005
	WM_CLOSE      = 0x0010
	WM_COMMAND    = 0x0111
	WM_NOTIFY     = 0x004E
	WM_PAINT      = 0x000F
	WM_TIMER      = 0x0113
	WM_HSCROLL    = 0x0114
	WM_ERASEBKGND = 0x0014
	WM_SETFONT    = 0x0030
	WM_GETTEXT    = 0x000D
	WM_SETTEXT    = 0x000C
	WM_APP        = 0x8000
	WM_USER       = 0x0400

	BN_CLICKED    = 0
	CBN_SELCHANGE = 1

	TBM_GETPOS    = WM_USER
	TBM_SETPOS    = WM_USER + 5
	TBM_SETRANGE  = WM_USER + 6
	TBS_AUTOTICKS = 0x0001

	LBS_NOTIFY           = 0x0001
	LBS_NOINTEGRALHEIGHT = 0x0100
	LB_ADDSTRING         = 0x0180
	LB_RESETCONTENT      = 0x0184
	LB_GETCURSEL         = 0x0188
	LB_GETTEXT           = 0x0189
	LB_GETCOUNT          = 0x018B
	LB_SETCURSEL         = 0x0186
	LBN_SELCHANGE        = 1
	LBN_DBLCLK           = 2

	CBS_DROPDOWNLIST = 0x0003
	CB_ADDSTRING     = 0x0143
	CB_SETCURSEL     = 0x014E
	CB_GETCURSEL     = 0x0147
	CB_RESETCONTENT  = 0x014B
	CB_GETLBTEXT     = 0x0148
	CB_GETLBTEXTLEN  = 0x0149

	BS_PUSHBUTTON   = 0
	BS_CHECKBOX     = 0x0002
	BS_AUTOCHECKBOX = 0x0003
	BM_GETCHECK     = 0x00F0
	BM_SETCHECK     = 0x00F1
	BST_CHECKED     = 1
	BST_UNCHECKED   = 0

	ES_AUTOHSCROLL = 0x0080
	ES_PASSWORD    = 0x0020
	ES_NUMBER      = 0x2000

	SW_SHOW = 5
	SW_HIDE = 0

	COLOR_WINDOW     = 5
	COLOR_BTNFACE    = 15
	IDC_ARROW        = 32512
	DEFAULT_GUI_FONT = 17

	DT_SINGLELINE = 0x00000020
	DT_VCENTER    = 0x00000004
	DT_NOPREFIX   = 0x00000800

	SRCCOPY  = 0x00CC0020
	HALFTONE = 4

	BI_RGB         = 0
	DIB_RGB_COLORS = 0

	LVS_REPORT                   = 0x0001
	LVS_SINGLESEL                = 0x0004
	LVS_SHOWSELALWAYS            = 0x0008
	LVS_SHAREIMAGELISTS          = 0x0040
	LVS_EX_CHECKBOXES            = 0x00000004
	LVS_EX_FULLROWSELECT         = 0x00000020
	LVM_FIRST                    = 0x1000
	LVM_INSERTCOLUMN             = LVM_FIRST + 27
	LVM_INSERTITEM               = LVM_FIRST + 77
	LVM_DELETEALLITEMS           = LVM_FIRST + 9
	LVM_SETITEMTEXT              = LVM_FIRST + 116
	LVM_GETITEMCOUNT             = LVM_FIRST + 4
	LVM_GETITEMTEXT              = LVM_FIRST + 115
	LVM_SETEXTENDEDLISTVIEWSTYLE = LVM_FIRST + 54
	LVM_GETITEMSTATE             = LVM_FIRST + 44
	LVM_SETITEMSTATE             = LVM_FIRST + 43
	LVIF_TEXT                    = 0x0001
	LVIF_PARAM                   = 0x0004
	LVIF_STATE                   = 0x0008
	LVIS_STATEIMAGEMASK          = 0xF000
	LVN_FIRST                    = ^uint32(99)
	LVN_ITEMCHANGED              = LVN_FIRST - 1

	ICC_LISTVIEW_CLASSES = 0x00000001
	ICC_BAR_CLASSES      = 0x00000004

	SWP_NOZORDER = 0x0004
	SWP_NOMOVE   = 0x0002
	SWP_NOSIZE   = 0x0001

	ES_CONTINUOUS       = 0x80000000
	ES_DISPLAY_REQUIRED = 0x00000002
	ES_SYSTEM_REQUIRED  = 0x00000001

	SM_CXSCREEN = 0
	SM_CYSCREEN = 1
)

type WndProc func(hwnd windows.HWND, msg uint32, wParam, lParam uintptr) uintptr

type Point struct {
	X, Y int32
}

type Rect struct {
	Left, Top, Right, Bottom int32
}

type Msg struct {
	Hwnd    windows.HWND
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      Point
}

type PaintStruct struct {
	Hdc         uintptr
	Erase       int32
	RcPaint     Rect
	Restore     int32
	IncUpdate   int32
	RgbReserved [32]byte
}

type BitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

type BitmapInfo struct {
	Header BitmapInfoHeader
	Colors [1]uint32
}

type Nmhdr struct {
	HwndFrom windows.HWND
	IdFrom   uintptr
	Code     uint32
}

type LvItem struct {
	Mask       uint32
	IItem      int32
	ISubItem   int32
	State      uint32
	StateMask  uint32
	PszText    *uint16
	CchTextMax int32
	IImage     int32
	LParam     uintptr
	IIndent    int32
	IGroupId   int32
	CColumns   uint32
	PuColumns  *uint32
}

type LvColumn struct {
	Mask       uint32
	Fmt        int32
	Cx         int32
	PszText    *uint16
	CchTextMax int32
	ISubItem   int32
	IImage     int32
	IOrder     int32
}

type InitCommonControlsEx struct {
	Size uint32
	Icc  uint32
}

type NmListView struct {
	Hdr       Nmhdr
	IItem     int32
	ISubItem  int32
	UNewState uint32
	UOldState uint32
	UChanged  uint32
	PtAction  Point
	LParam    uintptr
}

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	gdi32    = windows.NewLazySystemDLL("gdi32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")
	comctl32 = windows.NewLazySystemDLL("comctl32.dll")
	kernelEx = windows.NewLazySystemDLL("kernel32.dll")

	procRegisterClassExW         = user32.NewProc("RegisterClassExW")
	procCreateWindowExW          = user32.NewProc("CreateWindowExW")
	procDefWindowProcW           = user32.NewProc("DefWindowProcW")
	procShowWindow               = user32.NewProc("ShowWindow")
	procUpdateWindow             = user32.NewProc("UpdateWindow")
	procGetMessageW              = user32.NewProc("GetMessageW")
	procTranslateMessage         = user32.NewProc("TranslateMessage")
	procDispatchMessageW         = user32.NewProc("DispatchMessageW")
	procPostQuitMessage          = user32.NewProc("PostQuitMessage")
	procPostMessageW             = user32.NewProc("PostMessageW")
	procSendMessageW             = user32.NewProc("SendMessageW")
	procSetWindowTextW           = user32.NewProc("SetWindowTextW")
	procGetWindowTextW           = user32.NewProc("GetWindowTextW")
	procGetWindowTextLengthW     = user32.NewProc("GetWindowTextLengthW")
	procGetClientRect            = user32.NewProc("GetClientRect")
	procMoveWindow               = user32.NewProc("MoveWindow")
	procDestroyWindow            = user32.NewProc("DestroyWindow")
	procSetFocus                 = user32.NewProc("SetFocus")
	procEnableWindow             = user32.NewProc("EnableWindow")
	procGetDlgCtrlID             = user32.NewProc("GetDlgCtrlID")
	procBeginPaint               = user32.NewProc("BeginPaint")
	procEndPaint                 = user32.NewProc("EndPaint")
	procFillRect                 = user32.NewProc("FillRect")
	procGetDC                    = user32.NewProc("GetDC")
	procGetWindowDC              = user32.NewProc("GetWindowDC")
	procReleaseDC                = user32.NewProc("ReleaseDC")
	procInvalidateRect           = user32.NewProc("InvalidateRect")
	procLoadCursorW              = user32.NewProc("LoadCursorW")
	procSetWindowLongPtrW        = user32.NewProc("SetWindowLongPtrW")
	procGetWindowLongPtrW        = user32.NewProc("GetWindowLongPtrW")
	procGetParent                = user32.NewProc("GetParent")
	procIsDlgButtonChecked       = user32.NewProc("IsDlgButtonChecked")
	procCheckDlgButton           = user32.NewProc("CheckDlgButton")
	procMessageBoxW              = user32.NewProc("MessageBoxW")
	procEnableWindow2            = user32.NewProc("EnableWindow")
	procSetForegroundWindow      = user32.NewProc("SetForegroundWindow")
	procGetWindowRect            = user32.NewProc("GetWindowRect")
	procScreenToClient           = user32.NewProc("ScreenToClient")
	procEnumWindows              = user32.NewProc("EnumWindows")
	procSetTimer                 = user32.NewProc("SetTimer")
	procKillTimer                = user32.NewProc("KillTimer")
	procGetWindowTextLength      = user32.NewProc("GetWindowTextLengthW")
	procIsWindowVisible          = user32.NewProc("IsWindowVisible")
	procGetWindow                = user32.NewProc("GetWindow")
	procPrintWindow              = user32.NewProc("PrintWindow")
	procSetWindowDisplayAffinity = user32.NewProc("SetWindowDisplayAffinity")

	procGetStockObject         = gdi32.NewProc("GetStockObject")
	procCreateSolidBrush       = gdi32.NewProc("CreateSolidBrush")
	procDeleteObject           = gdi32.NewProc("DeleteObject")
	procStretchDIBits          = gdi32.NewProc("StretchDIBits")
	procStretchBlt             = gdi32.NewProc("StretchBlt")
	procBitBlt                 = gdi32.NewProc("BitBlt")
	procCreateCompatibleDC     = gdi32.NewProc("CreateCompatibleDC")
	procCreateCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
	procSelectObject           = gdi32.NewProc("SelectObject")
	procDeleteDC               = gdi32.NewProc("DeleteDC")
	procCreateDIBSection       = gdi32.NewProc("CreateDIBSection")
	procSetStretchBltMode      = gdi32.NewProc("SetStretchBltMode")
	procSetBrushOrgEx          = gdi32.NewProc("SetBrushOrgEx")
	procGdiFlush               = gdi32.NewProc("GdiFlush")

	procInitCommonControlsEx    = comctl32.NewProc("InitCommonControlsEx")
	procSetThreadExecutionState = kernel32.NewProc("SetThreadExecutionState")
	procGetModuleHandleW        = kernel32.NewProc("GetModuleHandleW")
)

type classEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   windows.Handle
	Icon       windows.Handle
	Cursor     windows.Handle
	Background windows.Handle
	MenuName   *uint16
	ClassName  *uint16
	IconSm     windows.Handle
}

func InitCommon() {
	var icc InitCommonControlsEx
	icc.Size = uint32(unsafe.Sizeof(icc))
	icc.Icc = ICC_LISTVIEW_CLASSES | ICC_BAR_CLASSES
	procInitCommonControlsEx.Call(uintptr(unsafe.Pointer(&icc)))
}

func RegisterClass(name string, proc uintptr, bg uint32) error {
	cname, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return err
	}
	hInst, _, _ := procGetModuleHandleW.Call(0)
	cursor, _, _ := procLoadCursorW.Call(0, uintptr(IDC_ARROW))
	cls := classEx{
		Size:       uint32(unsafe.Sizeof(classEx{})),
		WndProc:    proc,
		Instance:   windows.Handle(hInst),
		Cursor:     windows.Handle(cursor),
		Background: windows.Handle(bg + 1),
		ClassName:  cname,
	}
	r, _, e := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&cls)))
	if r == 0 {
		return e
	}
	return nil
}

func Module() windows.Handle {
	h, _, _ := procGetModuleHandleW.Call(0)
	return windows.Handle(h)
}

func Create(ex, style uint32, class, title string, x, y, w, h int32, parent windows.HWND, id uintptr) windows.HWND {
	cname, _ := windows.UTF16PtrFromString(class)
	var tptr *uint16
	if title != "" {
		tptr, _ = windows.UTF16PtrFromString(title)
	}
	hwnd, _, _ := procCreateWindowExW.Call(
		uintptr(ex),
		uintptr(unsafe.Pointer(cname)),
		uintptr(unsafe.Pointer(tptr)),
		uintptr(style),
		uintptr(x), uintptr(y), uintptr(w), uintptr(h),
		uintptr(parent),
		id,
		uintptr(Module()),
		0,
	)
	return windows.HWND(hwnd)
}

func DefProc(hwnd windows.HWND, msg uint32, wParam, lParam uintptr) uintptr {
	r, _, _ := procDefWindowProcW.Call(uintptr(hwnd), uintptr(msg), wParam, lParam)
	return r
}

func Show(hwnd windows.HWND, cmd int) {
	procShowWindow.Call(uintptr(hwnd), uintptr(cmd))
}

func Update(hwnd windows.HWND) {
	procUpdateWindow.Call(uintptr(hwnd))
}

func Loop() {
	var m Msg
	for {
		r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			return
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
}

func Quit() {
	procPostQuitMessage.Call(0)
}

func Post(hwnd windows.HWND, msg uint32, wParam, lParam uintptr) {
	procPostMessageW.Call(uintptr(hwnd), uintptr(msg), wParam, lParam)
}

func Send(hwnd windows.HWND, msg uint32, wParam, lParam uintptr) uintptr {
	r, _, _ := procSendMessageW.Call(uintptr(hwnd), uintptr(msg), wParam, lParam)
	return r
}

func SetText(hwnd windows.HWND, text string) {
	p, _ := windows.UTF16PtrFromString(text)
	procSetWindowTextW.Call(uintptr(hwnd), uintptr(unsafe.Pointer(p)))
}

func GetText(hwnd windows.HWND) string {
	n, _, _ := procGetWindowTextLengthW.Call(uintptr(hwnd))
	if n == 0 {
		return ""
	}
	buf := make([]uint16, n+1)
	procGetWindowTextW.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&buf[0])), n+1)
	return windows.UTF16ToString(buf)
}

func ClientRect(hwnd windows.HWND) Rect {
	var r Rect
	procGetClientRect.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&r)))
	return r
}

func Move(hwnd windows.HWND, x, y, w, h int32) {
	procMoveWindow.Call(uintptr(hwnd), uintptr(x), uintptr(y), uintptr(w), uintptr(h), 1)
}

func Destroy(hwnd windows.HWND) {
	procDestroyWindow.Call(uintptr(hwnd))
}

func Enable(hwnd windows.HWND, on bool) {
	var v uintptr
	if on {
		v = 1
	}
	procEnableWindow.Call(uintptr(hwnd), v)
}

func Font(hwnd windows.HWND) {
	f, _, _ := procGetStockObject.Call(uintptr(DEFAULT_GUI_FONT))
	procSendMessageW.Call(uintptr(hwnd), WM_SETFONT, f, 1)
}

func Checked(hwnd windows.HWND) bool {
	r, _, _ := procSendMessageW.Call(uintptr(hwnd), BM_GETCHECK, 0, 0)
	return r == BST_CHECKED
}

func SetChecked(hwnd windows.HWND, on bool) {
	var v uintptr
	if on {
		v = BST_CHECKED
	}
	procSendMessageW.Call(uintptr(hwnd), BM_SETCHECK, v, 0)
}

func Fill(hdc uintptr, r *Rect, colorIndex uintptr) {
	procFillRect.Call(hdc, uintptr(unsafe.Pointer(r)), colorIndex+1)
}

func BeginPaint(hwnd windows.HWND, ps *PaintStruct) uintptr {
	hdc, _, _ := procBeginPaint.Call(uintptr(hwnd), uintptr(unsafe.Pointer(ps)))
	return hdc
}

func EndPaint(hwnd windows.HWND, ps *PaintStruct) {
	procEndPaint.Call(uintptr(hwnd), uintptr(unsafe.Pointer(ps)))
}

func Invalidate(hwnd windows.HWND) {
	procInvalidateRect.Call(uintptr(hwnd), 0, 0)
}

func Parent(hwnd windows.HWND) windows.HWND {
	h, _, _ := procGetParent.Call(uintptr(hwnd))
	return windows.HWND(h)
}

func HiWord(v uintptr) uint16 {
	return uint16(v >> 16)
}

func LoWord(v uintptr) uint16 {
	return uint16(v)
}

func ControlID(wParam uintptr) int {
	return int(LoWord(wParam))
}

func NotifyCode(wParam uintptr) int {
	return int(HiWord(wParam))
}

func ListAdd(hwnd windows.HWND, text string) {
	p, _ := windows.UTF16PtrFromString(text)
	procSendMessageW.Call(uintptr(hwnd), LB_ADDSTRING, 0, uintptr(unsafe.Pointer(p)))
}

func ListClear(hwnd windows.HWND) {
	procSendMessageW.Call(uintptr(hwnd), LB_RESETCONTENT, 0, 0)
}

func ListSel(hwnd windows.HWND) int {
	r, _, _ := procSendMessageW.Call(uintptr(hwnd), LB_GETCURSEL, 0, 0)
	return int(int32(r))
}

func ComboAdd(hwnd windows.HWND, text string) {
	p, _ := windows.UTF16PtrFromString(text)
	procSendMessageW.Call(uintptr(hwnd), CB_ADDSTRING, 0, uintptr(unsafe.Pointer(p)))
}

func ComboSel(hwnd windows.HWND) int {
	r, _, _ := procSendMessageW.Call(uintptr(hwnd), CB_GETCURSEL, 0, 0)
	return int(int32(r))
}

func ComboSet(hwnd windows.HWND, i int) {
	procSendMessageW.Call(uintptr(hwnd), CB_SETCURSEL, uintptr(i), 0)
}

func ComboClear(hwnd windows.HWND) {
	procSendMessageW.Call(uintptr(hwnd), CB_RESETCONTENT, 0, 0)
}

func ComboText(hwnd windows.HWND) string {
	i := ComboSel(hwnd)
	if i < 0 {
		return ""
	}
	n, _, _ := procSendMessageW.Call(uintptr(hwnd), CB_GETLBTEXTLEN, uintptr(i), 0)
	if int32(n) <= 0 {
		return ""
	}
	buf := make([]uint16, n+1)
	procSendMessageW.Call(uintptr(hwnd), CB_GETLBTEXT, uintptr(i), uintptr(unsafe.Pointer(&buf[0])))
	return windows.UTF16ToString(buf)
}

func TrackRange(hwnd windows.HWND, min, max int) {
	if min < 0 {
		min = 0
	}
	if max < min {
		max = min
	}
	procSendMessageW.Call(uintptr(hwnd), TBM_SETRANGE, 1, uintptr(uint16(min))|uintptr(uint16(max))<<16)
}

func TrackSet(hwnd windows.HWND, pos int) {
	procSendMessageW.Call(uintptr(hwnd), TBM_SETPOS, 1, uintptr(pos))
}

func TrackPos(hwnd windows.HWND) int {
	r, _, _ := procSendMessageW.Call(uintptr(hwnd), TBM_GETPOS, 0, 0)
	return int(int32(r))
}

func SleepBlock(on bool) {
	if on {
		procSetThreadExecutionState.Call(uintptr(ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED))
		return
	}
	procSetThreadExecutionState.Call(uintptr(ES_CONTINUOUS))
}

func Alert(hwnd windows.HWND, text string) {
	p, _ := windows.UTF16PtrFromString(text)
	t, _ := windows.UTF16PtrFromString("Welfare Office")
	procMessageBoxW.Call(uintptr(hwnd), uintptr(unsafe.Pointer(p)), uintptr(unsafe.Pointer(t)), 0)
}

func NewCallback(fn func(hwnd windows.HWND, msg uint32, wParam, lParam uintptr) uintptr) uintptr {
	return syscall.NewCallback(fn)
}

func GetDC(hwnd windows.HWND) uintptr {
	hdc, _, _ := procGetDC.Call(uintptr(hwnd))
	return hdc
}

func GetWindowDC(hwnd windows.HWND) uintptr {
	hdc, _, _ := procGetWindowDC.Call(uintptr(hwnd))
	return hdc
}

func ReleaseDC(hwnd windows.HWND, hdc uintptr) {
	procReleaseDC.Call(uintptr(hwnd), hdc)
}

func StretchBGRA(hdc uintptr, destX, destY, destW, destH int32, srcW, srcH int32, pixels []byte) {
	if len(pixels) == 0 || destW <= 0 || destH <= 0 || srcW <= 0 || srcH <= 0 {
		return
	}
	header := BitmapInfoHeader{
		Size:        uint32(unsafe.Sizeof(BitmapInfoHeader{})),
		Width:       srcW,
		Height:      -srcH,
		Planes:      1,
		BitCount:    32,
		Compression: BI_RGB,
	}
	oldMode, _, _ := procSetStretchBltMode.Call(hdc, uintptr(HALFTONE))
	// Windows recommends resetting the brush origin after selecting HALFTONE.
	procSetBrushOrgEx.Call(hdc, 0, 0, 0)
	procStretchDIBits.Call(
		hdc,
		uintptr(destX), uintptr(destY), uintptr(destW), uintptr(destH),
		0, 0, uintptr(srcW), uintptr(srcH),
		uintptr(unsafe.Pointer(&pixels[0])),
		uintptr(unsafe.Pointer(&header)),
		uintptr(DIB_RGB_COLORS),
		uintptr(SRCCOPY),
	)
	if oldMode != 0 {
		procSetStretchBltMode.Call(hdc, oldMode)
	}
}

func IsVisible(hwnd windows.HWND) bool {
	r, _, _ := procIsWindowVisible.Call(uintptr(hwnd))
	return r != 0
}

// SetWindowDisplayAffinity excludes this process-owned top-level window from
// supported desktop capture paths while the app is sharing a monitor.
func SetWindowDisplayAffinity(hwnd windows.HWND, exclude bool) bool {
	affinity := uintptr(0)
	if exclude {
		affinity = WDA_EXCLUDEFROMCAPTURE
	}
	r, _, _ := procSetWindowDisplayAffinity.Call(uintptr(hwnd), affinity)
	return r != 0
}

type EnumProc func(hwnd windows.HWND) bool

func EnumTopWindows(fn EnumProc) {
	cb := syscall.NewCallback(func(hwnd windows.HWND, lparam uintptr) uintptr {
		if fn(hwnd) {
			return 1
		}
		return 0
	})
	procEnumWindows.Call(cb, 0)
}

func WindowTitle(hwnd windows.HWND) string {
	n, _, _ := procGetWindowTextLength.Call(uintptr(hwnd))
	if n == 0 {
		return ""
	}
	buf := make([]uint16, n+1)
	procGetWindowTextW.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&buf[0])), n+1)
	return windows.UTF16ToString(buf)
}

func BitBltCapture(src windows.HWND, x, y, w, h int) ([]byte, error) {
	if w <= 0 || h <= 0 || w > (256<<20)/4/h {
		return nil, syscall.EINVAL
	}
	hdcSrc := GetDC(src)
	if src != 0 {
		hdcSrc = GetWindowDC(src)
	}
	if hdcSrc == 0 {
		return nil, syscall.EINVAL
	}
	defer ReleaseDC(src, hdcSrc)
	hdcMem, _, _ := procCreateCompatibleDC.Call(hdcSrc)
	if hdcMem == 0 {
		return nil, syscall.EINVAL
	}
	defer procDeleteDC.Call(hdcMem)
	header := BitmapInfoHeader{
		Size:        uint32(unsafe.Sizeof(BitmapInfoHeader{})),
		Width:       int32(w),
		Height:      -int32(h),
		Planes:      1,
		BitCount:    32,
		Compression: BI_RGB,
	}
	var bits uintptr
	hbmp, _, _ := procCreateDIBSection.Call(
		hdcSrc,
		uintptr(unsafe.Pointer(&header)),
		uintptr(DIB_RGB_COLORS),
		uintptr(unsafe.Pointer(&bits)),
		0,
		0,
	)
	if hbmp == 0 || bits == 0 {
		return nil, syscall.EINVAL
	}
	defer procDeleteObject.Call(hbmp)
	old, _, _ := procSelectObject.Call(hdcMem, hbmp)
	if old == 0 || old == ^uintptr(0) {
		return nil, syscall.EINVAL
	}
	selected := true
	defer func() {
		if selected {
			procSelectObject.Call(hdcMem, old)
		}
	}()
	if ok, _, _ := procBitBlt.Call(hdcMem, 0, 0, uintptr(w), uintptr(h), hdcSrc, uintptr(x), uintptr(y), uintptr(SRCCOPY)); ok == 0 {
		return nil, syscall.EIO
	}
	// Flush queued GDI writes before reading the DIB section's memory. This
	// avoids returning old scanlines on drivers that batch BitBlt operations.
	procGdiFlush.Call()
	buf := make([]byte, w*h*4)
	copy(buf, unsafe.Slice((*byte)(unsafe.Pointer(bits)), len(buf)))
	return buf, nil
}

// StretchBltCapture copies directly from the desktop/window DC into a
// destination-sized DIB. This avoids first allocating and copying a full
// native-resolution frame when the stream is configured for a smaller size.
func StretchBltCapture(src windows.HWND, x, y, srcW, srcH, dstW, dstH int) ([]byte, error) {
	if srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0 ||
		srcW > (256<<20)/4/srcH || dstW > (256<<20)/4/dstH {
		return nil, syscall.EINVAL
	}
	hdcSrc := GetDC(src)
	if src != 0 {
		hdcSrc = GetWindowDC(src)
	}
	if hdcSrc == 0 {
		return nil, syscall.EINVAL
	}
	defer ReleaseDC(src, hdcSrc)
	hdcMem, _, _ := procCreateCompatibleDC.Call(hdcSrc)
	if hdcMem == 0 {
		return nil, syscall.EINVAL
	}
	defer procDeleteDC.Call(hdcMem)
	header := BitmapInfoHeader{
		Size:        uint32(unsafe.Sizeof(BitmapInfoHeader{})),
		Width:       int32(dstW),
		Height:      -int32(dstH),
		Planes:      1,
		BitCount:    32,
		Compression: BI_RGB,
	}
	var bits uintptr
	hbmp, _, _ := procCreateDIBSection.Call(
		hdcSrc,
		uintptr(unsafe.Pointer(&header)),
		uintptr(DIB_RGB_COLORS),
		uintptr(unsafe.Pointer(&bits)),
		0,
		0,
	)
	if hbmp == 0 || bits == 0 {
		return nil, syscall.EINVAL
	}
	defer procDeleteObject.Call(hbmp)
	old, _, _ := procSelectObject.Call(hdcMem, hbmp)
	if old == 0 || old == ^uintptr(0) {
		return nil, syscall.EINVAL
	}
	defer procSelectObject.Call(hdcMem, old)
	oldMode, _, _ := procSetStretchBltMode.Call(hdcMem, uintptr(HALFTONE))
	if oldMode != 0 {
		defer procSetStretchBltMode.Call(hdcMem, oldMode)
	}
	procSetBrushOrgEx.Call(hdcMem, 0, 0, 0)
	ok, _, _ := procStretchBlt.Call(
		hdcMem, 0, 0, uintptr(dstW), uintptr(dstH),
		hdcSrc, uintptr(x), uintptr(y), uintptr(srcW), uintptr(srcH), uintptr(SRCCOPY),
	)
	if ok == 0 {
		return nil, syscall.EIO
	}
	procGdiFlush.Call()
	buf := make([]byte, dstW*dstH*4)
	copy(buf, unsafe.Slice((*byte)(unsafe.Pointer(bits)), len(buf)))
	return buf, nil
}

// ScaleBGRA uses GDI's halftone resampler for downscaling screen content.
// Nearest-neighbor scaling aliases small text and creates colored edge noise
// once the frame is encoded as 4:2:0 video.
func ScaleBGRA(pixels []byte, srcW, srcH, dstW, dstH int) []byte {
	if srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0 ||
		srcW > (256<<20)/4/srcH || dstW > (256<<20)/4/dstH ||
		len(pixels) < srcW*srcH*4 {
		return nil
	}
	if srcW == dstW && srcH == dstH {
		return pixels
	}

	hdcScreen := GetDC(0)
	if hdcScreen == 0 {
		return nil
	}
	defer ReleaseDC(0, hdcScreen)
	rawDC, _, _ := procCreateCompatibleDC.Call(hdcScreen)
	if rawDC == 0 {
		return nil
	}
	defer procDeleteDC.Call(rawDC)

	header := BitmapInfoHeader{
		Size:        uint32(unsafe.Sizeof(BitmapInfoHeader{})),
		Width:       int32(dstW),
		Height:      -int32(dstH),
		Planes:      1,
		BitCount:    32,
		Compression: BI_RGB,
	}
	var bits uintptr
	hbmp, _, _ := procCreateDIBSection.Call(
		uintptr(hdcScreen),
		uintptr(unsafe.Pointer(&header)),
		uintptr(DIB_RGB_COLORS),
		uintptr(unsafe.Pointer(&bits)),
		0,
		0,
	)
	if hbmp == 0 || bits == 0 {
		return nil
	}
	defer procDeleteObject.Call(hbmp)
	old, _, _ := procSelectObject.Call(rawDC, hbmp)
	if old == 0 || old == ^uintptr(0) {
		return nil
	}
	defer procSelectObject.Call(rawDC, old)

	sourceInfo := BitmapInfo{Header: BitmapInfoHeader{
		Size:        uint32(unsafe.Sizeof(BitmapInfoHeader{})),
		Width:       int32(srcW),
		Height:      -int32(srcH),
		Planes:      1,
		BitCount:    32,
		Compression: BI_RGB,
	}}
	oldMode, _, _ := procSetStretchBltMode.Call(rawDC, uintptr(HALFTONE))
	procSetBrushOrgEx.Call(rawDC, 0, 0, 0)
	lines, _, _ := procStretchDIBits.Call(
		rawDC,
		0, 0, uintptr(dstW), uintptr(dstH),
		0, 0, uintptr(srcW), uintptr(srcH),
		uintptr(unsafe.Pointer(&pixels[0])),
		uintptr(unsafe.Pointer(&sourceInfo)),
		uintptr(DIB_RGB_COLORS),
		uintptr(SRCCOPY),
	)
	if oldMode != 0 {
		procSetStretchBltMode.Call(rawDC, oldMode)
	}
	if lines == ^uintptr(0) || lines == 0 {
		return nil
	}
	procGdiFlush.Call()
	out := make([]byte, dstW*dstH*4)
	copy(out, unsafe.Slice((*byte)(unsafe.Pointer(bits)), len(out)))
	return out
}

const (
	LVCF_FMT     = 0x0001
	LVCF_WIDTH   = 0x0002
	LVCF_TEXT    = 0x0004
	LVCF_SUBITEM = 0x0008
)

func LvInsertColumn(hwnd windows.HWND, i int, title string, width int) {
	p, _ := windows.UTF16PtrFromString(title)
	col := LvColumn{
		Mask:     LVCF_TEXT | LVCF_WIDTH | LVCF_SUBITEM,
		Cx:       int32(width),
		PszText:  p,
		ISubItem: int32(i),
	}
	Send(hwnd, LVM_INSERTCOLUMN, uintptr(i), uintptr(unsafe.Pointer(&col)))
}

func LvClear(hwnd windows.HWND) {
	Send(hwnd, LVM_DELETEALLITEMS, 0, 0)
}

func LvInsert(hwnd windows.HWND, i int, text string, param uintptr) int {
	p, _ := windows.UTF16PtrFromString(text)
	item := LvItem{
		Mask:    LVIF_TEXT | LVIF_PARAM,
		IItem:   int32(i),
		PszText: p,
		LParam:  param,
	}
	r := Send(hwnd, LVM_INSERTITEM, 0, uintptr(unsafe.Pointer(&item)))
	return int(int32(r))
}

func LvSetText(hwnd windows.HWND, i, sub int, text string) {
	p, _ := windows.UTF16PtrFromString(text)
	item := LvItem{
		Mask:     LVIF_TEXT,
		IItem:    int32(i),
		ISubItem: int32(sub),
		PszText:  p,
	}
	Send(hwnd, LVM_SETITEMTEXT, uintptr(i), uintptr(unsafe.Pointer(&item)))
}

func LvCount(hwnd windows.HWND) int {
	return int(Send(hwnd, LVM_GETITEMCOUNT, 0, 0))
}

func LvChecked(hwnd windows.HWND, i int) bool {
	state := Send(hwnd, LVM_GETITEMSTATE, uintptr(i), LVIS_STATEIMAGEMASK)
	return ((state >> 12) & 3) == 2
}

func LvSetChecked(hwnd windows.HWND, i int, on bool) {
	item := LvItem{Mask: LVIF_STATE, IItem: int32(i), StateMask: LVIS_STATEIMAGEMASK}
	if on {
		item.State = 2 << 12
	} else {
		item.State = 1 << 12
	}
	Send(hwnd, LVM_SETITEMSTATE, uintptr(i), uintptr(unsafe.Pointer(&item)))
}

func LvSetExtended(hwnd windows.HWND, style uintptr) {
	Send(hwnd, LVM_SETEXTENDEDLISTVIEWSTYLE, 0, style)
}

func GetNotify(lParam uintptr) *Nmhdr {
	return (*Nmhdr)(unsafe.Pointer(lParam))
}

func GetListViewNotify(lParam uintptr) *NmListView {
	return (*NmListView)(unsafe.Pointer(lParam))
}

func SetTimer(hwnd windows.HWND, id, ms uintptr) {
	procSetTimer.Call(uintptr(hwnd), id, ms, 0)
}

func KillTimer(hwnd windows.HWND, id uintptr) {
	procKillTimer.Call(uintptr(hwnd), id)
}
