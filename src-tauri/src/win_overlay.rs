//! Windows overlay: frameless window + cursor-based click-through.
//!
//! Click-through: poll cursor ~60fps, emit to frontend which toggles
//! `setIgnoreCursorEvents` (required for WebView2 DirectComposition).
//!
//! Frame suppression: WM_STYLECHANGING intercepts ALL style changes and strips
//! frame/decoration bits before they apply. This prevents the frame flash that
//! `setIgnoreCursorEvents` normally causes (it calls SetWindowPos(SWP_FRAMECHANGED)
//! internally, but since our handler enforces frameless styles, nothing visible changes).
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};

use std::sync::atomic::AtomicI32;

use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Dwm::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, GetDpiForWindow, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::*;

static ORIGINAL_WNDPROC: AtomicIsize = AtomicIsize::new(0);
pub static PERMISSION_HIT_VISIBLE: AtomicBool = AtomicBool::new(false);
pub static WORKING_BUBBLE_VISIBLE: AtomicBool = AtomicBool::new(false);
pub static TOKEN_PANEL_VISIBLE: AtomicBool = AtomicBool::new(false);
/// When true, cursor polling always reports interactive (suppresses click-through during drag)
pub static DRAGGING: AtomicBool = AtomicBool::new(false);
/// When true, WM_STYLECHANGING will NOT force WS_EX_NOACTIVATE (allows keyboard focus)
pub static FOCUS_ALLOWED: AtomicBool = AtomicBool::new(false);

const WM_NCPAINT: u32 = 0x0085;
const WM_NCACTIVATE: u32 = 0x0086;
const WM_STYLECHANGING: u32 = 0x007C;
const WM_DISPLAYCHANGE: u32 = 0x007E;

// Dynamic mascot position in logical (CSS) pixels — set by frontend via Tauri command
static MASCOT_X: AtomicI32 = AtomicI32::new(60); // default: roughly center of 320
static MASCOT_Y: AtomicI32 = AtomicI32::new(320); // default: near bottom
static MASCOT_W: AtomicI32 = AtomicI32::new(200);
static MASCOT_H: AtomicI32 = AtomicI32::new(200);

// Actual bubble bounding boxes (logical CSS px). x=-1 means disabled.
static BUBBLE_X: AtomicI32 = AtomicI32::new(-1);
static BUBBLE_Y: AtomicI32 = AtomicI32::new(-1);
static BUBBLE_W: AtomicI32 = AtomicI32::new(0);
static BUBBLE_H: AtomicI32 = AtomicI32::new(0);
static PERM_X: AtomicI32 = AtomicI32::new(-1);
static PERM_Y: AtomicI32 = AtomicI32::new(-1);
static PERM_W: AtomicI32 = AtomicI32::new(0);
static PERM_H: AtomicI32 = AtomicI32::new(0);
static TOKEN_PANEL_X: AtomicI32 = AtomicI32::new(-1);
static TOKEN_PANEL_Y: AtomicI32 = AtomicI32::new(-1);
static TOKEN_PANEL_W: AtomicI32 = AtomicI32::new(0);
static TOKEN_PANEL_H: AtomicI32 = AtomicI32::new(0);

// Frontend-reported devicePixelRatio × 1000 (to store as integer).
// 0 means "not yet reported" — fall back to GetDpiForWindow.
pub static FRONTEND_DPR_X1000: AtomicU32 = AtomicU32::new(0);

// Style bits that would show a frame — strip these on every style change
const BANNED_STYLE: u32 = WS_CAPTION.0
    | WS_THICKFRAME.0
    | WS_SYSMENU.0
    | WS_MINIMIZEBOX.0
    | WS_MAXIMIZEBOX.0
    | WS_OVERLAPPEDWINDOW.0;

const BANNED_EXSTYLE: u32 =
    WS_EX_DLGMODALFRAME.0 | WS_EX_APPWINDOW.0 | WS_EX_WINDOWEDGE.0;

#[repr(C)]
struct StyleStruct {
    _old_style: u32,
    new_style: u32,
}

