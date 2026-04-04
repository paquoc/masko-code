use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;

use windows::{
    core::PCWSTR,
    Win32::System::Registry::*,
};

const REG_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const APP_NAME: &str = "Masko";

fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

pub fn is_enabled() -> bool {
    unsafe {
        let path = to_wide(REG_PATH);
        let mut hkey = HKEY::default();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(path.as_ptr()),
            0,
            KEY_READ,
            &mut hkey,
        )
        .is_err()
        {
            return false;
        }

        let name = to_wide(APP_NAME);
        let mut data_size = 0u32;
        let result = RegQueryValueExW(
            hkey,
            PCWSTR(name.as_ptr()),
            None,
            None,
            None,
            Some(&mut data_size),
        );
        let _ = RegCloseKey(hkey);
        result.is_ok() && data_size > 0
    }
}

pub fn set_enabled(enabled: bool) -> Result<(), String> {
    unsafe {
        let path = to_wide(REG_PATH);
        let mut hkey = HKEY::default();
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(path.as_ptr()),
            0,
            KEY_WRITE,
            &mut hkey,
        )
        .ok()
        .map_err(|e| e.to_string())?;

        let name = to_wide(APP_NAME);

        let result = if enabled {
            let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
            let exe_str = exe_path.to_string_lossy();
            let value_wide = to_wide(&exe_str);
            let value_bytes = std::slice::from_raw_parts(
                value_wide.as_ptr() as *const u8,
                value_wide.len() * 2,
            );
            RegSetValueExW(
                hkey,
                PCWSTR(name.as_ptr()),
                0,
                REG_SZ,
                Some(value_bytes),
            )
            .ok()
            .map_err(|e| e.to_string())
        } else {
            // Ignore "value not found" — treat as already disabled
            RegDeleteValueW(hkey, PCWSTR(name.as_ptr()))
                .ok()
                .map_err(|e| e.to_string())
                .or(Ok(()))
        };

        let _ = RegCloseKey(hkey);
        result
    }
}
