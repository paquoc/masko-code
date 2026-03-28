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

use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Dwm::*;
use windows::Win32::UI::WindowsAndMessaging::*;

static ORIGINAL_WNDPROC: AtomicIsize = AtomicIsize::new(0);
pub static PERMISSION_HIT_VISIBLE: AtomicBool = AtomicBool::new(false);

const WM_NCPAINT: u32 = 0x0085;
const WM_NCACTIVATE: u32 = 0x0086;
const WM_STYLECHANGING: u32 = 0x007C;

const MASCOT_HEIGHT_PX: i32 = 200;
const PERMISSION_BAND_PX: i32 = 280;

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