unsafe extern "system" fn overlay_wndproc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let original: WNDPROC = std::mem::transmute(ORIGINAL_WNDPROC.load(Ordering::Relaxed));

    match msg {
        // Intercept style changes BEFORE they apply — strip frame bits.
        // This is the key to preventing flash: when setIgnoreCursorEvents triggers
        // SWP_FRAMECHANGED, the styles it syncs are already frameless.
        WM_STYLECHANGING => {
            let ss = &mut *(lparam.0 as *mut StyleStruct);
            if wparam.0 as i32 == GWL_STYLE.0 {
                ss.new_style = (ss.new_style & !BANNED_STYLE) | WS_POPUP.0;
            } else if wparam.0 as i32 == GWL_EXSTYLE.0 {
                // Strip frame bits but preserve WS_EX_TRANSPARENT (click-through toggle)
                ss.new_style = (ss.new_style & !BANNED_EXSTYLE)
                    | WS_EX_TOOLWINDOW.0;
                // Only force WS_EX_NOACTIVATE when focus is not requested
                if !FOCUS_ALLOWED.load(Ordering::Relaxed) {
                    ss.new_style |= WS_EX_NOACTIVATE.0;
                }
            }
            return LRESULT(0);
        }
        WM_NCACTIVATE => {
            return CallWindowProcW(original, hwnd, msg, wparam, LPARAM(-1));
        }
        WM_NCPAINT => {
            return LRESULT(0);
        }
        WM_DISPLAYCHANGE => {
            // Monitor config changed (resolution, arrangement, dock/undock).
            // Resize overlay to span the updated virtual desktop.
            let (vx, vy, vw, vh) = get_virtual_desktop_bounds();
            SetWindowPos(
                hwnd, HWND_TOPMOST,
                vx, vy, vw, vh,
                SWP_NOACTIVATE | SWP_FRAMECHANGED,
            ).ok();
            // Re-assert not-fullscreen after the resize.
            mark_not_fullscreen(hwnd.0);
        }
        _ => {}
    }

    CallWindowProcW(original, hwnd, msg, wparam, lparam)
}

pub unsafe fn subclass_overlay(hwnd_raw: *mut std::ffi::c_void) {
    let hwnd = HWND(hwnd_raw);
    let original = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, overlay_wndproc as isize);
    ORIGINAL_WNDPROC.store(original, Ordering::Relaxed);
}

pub unsafe fn strip_frame(hwnd_raw: *mut std::ffi::c_void) {
    let hwnd = HWND(hwnd_raw);

    let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
    let clean = (style & !BANNED_STYLE) | WS_POPUP.0;
    SetWindowLongW(hwnd, GWL_STYLE, clean as i32);

    let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
    let clean_ex = (ex & !BANNED_EXSTYLE) | WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0;
    SetWindowLongW(hwnd, GWL_EXSTYLE, clean_ex as i32);

    let policy = DWMNCRP_DISABLED;
    let _ = DwmSetWindowAttribute(
        hwnd,
        DWMWA_NCRENDERING_POLICY,
        &policy as *const _ as *const _,
        std::mem::size_of_val(&policy) as u32,
    );

    SetWindowPos(
        hwnd,
        HWND_TOPMOST,
        0,
        0,
        0,
        0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED | SWP_NOACTIVATE,
    )
    .ok();
}

/// Update mascot position from frontend (logical CSS pixels relative to window).
pub fn update_mascot_position(x: i32, y: i32, w: i32, h: i32) {
    MASCOT_X.store(x, Ordering::Relaxed);
    MASCOT_Y.store(y, Ordering::Relaxed);
    MASCOT_W.store(w, Ordering::Relaxed);
    MASCOT_H.store(h, Ordering::Relaxed);
}

/// Update working bubble zone (logical CSS px). Pass x=-1 to disable.
pub fn update_bubble_zone(x: i32, y: i32, w: i32, h: i32) {
    BUBBLE_X.store(x, Ordering::Relaxed);
    BUBBLE_Y.store(y, Ordering::Relaxed);
    BUBBLE_W.store(w, Ordering::Relaxed);
    BUBBLE_H.store(h, Ordering::Relaxed);
}

