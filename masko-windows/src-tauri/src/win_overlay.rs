//! Windows overlay: frameless window + cursor-based click-through.
//!
//! Click-through: poll cursor ~60fps, emit to frontend which toggles
//! `setIgnoreCursorEvents` (required for WebView2 DirectComposition).
//!
//! Frame suppression: WM_STYLECHANGING intercepts ALL style changes and strips
//! frame/decoration bits before they apply. This prevents the frame flash that
//! `setIgnoreCursorEvents` normally causes (it calls SetWindowPos(SWP_FRAMECHANGED)
//! internally, but since our handler enforces frameless styles, nothing visible changes).
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};

use std::sync::atomic::AtomicI32;

use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Dwm::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::*;

static ORIGINAL_WNDPROC: AtomicIsize = AtomicIsize::new(0);
pub static PERMISSION_HIT_VISIBLE: AtomicBool = AtomicBool::new(false);
pub static WORKING_BUBBLE_VISIBLE: AtomicBool = AtomicBool::new(false);
/// When true, cursor polling always reports interactive (suppresses click-through during drag)
pub static DRAGGING: AtomicBool = AtomicBool::new(false);

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
                    | WS_EX_NOACTIVATE.0
                    | WS_EX_TOOLWINDOW.0;
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

        let dpi = GetDpiForWindow(hwnd);
        let scale = if dpi > 0 { dpi as f64 / 96.0 } else { 1.0 };

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

        in_mascot || in_perm || in_bubble
    }
}
