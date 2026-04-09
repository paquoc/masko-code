// src-tauri/src/telegram/config.rs

use std::path::{Path, PathBuf};

use crate::telegram::types::TelegramConfig;

/// Load config from the given path. Returns default config if the file
/// is missing. Returns Err on IO or parse failure.
/// Migrates legacy single `enabled` field → `polling_enabled` + `sending_enabled`.
pub fn load_from(path: &Path) -> Result<TelegramConfig, String> {
    match std::fs::read_to_string(path) {
        Ok(raw) => {
            let mut v: serde_json::Value =
                serde_json::from_str(&raw).map_err(|e| format!("parse: {e}"))?;
            if let Some(obj) = v.as_object_mut() {
                if obj.contains_key("enabled") && !obj.contains_key("polling_enabled") {
                    let was_enabled = obj
                        .get("enabled")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    obj.insert("polling_enabled".into(), serde_json::Value::Bool(was_enabled));
                    obj.insert("sending_enabled".into(), serde_json::Value::Bool(was_enabled));
                    obj.remove("enabled");
                }
            }
            serde_json::from_value(v).map_err(|e| format!("parse: {e}"))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(TelegramConfig::default())
        }
        Err(e) => Err(format!("read: {e}")),
    }
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

    #[test]
    fn load_missing_file_returns_default() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("telegram.json");
        let cfg = load_from(&p).expect("should succeed on missing");
        assert!(!cfg.polling_enabled);
        assert!(!cfg.sending_enabled);
        assert!(cfg.bot_token.is_empty());
        assert!(cfg.chat_id.is_empty());
    }

    #[test]
    fn save_then_load_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("telegram.json");
        let original = TelegramConfig {
            polling_enabled: true,
            sending_enabled: true,
            bot_token: "123:abc".into(),
            chat_id: "9876".into(),
        };
        save_to(&p, &original).unwrap();
        let loaded = load_from(&p).unwrap();
        assert!(loaded.polling_enabled);
        assert!(loaded.sending_enabled);
        assert_eq!(loaded.bot_token, "123:abc");
        assert_eq!(loaded.chat_id, "9876");
    }

    #[test]
    fn migrate_legacy_enabled_field() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("telegram.json");
        std::fs::write(
            &p,
            r#"{"enabled":true,"bot_token":"tok","chat_id":"cid"}"#,
        )
        .unwrap();
        let loaded = load_from(&p).unwrap();
        assert!(loaded.polling_enabled);
        assert!(loaded.sending_enabled);
        assert_eq!(loaded.bot_token, "tok");
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

    #[test]
    fn no_migration_when_new_fields_present() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("telegram.json");
        std::fs::write(
            &p,
            r#"{"polling_enabled":true,"sending_enabled":false,"bot_token":"t","chat_id":"c"}"#,
        )
        .unwrap();
        let loaded = load_from(&p).unwrap();
        assert!(loaded.polling_enabled);
        assert!(!loaded.sending_enabled);
    }
}