/// Update permission prompt zone (logical CSS px). Pass x=-1 to disable.
pub fn update_permission_zone(x: i32, y: i32, w: i32, h: i32) {
    PERM_X.store(x, Ordering::Relaxed);
    PERM_Y.store(y, Ordering::Relaxed);
    PERM_W.store(w, Ordering::Relaxed);
    PERM_H.store(h, Ordering::Relaxed);
}

/// Update token panel zone (logical CSS px). Pass x=-1 to disable.
pub fn update_token_panel_zone(x: i32, y: i32, w: i32, h: i32) {
    TOKEN_PANEL_X.store(x, Ordering::Relaxed);
    TOKEN_PANEL_Y.store(y, Ordering::Relaxed);
    TOKEN_PANEL_W.store(w, Ordering::Relaxed);
    TOKEN_PANEL_H.store(h, Ordering::Relaxed);
}

/// Store the frontend's window.devicePixelRatio (multiplied by 1000).
pub fn update_frontend_dpr(dpr_x1000: u32) {
    FRONTEND_DPR_X1000.store(dpr_x1000, Ordering::Relaxed);
}

/// Get monitor bounds (physical pixels) for the monitor containing the given point.
/// Returns (left, top, width, height).
pub fn monitor_bounds_at_point(x: i32, y: i32) -> (i32, i32, i32, i32) {
    unsafe {
        let pt = POINT { x, y };
        let hmon = MonitorFromPoint(pt, MONITOR_DEFAULTTOPRIMARY);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(hmon, &mut info).as_bool() {
            let rc = info.rcMonitor;
            (rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top)
        } else {
            (0, 0, 1920, 1080)
        }
    }
}

/// Get primary monitor bounds (physical pixels).
pub fn get_primary_monitor_bounds() -> (i32, i32, i32, i32) {
    monitor_bounds_at_point(0, 0)
}

/// Get the bounding rectangle of the entire virtual desktop (all monitors).
/// Returns (left, top, width, height) in physical pixels.
pub fn get_virtual_desktop_bounds() -> (i32, i32, i32, i32) {
    unsafe {
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if w > 0 && h > 0 {
            (x, y, w, h)
        } else {
            get_primary_monitor_bounds()
        }
    }
}

/// Resize overlay window to cover a specific monitor.
pub unsafe fn resize_to_monitor(hwnd_raw: *mut std::ffi::c_void, x: i32, y: i32, w: i32, h: i32) {
    let hwnd = HWND(hwnd_raw);
    SetWindowPos(
        hwnd,
        HWND_TOPMOST,
        x, y, w, h,
        SWP_NOACTIVATE | SWP_FRAMECHANGED,
    ).ok();
    // Tell the shell explicitly that this window is NOT fullscreen, so the
    // taskbar's rudely-fullscreen detection doesn't demote the tray below
    // other app windows.
    mark_not_fullscreen(hwnd_raw);
}

/// Tell the Windows shell that `hwnd` is NOT in fullscreen mode. This
/// prevents the taskbar from auto-hiding / being pushed below other app
/// windows because the shell misidentifies our transparent TOPMOST overlay
/// as a fullscreen application.
///
/// Safe to call multiple times. COM is lazily initialized on the current
/// thread if needed; failures are logged and swallowed.
pub fn mark_not_fullscreen(hwnd_raw: *mut std::ffi::c_void) {
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{ITaskbarList2, TaskbarList};

    unsafe {
        // CoInitializeEx may return S_FALSE if COM is already initialized on
        // this thread — that's fine, we still proceed.
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let taskbar: Result<ITaskbarList2, _> =
            CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER);
        let Ok(taskbar) = taskbar else {
            return;
        };
        if taskbar.HrInit().is_err() {
            return;
        }
        let hwnd = HWND(hwnd_raw);
        let _ = taskbar.MarkFullscreenWindow(hwnd, false);
    }
}

