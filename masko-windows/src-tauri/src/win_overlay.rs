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
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::WindowsAndMessaging::*;

static ORIGINAL_WNDPROC: AtomicIsize = AtomicIsize::new(0);
pub static PERMISSION_HIT_VISIBLE: AtomicBool = AtomicBool::new(false);
pub static WORKING_BUBBLE_VISIBLE: AtomicBool = AtomicBool::new(false);

const WM_NCPAINT: u32 = 0x0085;
const WM_NCACTIVATE: u32 = 0x0086;
const WM_STYLECHANGING: u32 = 0x007C;

const MASCOT_HEIGHT_PX: i32 = 200;
const PERMISSION_BAND_PX: i32 = 280;
const WORKING_BUBBLE_PX: i32 = 80;

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
///
/// All coordinates here are physical (screen) pixels from GetWindowRect / GetCursorPos.
/// The CSS layout uses logical pixels, so we must scale by the DPI factor.
/// WebView2 on Windows reports DPI via the monitor's scale factor.
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

        // Get DPI scale for this window's monitor
        let dpi = GetDpiForWindow(hwnd);
        let scale = if dpi > 0 { dpi as f64 / 96.0 } else { 1.0 };

        let h = rect.bottom - rect.top;
        let client_y = cursor.y - rect.top;

        // Scale CSS logical pixel constants to physical pixels
        let mascot_h = (MASCOT_HEIGHT_PX as f64 * scale) as i32;
        let perm_h = (PERMISSION_BAND_PX as f64 * scale) as i32;
        let bubble_h = (WORKING_BUBBLE_PX as f64 * scale) as i32;

        let in_mascot = client_y >= h - mascot_h;
        let perm_on = PERMISSION_HIT_VISIBLE.load(Ordering::Relaxed);
        let in_perm = perm_on
            && client_y >= (h - mascot_h - perm_h).max(0)
            && client_y < h - mascot_h;
        let bubble_on = WORKING_BUBBLE_VISIBLE.load(Ordering::Relaxed);
        let in_bubble = bubble_on
            && client_y >= (h - mascot_h - bubble_h).max(0)
            && client_y < h - mascot_h;
        in_mascot || in_perm || in_bubble
    }
}

/// Bring the window belonging to the given process ID to the foreground.
/// Walks up the process tree to find the top-level window (e.g. Cursor's main
/// window may belong to a parent process, not the PID we were given).
/// Uses an Alt-key trick to bypass Windows' SetForegroundWindow restriction
/// (only the foreground app is normally allowed to steal focus).
pub fn focus_window_by_pid(pid: u32) {
    unsafe {
        // Collect candidate PIDs: the given PID + its ancestors (max 8 levels)
        let mut pids = vec![pid];
        let mut cur = pid;
        for _ in 0..8 {
            if let Some(parent) = get_parent_pid(cur) {
                if parent == 0 || pids.contains(&parent) { break; }
                pids.push(parent);
                cur = parent;
            } else {
                break;
            }
        }

        // Find a visible top-level window belonging to any of those PIDs
        let mut data = FindWindowData {
            target_pids: pids,
            found_hwnd: 0,
        };
        let _ = EnumWindows(
            Some(enum_windows_cb),
            LPARAM(&mut data as *mut FindWindowData as isize),
        );
        if data.found_hwnd != 0 {
            let hwnd = HWND(data.found_hwnd as *mut std::ffi::c_void);
            // Alt-key trick: simulate an Alt press so Windows allows us to
            // call SetForegroundWindow from a background process.
            let alt_input = INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_MENU,
                        ..Default::default()
                    },
                },
            };
            let _ = SendInput(&[alt_input], std::mem::size_of::<INPUT>() as i32);
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
            // Release Alt key
            let alt_up = INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_MENU,
                        dwFlags: KEYEVENTF_KEYUP,
                        ..Default::default()
                    },
                },
            };
            let _ = SendInput(&[alt_up], std::mem::size_of::<INPUT>() as i32);
        }
    }
}

/// Get parent PID via Win32_Process (lightweight snapshot approach)
fn get_parent_pid(pid: u32) -> Option<u32> {
    use windows::Win32::System::Diagnostics::ToolHelp::*;
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                if entry.th32ProcessID == pid {
                    let _ = windows::Win32::Foundation::CloseHandle(snap);
                    return Some(entry.th32ParentProcessID);
                }
                if Process32NextW(snap, &mut entry).is_err() { break; }
            }
        }
        let _ = windows::Win32::Foundation::CloseHandle(snap);
        None
    }
}

struct FindWindowData {
    target_pids: Vec<u32>,
    found_hwnd: isize, // 0 = not found
}

unsafe extern "system" fn enum_windows_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let data = &mut *(lparam.0 as *mut FindWindowData);

    let mut proc_id: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut proc_id));

    if data.target_pids.contains(&proc_id) && IsWindowVisible(hwnd).as_bool() {
        // Pick the main window (has no owner)
        if let Ok(owner) = GetWindow(hwnd, GW_OWNER) {
            if !owner.0.is_null() {
                return BOOL(1); // has owner — skip
            }
        }
        data.found_hwnd = hwnd.0 as isize;
        return BOOL(0); // stop enumeration
    }
    BOOL(1) // continue
}
