// src-tauri/src/telegram/config.rs
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use crate::telegram::types::TelegramConfig;

/// Load config from the given path. Returns default config if the file
/// is missing. Returns Err on IO or parse failure.
pub fn load_from(path: &Path) -> Result<TelegramConfig, String> {
    if !path.exists() {
        return Ok(TelegramConfig::default());
    }
    let raw = std::fs::read_to_string(path).map_err(|e| format!("read: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("parse: {e}"))
}

/// Save atomically: write to `<path>.tmp` then rename over `<path>`.
pub fn save_to(path: &Path, cfg: &TelegramConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&tmp, raw).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}

/// Resolve the path to `telegram.json` inside the Tauri app data dir.
pub fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    Ok(dir.join("telegram.json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telegram::types::TelegramConfig;

    #[test]
    fn load_missing_file_returns_default() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("telegram.json");
        let cfg = load_from(&p).expect("should succeed on missing");
        assert!(!cfg.enabled);
        assert!(cfg.bot_token.is_empty());
        assert!(cfg.chat_id.is_empty());
    }

    #[test]
    fn save_then_load_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("telegram.json");
        let original = TelegramConfig {
            enabled: true,
            bot_token: "123:abc".into(),
            chat_id: "9876".into(),
        };
        save_to(&p, &original).unwrap();
        let loaded = load_from(&p).unwrap();
        assert!(loaded.enabled);
        assert_eq!(loaded.bot_token, "123:abc");
        assert_eq!(loaded.chat_id, "9876");
    }

    #[test]
    fn save_is_atomic_via_tmp_rename() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("telegram.json");
        let cfg = TelegramConfig::default();
        save_to(&p, &cfg).unwrap();
        // The .tmp file should NOT be left behind.
        assert!(p.exists());
        assert!(!p.with_extension("json.tmp").exists());
    }

    #[test]
    fn is_configured_requires_both_fields() {
        let mut c = TelegramConfig::default();
        assert!(!c.is_configured());
        c.bot_token = "tok".into();
        assert!(!c.is_configured());
        c.chat_id = "cid".into();
        assert!(c.is_configured());
        c.chat_id = "   ".into();
        assert!(!c.is_configured(), "whitespace should not count");
    }
}