/// Check if the OS cursor is currently over the mascot or popup areas.
///
/// Uses dynamic mascot position from frontend (MASCOT_X/Y/W/H atomics).
/// All coordinates scaled from logical CSS pixels to physical screen pixels.
/// Relaxed ordering on MASCOT_X/Y/W/H: written by one IPC thread, read by one poll thread.
/// Brief cross-atomic inconsistency (1-2 frames) is imperceptible and harmless.
pub fn is_cursor_in_interactive_area(hwnd_raw: usize) -> bool {
    // During drag, always report interactive to prevent click-through race
    if DRAGGING.load(Ordering::Relaxed) {
        return true;
    }
    unsafe {
        let hwnd = HWND(hwnd_raw as *mut std::ffi::c_void);
        let mut cursor = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut cursor).is_err() {
            return false;
        }
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return false;
        }

        let in_window = cursor.x >= rect.left
            && cursor.x < rect.right
            && cursor.y >= rect.top
            && cursor.y < rect.bottom;
        if !in_window {
            return false;
        }

        // Use the frontend-reported devicePixelRatio when available.
        // This guarantees the hit-test scale matches WebView2's actual rendering,
        // even on multi-monitor setups where GetDpiForWindow may disagree with
        // the WebView's DPI context.
        let frontend_dpr = FRONTEND_DPR_X1000.load(Ordering::Relaxed);
        let window_dpi = GetDpiForWindow(hwnd);
        let scale = if frontend_dpr > 0 {
            frontend_dpr as f64 / 1000.0
        } else if window_dpi > 0 {
            window_dpi as f64 / 96.0
        } else {
            1.0
        };

        let client_x = cursor.x - rect.left;
        let client_y = cursor.y - rect.top;

        // Read dynamic mascot position (logical CSS px) and scale to physical
        let mx = (MASCOT_X.load(Ordering::Relaxed) as f64 * scale) as i32;
        let my = (MASCOT_Y.load(Ordering::Relaxed) as f64 * scale) as i32;
        let mw = (MASCOT_W.load(Ordering::Relaxed) as f64 * scale) as i32;
        let mh = (MASCOT_H.load(Ordering::Relaxed) as f64 * scale) as i32;

        let in_mascot = client_x >= mx && client_x < mx + mw
            && client_y >= my && client_y < my + mh;

        // Working bubble zone: exact position sent by frontend
        let bubble_on = WORKING_BUBBLE_VISIBLE.load(Ordering::Relaxed);
        let bx = BUBBLE_X.load(Ordering::Relaxed);
        let in_bubble = bubble_on && bx >= 0 && {
            let bx = (bx as f64 * scale) as i32;
            let by = (BUBBLE_Y.load(Ordering::Relaxed) as f64 * scale) as i32;
            let bw = (BUBBLE_W.load(Ordering::Relaxed) as f64 * scale) as i32;
            let bh = (BUBBLE_H.load(Ordering::Relaxed) as f64 * scale) as i32;
            client_x >= bx && client_x < bx + bw && client_y >= by && client_y < by + bh
        };

        // Permission zone: exact position sent by frontend
        let perm_on = PERMISSION_HIT_VISIBLE.load(Ordering::Relaxed);
        let px = PERM_X.load(Ordering::Relaxed);
        let in_perm = perm_on && px >= 0 && {
            let px = (px as f64 * scale) as i32;
            let py = (PERM_Y.load(Ordering::Relaxed) as f64 * scale) as i32;
            let pw = (PERM_W.load(Ordering::Relaxed) as f64 * scale) as i32;
            let ph = (PERM_H.load(Ordering::Relaxed) as f64 * scale) as i32;
            client_x >= px && client_x < px + pw && client_y >= py && client_y < py + ph
        };

        // Token panel zone: exact position sent by frontend
        let token_on = TOKEN_PANEL_VISIBLE.load(Ordering::Relaxed);
        let tx = TOKEN_PANEL_X.load(Ordering::Relaxed);
        let in_token = token_on && tx >= 0 && {
            let tx = (tx as f64 * scale) as i32;
            let ty = (TOKEN_PANEL_Y.load(Ordering::Relaxed) as f64 * scale) as i32;
            let tw = (TOKEN_PANEL_W.load(Ordering::Relaxed) as f64 * scale) as i32;
            let th = (TOKEN_PANEL_H.load(Ordering::Relaxed) as f64 * scale) as i32;
            client_x >= tx && client_x < tx + tw && client_y >= ty && client_y < ty + th
        };

        in_mascot || in_perm || in_bubble || in_token
    }
}

