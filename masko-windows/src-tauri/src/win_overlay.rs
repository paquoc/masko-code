//! Windows overlay: frameless window + cursor-based click-through.
//!
//! WebView2 uses DirectComposition, so `WM_NCHITTEST` subclassing on child HWNDs
//! does not work. Instead we poll cursor position (~60 fps) and emit to the frontend,
//! which then toggles `setIgnoreCursorEvents` via Tauri JS API (handles WebView2 properly).
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};

use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Dwm::*;
use windows::Win32::UI::WindowsAndMessaging::*;

static ORIGINAL_WNDPROC: AtomicIsize = AtomicIsize::new(0);
pub static PERMISSION_HIT_VISIBLE: AtomicBool = AtomicBool::new(false);

const WM_NCACTIVATE: u32 = 0x0086;
const WM_NCPAINT: u32 = 0x0085;

const MASCOT_HEIGHT_PX: i32 = 200;
const PERMISSION_BAND_PX: i32 = 280;

unsafe extern "system" fn overlay_wndproc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let original: WNDPROC = std::mem::transmute(ORIGINAL_WNDPROC.load(Ordering::Relaxed));

    match msg {
        WM_NCACTIVATE => {
            return CallWindowProcW(original, hwnd, msg, wparam, LPARAM(-1));
        }
        WM_NCPAINT => {
            return LRESULT(0);
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
    let clean = (style
        & !(WS_CAPTION.0
            | WS_THICKFRAME.0
            | WS_SYSMENU.0
            | WS_MINIMIZEBOX.0
            | WS_MAXIMIZEBOX.0
            | WS_OVERLAPPEDWINDOW.0))
        | WS_POPUP.0;
    SetWindowLongW(hwnd, GWL_STYLE, clean as i32);

    let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
    let clean_ex = (ex
        & !WS_EX_DLGMODALFRAME.0
        & !WS_EX_APPWINDOW.0
        & !WS_EX_WINDOWEDGE.0)
        | WS_EX_NOACTIVATE.0
        | WS_EX_TOOLWINDOW.0;
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

/// Check if the OS cursor is currently over the mascot or permission area.
pub fn is_cursor_in_interactive_area(hwnd_raw: usize) -> bool {
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

        let h = rect.bottom - rect.top;
        let client_y = cursor.y - rect.top;
        let in_mascot = client_y >= h - MASCOT_HEIGHT_PX;
        let perm_on = PERMISSION_HIT_VISIBLE.load(Ordering::Relaxed);
        let in_perm = perm_on
            && client_y >= (h - MASCOT_HEIGHT_PX - PERMISSION_BAND_PX).max(0)
            && client_y < h - MASCOT_HEIGHT_PX;
        in_mascot || in_perm
    }
}