/// Collect diagnostic info for remote debugging of multi-monitor hit-test issues.
pub fn collect_debug_info(hwnd_raw: usize) -> serde_json::Value {
    unsafe {
        let hwnd = HWND(hwnd_raw as *mut std::ffi::c_void);

        // Window rect
        let mut rect = RECT::default();
        let _ = GetWindowRect(hwnd, &mut rect);

        // Virtual desktop
        let (vx, vy, vw, vh) = get_virtual_desktop_bounds();

        // Window DPI
        let window_dpi = GetDpiForWindow(hwnd);

        // Frontend DPR
        let frontend_dpr_x1000 = FRONTEND_DPR_X1000.load(Ordering::Relaxed);

        // Cursor info
        let mut cursor = POINT { x: 0, y: 0 };
        let _ = GetCursorPos(&mut cursor);
        let hmon_cursor = MonitorFromPoint(cursor, MONITOR_DEFAULTTOPRIMARY);
        let mut cursor_dpi_x: u32 = 96;
        let mut cursor_dpi_y: u32 = 96;
        let _ = GetDpiForMonitor(hmon_cursor, MDT_EFFECTIVE_DPI, &mut cursor_dpi_x, &mut cursor_dpi_y);

        // Mascot zone
        let mx = MASCOT_X.load(Ordering::Relaxed);
        let my = MASCOT_Y.load(Ordering::Relaxed);
        let mw = MASCOT_W.load(Ordering::Relaxed);
        let mh = MASCOT_H.load(Ordering::Relaxed);

        // Effective scale used by hit-test
        let scale = if frontend_dpr_x1000 > 0 {
            frontend_dpr_x1000 as f64 / 1000.0
        } else if window_dpi > 0 {
            window_dpi as f64 / 96.0
        } else {
            1.0
        };

        // Enumerate all monitors
        let mut monitors: Vec<serde_json::Value> = Vec::new();
        unsafe extern "system" fn enum_cb(
            hmon: HMONITOR,
            _hdc: HDC,
            _lprect: *mut RECT,
            lparam: LPARAM,
        ) -> BOOL {
            let list = &mut *(lparam.0 as *mut Vec<serde_json::Value>);
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if GetMonitorInfoW(hmon, &mut info).as_bool() {
                let rc = info.rcMonitor;
                let wa = info.rcWork;
                let mut dpi_x: u32 = 96;
                let mut dpi_y: u32 = 96;
                let _ = GetDpiForMonitor(hmon, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y);
                let primary = (info.dwFlags & 1) != 0; // MONITORINFOF_PRIMARY
                list.push(serde_json::json!({
                    "bounds": [rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top],
                    "workArea": [wa.left, wa.top, wa.right - wa.left, wa.bottom - wa.top],
                    "dpi": [dpi_x, dpi_y],
                    "primary": primary,
                }));
            }
            BOOL(1) // continue
        }
        let _ = EnumDisplayMonitors(
            HDC::default(),
            None,
            Some(enum_cb),
            LPARAM(&mut monitors as *mut Vec<serde_json::Value> as isize),
        );

        serde_json::json!({
            "windowRect": [rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top],
            "virtualDesktop": [vx, vy, vw, vh],
            "windowDpi": window_dpi,
            "frontendDprX1000": frontend_dpr_x1000,
            "effectiveScale": scale,
            "cursor": [cursor.x, cursor.y],
            "cursorMonitorDpi": [cursor_dpi_x, cursor_dpi_y],
            "mascotCss": [mx, my, mw, mh],
            "mascotPhysical": [
                (mx as f64 * scale) as i32,
                (my as f64 * scale) as i32,
                (mw as f64 * scale) as i32,
                (mh as f64 * scale) as i32,
            ],
            "monitors": monitors,
        })
    }
}
