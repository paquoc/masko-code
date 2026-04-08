# Telegram Bot Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user approve, deny, or redirect Claude Code permission requests remotely through a Telegram bot, with one active permission at a time and no changes to the existing permission hook contract.

**Architecture:** The Telegram bot runs entirely in the Rust backend (tokio task, `reqwest` long-poll). It hooks into the existing `server.rs::handle_hook` flow to push a message when a permission request arrives, and into `commands.rs::resolve_permission` to sync messages when a resolve happens locally. Responses flow back to the frontend via Tauri events, where a new `telegram-store` calls the existing `permissionStore.resolve()` path. No changes to the Claude Code hook contract.

**Tech Stack:** Rust (tokio, reqwest, serde), Solid.js, Tauri 2, existing `tauri-plugin-notification`.

**Spec:** [docs/superpowers/specs/2026-04-08-telegram-bot-integration-design.md](../specs/2026-04-08-telegram-bot-integration-design.md)

---

## File Structure

### New files (Rust)

| Path                                        | Responsibility |
| ------------------------------------------- | -------------- |
| `src-tauri/src/telegram/mod.rs`             | Public API (`TelegramManager`, `init`, `push_permission`, `on_local_resolved`), orchestration, Tauri event emission |
| `src-tauri/src/telegram/config.rs`          | `TelegramConfig` struct + atomic load/save to `app_data_dir/telegram.json` |
| `src-tauri/src/telegram/types.rs`           | DTOs: `Update`, `Message`, `CallbackQuery`, `InlineKeyboard*`, `TelegramStatus`, `PollerCmd`, `TelegramError` |
| `src-tauri/src/telegram/client.rs`          | `TelegramClient` — thin `reqwest` wrapper around 5 Bot API endpoints |
| `src-tauri/src/telegram/formatter.rs`       | `build_html(AgentEvent) -> String`, `html_escape`, `display_label_for(suggestion)`, `truncate_pre` |
| `src-tauri/src/telegram/state.rs`           | `QueueState` — `ActivePermission` + `VecDeque<Queued>` with `push`, `resolve_active`, `remove_by_request_id` |
| `src-tauri/src/telegram/poller.rs`          | `run_poller` long-poll loop, error classification, update dispatch |

### New files (Frontend)

| Path                                 | Responsibility |
| ------------------------------------ | -------------- |
| `src/stores/telegram-store.ts`       | Reactive `TelegramStatus`, Tauri event listeners, wrapper commands |

### Modified files

| Path                                                  | What changes |
| ----------------------------------------------------- | ------------ |
| `src-tauri/Cargo.toml`                                | Verify `reqwest = { version = "0.12", features = ["json"] }` (already present); no new deps expected |
| `src-tauri/src/lib.rs`                                | Declare `mod telegram;`, add Telegram-related commands to `invoke_handler!`, call `telegram::init(app.handle())` in setup |
| `src-tauri/src/commands.rs`                           | Add 5 new Tauri commands; extend `resolve_permission` to call `telegram::on_local_resolved` after sending HTTP response |
| `src-tauri/src/server.rs`                             | In `handle_hook` permission branch, after emitting events call `telegram::push_permission` |
| `src/App.tsx`                                         | Call `initTelegramStore()` on mount (dashboard window) |
| `src/overlay-entry.tsx`                               | Call `initTelegramStore()` on mount (overlay window — mascot menu needs the store) |
| `src/components/dashboard/SettingsPanel.tsx`         | Add `<TelegramSection />` between existing sections |
| `src/components/overlay/MascotOverlay.tsx`           | Add Telegram `MenuRow` in `ContextMenu` |

### Unchanged but referenced

- `src/stores/permission-store.ts` — `resolve()` keeps its signature. The store absorbs telegram responses transparently.
- `src/models/permission.ts` — raw suggestion shape is preserved; `parsePermissionSuggestions` already handles camelCase fields.
- `src-tauri/src/models.rs::AgentEvent` — already has all fields the formatter needs (`cwd`, `tool_name`, `tool_input`, `permission_suggestions`).

---

## Task 0: Baseline verification & branch setup

**Files:**
- No changes

- [ ] **Step 1: Verify current branch**

Run: `git branch --show-current`
Expected: `telegram` (or whatever worktree branch you were handed). If not on a feature branch, stop and ask for guidance.

- [ ] **Step 2: Verify baseline builds**

Run: `cd src-tauri && cargo check` and `cd .. && npm run build` (from project root).
Expected: both succeed. If either fails before you touch anything, stop and report.

- [ ] **Step 3: Verify `reqwest` is already a dependency**

Run: `grep "^reqwest" src-tauri/Cargo.toml`
Expected: line `reqwest = { version = "0.12", features = ["json"] }`. No new dep needed.

---

## Task 1: Rust — `telegram/types.rs` (DTOs)

**Files:**
- Create: `src-tauri/src/telegram/types.rs`

- [ ] **Step 1: Write minimal types with doc comments**

```rust
//! Wire + internal types for the Telegram module.
//!
//! These are intentionally minimal — only the fields we actually read are
//! deserialized. Extra fields from the Bot API are ignored via serde default.

use serde::{Deserialize, Serialize};

/// Persisted config (mirrors `telegram.json` on disk).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TelegramConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub bot_token: String,
    #[serde(default)]
    pub chat_id: String,
}

impl TelegramConfig {
    /// True iff both bot_token and chat_id are non-empty (trimmed).
    pub fn is_configured(&self) -> bool {
        !self.bot_token.trim().is_empty() && !self.chat_id.trim().is_empty()
    }
}

/// Status emitted to the frontend (never contains bot_token).
#[derive(Debug, Clone, Default, Serialize)]
pub struct TelegramStatus {
    pub configured: bool,
    pub enabled: bool,
    pub error: Option<String>,
    pub bot_username: Option<String>,
}

/// DTO returned by `telegram_get_config` — token IS included here per spec.
#[derive(Debug, Clone, Serialize)]
pub struct TelegramConfigDto {
    pub bot_token: String,
    pub chat_id: String,
}

/// Result of `telegram_test` command.
#[derive(Debug, Clone, Serialize)]
pub struct TelegramTestResult {
    pub bot_username: String,
    pub bot_first_name: String,
    pub chat_tested: bool,
}

// ----- Bot API wire types (minimal) -----

#[derive(Debug, Clone, Deserialize)]
pub struct Update {
    pub update_id: i64,
    #[serde(default)]
    pub message: Option<Message>,
    #[serde(default)]
    pub callback_query: Option<CallbackQuery>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Message {
    pub message_id: i64,
    pub chat: Chat,
    #[serde(default)]
    pub from: Option<User>,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Chat {
    pub id: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct User {
    pub id: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CallbackQuery {
    pub id: String,
    pub from: User,
    #[serde(default)]
    pub message: Option<Message>,
    #[serde(default)]
    pub data: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BotUser {
    pub username: String,
    pub first_name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SentMessage {
    pub message_id: i64,
}

// ----- Inline keyboard (outgoing) -----

#[derive(Debug, Clone, Serialize)]
pub struct InlineKeyboardMarkup {
    pub inline_keyboard: Vec<Vec<InlineKeyboardButton>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InlineKeyboardButton {
    pub text: String,
    pub callback_data: String,
}

// ----- Poller control + errors -----

#[derive(Debug, Clone)]
pub enum PollerCmd {
    Stop,
    ConfigChanged,
}

#[derive(Debug, thiserror::Error)]
pub enum TelegramError {
    #[error("unauthorized (invalid bot token)")]
    Unauthorized,
    #[error("too many requests (retry after {0}s)")]
    TooManyRequests(u64),
    #[error("conflict (another getUpdates instance)")]
    Conflict,
    #[error("server error: {0}")]
    Server(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("not configured")]
    NotConfigured,
    #[error("bot api error: {0}")]
    Api(String),
}
```

- [ ] **Step 2: Add `thiserror` if missing**

Run: `grep "^thiserror" src-tauri/Cargo.toml`
If missing, add `thiserror = "1"` to `[dependencies]` in `src-tauri/Cargo.toml`.

- [ ] **Step 3: Create `src-tauri/src/telegram/mod.rs` stub so the new module compiles**

```rust
pub mod config;
pub mod types;
pub mod client;
pub mod formatter;
pub mod state;
pub mod poller;

// Public re-exports will be added as the module grows.
```

NOTE: the sub-modules `config/client/formatter/state/poller` don't exist yet — this step only creates the parent. You will create each submodule in its own task. Between tasks `cargo check` will fail until all stubs exist. **Add empty file stubs for each** so the module tree resolves:

```bash
touch src-tauri/src/telegram/config.rs
touch src-tauri/src/telegram/client.rs
touch src-tauri/src/telegram/formatter.rs
touch src-tauri/src/telegram/state.rs
touch src-tauri/src/telegram/poller.rs
```

- [ ] **Step 4: Declare the module in `lib.rs`**

Open `src-tauri/src/lib.rs`. After line `mod tray;` add:

```rust
mod telegram;
```

- [ ] **Step 5: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: builds cleanly (empty stubs produce warnings for unused imports in `types.rs`, which is fine at this stage — use `#[allow(dead_code)]` on the file top if needed).

Add `#![allow(dead_code)]` at the top of `telegram/types.rs` and `telegram/mod.rs` temporarily — remove at the end of Task 9.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/telegram/ src-tauri/src/lib.rs
git commit -m "feat(telegram): scaffold telegram module with DTO types"
```

---

## Task 2: Rust — `telegram/config.rs` (atomic load/save)

**Files:**
- Create: `src-tauri/src/telegram/config.rs` (replacing the empty stub)

- [ ] **Step 1: Write the first failing test — default load when file missing**

```rust
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
```

- [ ] **Step 2: Add `tempfile` as a dev dependency**

In `src-tauri/Cargo.toml`, add (or ensure) under `[dev-dependencies]`:

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 3: Run the tests**

Run: `cd src-tauri && cargo test -p masko-windows --lib telegram::config`
Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/telegram/config.rs
git commit -m "feat(telegram): atomic config load/save with round-trip tests"
```

---

## Task 3: Rust — `telegram/formatter.rs` (HTML message builder)

**Files:**
- Create: `src-tauri/src/telegram/formatter.rs` (replacing empty stub)

- [ ] **Step 1: Write the failing tests first**

```rust
// src-tauri/src/telegram/formatter.rs
#![allow(dead_code)]

use serde_json::Value;

use crate::models::AgentEvent;

/// Build the HTML body for a Telegram permission message.
pub fn build_html(event: &AgentEvent) -> String {
    let folder = project_folder(event);
    let tool = event.tool_name.as_deref().unwrap_or("Unknown");
    let body = tool_body(tool, event.tool_input.as_ref());
    format!(
        "📁 <b>{folder}</b>\n🔧 <b>{tool}</b>\n{body}\n<i>💬 Chat để bảo tôi làm gì khác</i>",
        folder = html_escape(&folder),
        tool = html_escape(tool),
        body = body,
    )
}

/// Escape the three HTML-sensitive characters for Telegram HTML parse mode.
pub fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Truncate a string to `max` chars, appending "..." if truncated.
pub fn truncate_pre(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push_str("...");
        out
    }
}

fn project_folder(event: &AgentEvent) -> String {
    if let Some(cwd) = &event.cwd {
        if let Some(name) = std::path::Path::new(cwd).file_name() {
            return name.to_string_lossy().into_owned();
        }
        return cwd.clone();
    }
    "(unknown)".to_string()
}

fn tool_body(tool: &str, input: Option<&Value>) -> String {
    let input = match input {
        Some(v) => v,
        None => return format!("<code>{}</code>", html_escape(tool)),
    };
    match tool {
        "Bash" => {
            let cmd = input.get("command").and_then(|v| v.as_str()).unwrap_or("");
            let truncated = truncate_pre(cmd, 100);
            format!("<pre>{}</pre>", html_escape(&truncated))
        }
        "Edit" | "Write" | "Read" => {
            let path = input
                .get("file_path")
                .and_then(|v| v.as_str())
                .unwrap_or("(no path)");
            format!("{tool}: <code>{}</code>", html_escape(path))
        }
        "Grep" | "Glob" => {
            let pat = input
                .get("pattern")
                .and_then(|v| v.as_str())
                .unwrap_or("(no pattern)");
            format!("{tool}: <code>{}</code>", html_escape(pat))
        }
        _ => {
            let dumped = serde_json::to_string(input).unwrap_or_default();
            let short = truncate_pre(&dumped, 100);
            format!(
                "<code>{}</code> <code>{}</code>",
                html_escape(tool),
                html_escape(&short)
            )
        }
    }
}

/// Port of the display label logic from `src/models/permission.ts:21-59`.
/// Accepts a raw suggestion object (serde_json::Value) as received from the
/// Claude hook. Returns a short, human-readable label used as the middle
/// inline keyboard button.
pub fn display_label_for(suggestion: &Value) -> String {
    let typ = suggestion.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match typ {
        "addRules" => {
            let rules = suggestion.get("rules").and_then(|v| v.as_array());
            let first = rules.and_then(|r| r.first());
            if let Some(rule) = first {
                let tool_name = rule
                    .get("toolName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("tool");
                let rule_content = rule
                    .get("ruleContent")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if rule_content.contains("**") {
                    let folder = rule_content
                        .trim_end_matches("/**")
                        .rsplit('/')
                        .next()
                        .unwrap_or("");
                    return format!("Allow {tool_name} in {folder}/");
                }
                if !rule_content.is_empty() {
                    let short = if rule_content.chars().count() > 30 {
                        let s: String = rule_content.chars().take(27).collect();
                        format!("{s}...")
                    } else {
                        rule_content.to_string()
                    };
                    return format!("Always allow `{short}`");
                }
                return format!("Always allow {tool_name}");
            }
            "Add rule".into()
        }
        "setMode" => {
            let mode = suggestion.get("mode").and_then(|v| v.as_str()).unwrap_or("");
            match mode {
                "acceptEdits" => "Auto-accept edits".into(),
                "plan" => "Switch to plan mode".into(),
                other if !other.is_empty() => other.into(),
                _ => "Set mode".into(),
            }
        }
        other if !other.is_empty() => other.into(),
        _ => "Unknown".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn bash_event(cmd: &str) -> AgentEvent {
        AgentEvent {
            hook_event_name: "PermissionRequest".into(),
            session_id: None,
            cwd: Some("/tmp/masko-code".into()),
            permission_mode: None,
            transcript_path: None,
            tool_name: Some("Bash".into()),
            tool_input: Some(json!({ "command": cmd })),
            tool_response: None,
            tool_use_id: None,
            message: None,
            title: None,
            notification_type: None,
            source: None,
            reason: None,
            model: None,
            stop_hook_active: None,
            last_assistant_message: None,
            agent_id: None,
            agent_type: None,
            task_id: None,
            task_subject: None,
            permission_suggestions: None,
        }
    }

    #[test]
    fn build_html_bash_short_command() {
        let e = bash_event("npm test");
        let html = build_html(&e);
        assert!(html.contains("📁 <b>masko-code</b>"));
        assert!(html.contains("🔧 <b>Bash</b>"));
        assert!(html.contains("<pre>npm test</pre>"));
        assert!(html.contains("<i>💬 Chat để bảo tôi làm gì khác</i>"));
    }

    #[test]
    fn build_html_bash_truncates_long_command() {
        let long = "a".repeat(250);
        let e = bash_event(&long);
        let html = build_html(&e);
        // truncation: 100 chars + "..."
        assert!(html.contains(&format!("<pre>{}...</pre>", "a".repeat(100))));
    }

    #[test]
    fn html_escape_handles_special_chars() {
        let e = bash_event("echo <hi> & done");
        let html = build_html(&e);
        assert!(html.contains("<pre>echo &lt;hi&gt; &amp; done</pre>"));
        // Make sure we didn't double-escape
        assert!(!html.contains("&amp;lt;"));
    }

    #[test]
    fn tool_body_edit_shows_file_path() {
        let mut e = bash_event("");
        e.tool_name = Some("Edit".into());
        e.tool_input = Some(json!({ "file_path": "src/main.rs" }));
        let html = build_html(&e);
        assert!(html.contains("Edit: <code>src/main.rs</code>"));
    }

    #[test]
    fn tool_body_unknown_tool_falls_back_to_json() {
        let mut e = bash_event("");
        e.tool_name = Some("ExoticTool".into());
        e.tool_input = Some(json!({ "a": 1, "b": "two" }));
        let html = build_html(&e);
        assert!(html.contains("<code>ExoticTool</code>"));
    }

    #[test]
    fn project_folder_fallback_when_cwd_missing() {
        let mut e = bash_event("ls");
        e.cwd = None;
        let html = build_html(&e);
        assert!(html.contains("(unknown)"));
    }

    #[test]
    fn display_label_set_mode_accept_edits() {
        let s = json!({ "type": "setMode", "mode": "acceptEdits" });
        assert_eq!(display_label_for(&s), "Auto-accept edits");
    }

    #[test]
    fn display_label_add_rules_with_glob() {
        let s = json!({
            "type": "addRules",
            "rules": [{ "toolName": "Bash", "ruleContent": "npm run build/**" }]
        });
        assert_eq!(display_label_for(&s), "Allow Bash in build/");
    }

    #[test]
    fn display_label_add_rules_with_exact_content() {
        let s = json!({
            "type": "addRules",
            "rules": [{ "toolName": "Bash", "ruleContent": "git status" }]
        });
        assert_eq!(display_label_for(&s), "Always allow `git status`");
    }
}
```

- [ ] **Step 2: Run the tests**

Run: `cd src-tauri && cargo test -p masko-windows --lib telegram::formatter`
Expected: all 9 tests pass. If any fails, fix the implementation (not the test) until green.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/telegram/formatter.rs
git commit -m "feat(telegram): HTML message formatter with 9 unit tests"
```

---

## Task 4: Rust — `telegram/state.rs` (queue state machine)

**Files:**
- Create: `src-tauri/src/telegram/state.rs` (replacing empty stub)

- [ ] **Step 1: Write the implementation and tests together (TDD: tests first, then paste impl so tests compile)**

```rust
// src-tauri/src/telegram/state.rs
#![allow(dead_code)]

use std::collections::VecDeque;

use serde_json::Value;

use crate::models::AgentEvent;

/// Permission that is currently shown in Telegram and awaiting a response.
#[derive(Debug, Clone)]
pub struct ActivePermission {
    pub request_id: String,
    /// Telegram message_id of the posted permission message. Used to clear
    /// the inline keyboard when the permission is resolved.
    pub message_id: i64,
    /// The raw suggestion that was used as the middle button (if any).
    /// Preserved here so the callback handler can emit it back to the frontend.
    pub suggestion: Option<Value>,
}

#[derive(Debug, Clone)]
pub struct Queued {
    pub event: AgentEvent,
    pub request_id: String,
}

#[derive(Debug, Default)]
pub struct QueueState {
    pub active: Option<ActivePermission>,
    pub queue: VecDeque<Queued>,
}

/// Result of pushing a new permission into the queue.
#[derive(Debug, PartialEq, Eq)]
pub enum PushOutcome {
    /// Queue was idle — caller should `send_now`.
    ShouldSendNow,
    /// Another permission is active — this one is queued.
    Queued,
}

/// Result of removing a request_id that was resolved locally.
#[derive(Debug, PartialEq, Eq)]
pub enum RemoveOutcome {
    /// Nothing found with this request_id.
    NotFound,
    /// Removed from the pending queue (no Telegram message was ever sent).
    RemovedFromQueue,
    /// The active permission was removed. The caller should edit the Telegram
    /// message to clear the keyboard and then `send_next` if the returned
    /// `ActivePermission` has meaningful data. `next` is the next queued
    /// entry to send, if any.
    WasActive {
        previous: ActivePermission,
        next: Option<Queued>,
    },
}

impl QueueState {
    pub fn push(&mut self, event: AgentEvent, request_id: String) -> PushOutcome {
        if self.active.is_none() && self.queue.is_empty() {
            // The caller will set `active` once send_now returns a message_id.
            PushOutcome::ShouldSendNow
        } else if self.active.is_none() {
            // Shouldn't normally happen, but be defensive: treat as queued.
            self.queue.push_back(Queued { event, request_id });
            PushOutcome::Queued
        } else {
            self.queue.push_back(Queued { event, request_id });
            PushOutcome::Queued
        }
    }

    /// Called after a successful send_now — register the new active permission.
    pub fn set_active(&mut self, active: ActivePermission) {
        self.active = Some(active);
    }

    /// Clear the active permission and pop the next queued one, if any.
    /// Returns the popped entry.
    pub fn resolve_active(&mut self) -> Option<Queued> {
        self.active = None;
        self.queue.pop_front()
    }

    /// Remove a permission by request_id (used when the permission is
    /// resolved from the local UI while still pending in Telegram).
    pub fn remove_by_request_id(&mut self, request_id: &str) -> RemoveOutcome {
        if let Some(active) = &self.active {
            if active.request_id == request_id {
                let previous = self.active.take().unwrap();
                let next = self.queue.pop_front();
                return RemoveOutcome::WasActive { previous, next };
            }
        }
        let before = self.queue.len();
        self.queue.retain(|q| q.request_id != request_id);
        if self.queue.len() != before {
            RemoveOutcome::RemovedFromQueue
        } else {
            RemoveOutcome::NotFound
        }
    }

    /// Clear all state (used when config changes or polling is disabled).
    pub fn clear(&mut self) {
        self.active = None;
        self.queue.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_event() -> AgentEvent {
        AgentEvent {
            hook_event_name: "PermissionRequest".into(),
            session_id: None, cwd: None, permission_mode: None,
            transcript_path: None, tool_name: Some("Bash".into()),
            tool_input: None, tool_response: None, tool_use_id: None,
            message: None, title: None, notification_type: None,
            source: None, reason: None, model: None, stop_hook_active: None,
            last_assistant_message: None, agent_id: None, agent_type: None,
            task_id: None, task_subject: None, permission_suggestions: None,
        }
    }

    fn active(id: &str) -> ActivePermission {
        ActivePermission { request_id: id.into(), message_id: 1, suggestion: None }
    }

    #[test]
    fn push_while_idle_says_send_now() {
        let mut s = QueueState::default();
        assert_eq!(s.push(dummy_event(), "a".into()), PushOutcome::ShouldSendNow);
        assert!(s.active.is_none()); // caller has not called set_active yet
        assert!(s.queue.is_empty());
    }

    #[test]
    fn push_while_busy_queues() {
        let mut s = QueueState::default();
        s.set_active(active("a"));
        assert_eq!(s.push(dummy_event(), "b".into()), PushOutcome::Queued);
        assert_eq!(s.queue.len(), 1);
    }

    #[test]
    fn resolve_active_pops_next() {
        let mut s = QueueState::default();
        s.set_active(active("a"));
        s.push(dummy_event(), "b".into());
        s.push(dummy_event(), "c".into());
        let popped = s.resolve_active().expect("should pop b");
        assert_eq!(popped.request_id, "b");
        assert!(s.active.is_none());
        assert_eq!(s.queue.len(), 1);
    }

    #[test]
    fn resolve_active_when_queue_empty_returns_none() {
        let mut s = QueueState::default();
        s.set_active(active("a"));
        assert!(s.resolve_active().is_none());
    }

    #[test]
    fn remove_active_by_id() {
        let mut s = QueueState::default();
        s.set_active(active("a"));
        s.push(dummy_event(), "b".into());
        match s.remove_by_request_id("a") {
            RemoveOutcome::WasActive { previous, next } => {
                assert_eq!(previous.request_id, "a");
                assert_eq!(next.unwrap().request_id, "b");
            }
            other => panic!("unexpected: {other:?}"),
        }
        assert!(s.active.is_none());
        assert!(s.queue.is_empty());
    }

    #[test]
    fn remove_queued_by_id() {
        let mut s = QueueState::default();
        s.set_active(active("a"));
        s.push(dummy_event(), "b".into());
        s.push(dummy_event(), "c".into());
        assert_eq!(
            s.remove_by_request_id("b"),
            RemoveOutcome::RemovedFromQueue
        );
        assert_eq!(s.queue.len(), 1);
        assert_eq!(s.queue[0].request_id, "c");
    }

    #[test]
    fn remove_unknown_id_is_notfound() {
        let mut s = QueueState::default();
        assert_eq!(s.remove_by_request_id("zzz"), RemoveOutcome::NotFound);
    }

    #[test]
    fn clear_wipes_everything() {
        let mut s = QueueState::default();
        s.set_active(active("a"));
        s.push(dummy_event(), "b".into());
        s.clear();
        assert!(s.active.is_none());
        assert!(s.queue.is_empty());
    }
}
```

- [ ] **Step 2: Run the tests**

Run: `cd src-tauri && cargo test -p masko-windows --lib telegram::state`
Expected: 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/telegram/state.rs
git commit -m "feat(telegram): FIFO queue state with 8 unit tests"
```

---

## Task 5: Rust — `telegram/client.rs` (Bot API HTTP wrapper)

**Files:**
- Create: `src-tauri/src/telegram/client.rs` (replacing empty stub)

- [ ] **Step 1: Paste the implementation**

```rust
// src-tauri/src/telegram/client.rs
#![allow(dead_code)]

use reqwest::StatusCode;
use serde::Serialize;
use serde_json::{json, Value};

use crate::telegram::types::{
    BotUser, InlineKeyboardMarkup, SentMessage, TelegramError, Update,
};

#[derive(Clone)]
pub struct TelegramClient {
    http: reqwest::Client,
    token: String,
}

impl TelegramClient {
    pub fn new(token: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("reqwest client");
        Self { http, token }
    }

    fn url(&self, method: &str) -> String {
        format!("https://api.telegram.org/bot{}/{}", self.token, method)
    }

    /// GET /getMe
    pub async fn get_me(&self) -> Result<BotUser, TelegramError> {
        let resp = self
            .http
            .get(self.url("getMe"))
            .send()
            .await
            .map_err(|e| TelegramError::Network(e.to_string()))?;
        classify_and_parse::<BotUser>(resp).await
    }

    /// Long-poll getUpdates. `offset` is the update_id to start from (+1 past
    /// last seen). `timeout` is the long-poll timeout in seconds. The HTTP
    /// timeout is set generously above so the server can hold this open.
    pub async fn get_updates(
        &self,
        offset: i64,
        timeout_secs: u64,
    ) -> Result<Vec<Update>, TelegramError> {
        let body = json!({
            "offset": offset,
            "timeout": timeout_secs,
            "allowed_updates": ["message", "callback_query"],
        });
        let resp = self
            .http
            .post(self.url("getUpdates"))
            .json(&body)
            .send()
            .await
            .map_err(|e| TelegramError::Network(e.to_string()))?;
        classify_and_parse::<Vec<Update>>(resp).await
    }

    /// POST /sendMessage with HTML parse_mode and optional inline keyboard.
    pub async fn send_message(
        &self,
        chat_id: &str,
        html: &str,
        reply_markup: Option<&InlineKeyboardMarkup>,
    ) -> Result<SentMessage, TelegramError> {
        #[derive(Serialize)]
        struct Body<'a> {
            chat_id: &'a str,
            text: &'a str,
            parse_mode: &'static str,
            #[serde(skip_serializing_if = "Option::is_none")]
            reply_markup: Option<&'a InlineKeyboardMarkup>,
        }
        let body = Body {
            chat_id,
            text: html,
            parse_mode: "HTML",
            reply_markup,
        };
        let resp = self
            .http
            .post(self.url("sendMessage"))
            .json(&body)
            .send()
            .await
            .map_err(|e| TelegramError::Network(e.to_string()))?;
        classify_and_parse::<SentMessage>(resp).await
    }

    /// POST /editMessageReplyMarkup to clear or replace the inline keyboard.
    /// Passing `None` clears the keyboard entirely.
    pub async fn edit_message_reply_markup(
        &self,
        chat_id: &str,
        message_id: i64,
        markup: Option<&InlineKeyboardMarkup>,
    ) -> Result<(), TelegramError> {
        let body = match markup {
            Some(m) => json!({ "chat_id": chat_id, "message_id": message_id, "reply_markup": m }),
            None => json!({ "chat_id": chat_id, "message_id": message_id }),
        };
        let resp = self
            .http
            .post(self.url("editMessageReplyMarkup"))
            .json(&body)
            .send()
            .await
            .map_err(|e| TelegramError::Network(e.to_string()))?;
        // We don't need the returned message — just verify success.
        let _ = classify_and_parse::<Value>(resp).await?;
        Ok(())
    }

    /// POST /answerCallbackQuery for inline button toast.
    pub async fn answer_callback_query(
        &self,
        callback_query_id: &str,
        text: &str,
    ) -> Result<(), TelegramError> {
        let body = json!({
            "callback_query_id": callback_query_id,
            "text": text,
            "show_alert": false,
        });
        let resp = self
            .http
            .post(self.url("answerCallbackQuery"))
            .json(&body)
            .send()
            .await
            .map_err(|e| TelegramError::Network(e.to_string()))?;
        let _ = classify_and_parse::<Value>(resp).await?;
        Ok(())
    }
}

/// Classify HTTP status + Telegram response envelope into either the inner
/// `result` field or a typed error.
async fn classify_and_parse<T: for<'de> serde::Deserialize<'de>>(
    resp: reqwest::Response,
) -> Result<T, TelegramError> {
    let status = resp.status();
    let retry_after = resp
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());

    let body = resp
        .text()
        .await
        .map_err(|e| TelegramError::Network(e.to_string()))?;

    // Telegram wraps everything in { ok, result?, description?, error_code?,
    // parameters: { retry_after? } }
    let envelope: Value = serde_json::from_str(&body)
        .map_err(|e| TelegramError::Api(format!("parse envelope: {e}: {body}")))?;

    let ok = envelope.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);

    if status == StatusCode::UNAUTHORIZED {
        return Err(TelegramError::Unauthorized);
    }
    if status == StatusCode::CONFLICT {
        return Err(TelegramError::Conflict);
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        let envelope_retry = envelope
            .get("parameters")
            .and_then(|p| p.get("retry_after"))
            .and_then(|v| v.as_u64());
        let wait = envelope_retry.or(retry_after).unwrap_or(5);
        return Err(TelegramError::TooManyRequests(wait));
    }
    if status.is_server_error() {
        return Err(TelegramError::Server(format!("{status}: {body}")));
    }

    if !ok {
        let desc = envelope
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown api error");
        return Err(TelegramError::Api(desc.to_string()));
    }

    let result = envelope
        .get("result")
        .cloned()
        .ok_or_else(|| TelegramError::Api("missing result".into()))?;

    serde_json::from_value::<T>(result)
        .map_err(|e| TelegramError::Api(format!("deserialize result: {e}")))
}

#[cfg(test)]
mod tests {
    // The HTTP methods are not unit-testable without network mocking, which
    // we are deliberately skipping per the spec's testing strategy.
    // Only `classify_and_parse` logic is exercised indirectly via integration.
    // If desired in the future, add `wiremock` as a dev-dep and re-enable.
}
```

- [ ] **Step 2: Verify compile**

Run: `cd src-tauri && cargo check`
Expected: no errors. `classify_and_parse` is an async fn — make sure `reqwest::Response` is importable (the top-level `reqwest` dep already includes it).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/telegram/client.rs
git commit -m "feat(telegram): reqwest-based Bot API client (5 endpoints)"
```

---

## Task 6: Rust — `telegram/poller.rs` (long-poll loop)

**Files:**
- Create: `src-tauri/src/telegram/poller.rs` (replacing empty stub)

- [ ] **Step 1: Paste the implementation**

```rust
// src-tauri/src/telegram/poller.rs
#![allow(dead_code)]

use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::sync::{watch, Mutex, RwLock};

use crate::telegram::client::TelegramClient;
use crate::telegram::state::QueueState;
use crate::telegram::types::{
    PollerCmd, TelegramConfig, TelegramError, TelegramStatus, Update,
};

/// The poller owns a tokio task that long-polls `getUpdates` and dispatches
/// updates to the manager. It stops when it receives `PollerCmd::Stop` or
/// `PollerCmd::ConfigChanged` — in both cases the caller is responsible for
/// respawning if desired.
pub async fn run_poller(
    config: TelegramConfig,
    state: Arc<Mutex<QueueState>>,
    status: Arc<RwLock<TelegramStatus>>,
    app: AppHandle,
    mut rx: watch::Receiver<PollerCmd>,
) {
    let client = TelegramClient::new(config.bot_token.clone());
    let mut offset: i64 = 0;
    let mut backoff = Duration::from_secs(1);
    const MAX_BACKOFF: Duration = Duration::from_secs(10);
    const LONG_POLL_SECS: u64 = 30;

    // Set status = Running, clear error.
    {
        let mut s = status.write().await;
        s.enabled = true;
        s.error = None;
    }
    emit_status(&app, &status).await;

    loop {
        tokio::select! {
            _ = rx.changed() => {
                let cmd = rx.borrow().clone();
                match cmd {
                    PollerCmd::Stop | PollerCmd::ConfigChanged => break,
                }
            }
            result = client.get_updates(offset, LONG_POLL_SECS) => {
                match result {
                    Ok(updates) => {
                        backoff = Duration::from_secs(1);
                        for u in updates {
                            offset = u.update_id + 1;
                            super::dispatch::handle_update(
                                u,
                                &client,
                                &state,
                                &config,
                                &status,
                                &app,
                            )
                            .await;
                        }
                    }
                    Err(TelegramError::Unauthorized) => {
                        let mut s = status.write().await;
                        s.enabled = false;
                        s.error = Some("Invalid bot token".into());
                        drop(s);
                        emit_status(&app, &status).await;
                        notify_fatal(&app, "Invalid bot token");
                        break;
                    }
                    Err(TelegramError::TooManyRequests(retry_after)) => {
                        tokio::time::sleep(Duration::from_secs(retry_after)).await;
                    }
                    Err(TelegramError::Conflict) => {
                        tokio::time::sleep(Duration::from_secs(5)).await;
                    }
                    Err(TelegramError::Server(msg)) | Err(TelegramError::Network(msg)) => {
                        crate::mlog_err!("Telegram poll error: {msg}");
                        tokio::time::sleep(backoff).await;
                        backoff = (backoff * 2).min(MAX_BACKOFF);
                    }
                    Err(TelegramError::Api(msg)) => {
                        crate::mlog_err!("Telegram API error: {msg}");
                        tokio::time::sleep(backoff).await;
                        backoff = (backoff * 2).min(MAX_BACKOFF);
                    }
                    Err(TelegramError::NotConfigured) => {
                        break;
                    }
                }
            }
        }
    }

    // Task exit — set enabled=false unless an error has been recorded with a
    // distinct "reason to resume" semantic. We only clear enabled here to
    // reflect that the task is no longer running.
    {
        let mut s = status.write().await;
        s.enabled = false;
    }
    emit_status(&app, &status).await;
}

pub async fn emit_status(app: &AppHandle, status: &Arc<RwLock<TelegramStatus>>) {
    let snapshot = status.read().await.clone();
    app.emit("telegram://status-changed", snapshot).ok();
}

fn notify_fatal(app: &AppHandle, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title("Telegram Bot")
        .body(format!("Polling dừng: {body}. Mở Settings để kiểm tra."))
        .show();
}
```

- [ ] **Step 2: Note that `super::dispatch::handle_update` doesn't exist yet**

The poller references `dispatch::handle_update`. That lives in `mod.rs` (Task 7). Leave this reference; the file will fail to compile until Task 7 adds the dispatch module. To keep `cargo check` green between tasks, also add this **temporary stub at the bottom** of `mod.rs`:

```rust
// Placeholder until Task 7 — delete then.
pub(crate) mod dispatch {
    use super::*;
    use crate::telegram::client::TelegramClient;
    use crate::telegram::state::QueueState;
    use crate::telegram::types::{TelegramConfig, TelegramStatus, Update};
    use std::sync::Arc;
    use tauri::AppHandle;
    use tokio::sync::{Mutex, RwLock};

    pub async fn handle_update(
        _update: Update,
        _client: &TelegramClient,
        _state: &Arc<Mutex<QueueState>>,
        _config: &TelegramConfig,
        _status: &Arc<RwLock<TelegramStatus>>,
        _app: &AppHandle,
    ) {
        // noop
    }
}
```

- [ ] **Step 3: Verify compile**

Run: `cd src-tauri && cargo check`
Expected: no errors, some unused-variable warnings are OK.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/telegram/poller.rs src-tauri/src/telegram/mod.rs
git commit -m "feat(telegram): long-poll loop with error classification"
```

---

## Task 7: Rust — `telegram/mod.rs` (manager + dispatch)

**Files:**
- Modify: `src-tauri/src/telegram/mod.rs` — replace the placeholder dispatch with the real implementation and add `TelegramManager`.

- [ ] **Step 1: Replace the whole file contents**

```rust
// src-tauri/src/telegram/mod.rs
#![allow(dead_code)]

pub mod client;
pub mod config;
pub mod formatter;
pub mod poller;
pub mod state;
pub mod types;

use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{watch, Mutex, RwLock};

use crate::models::AgentEvent;
use crate::telegram::client::TelegramClient;
use crate::telegram::state::{ActivePermission, PushOutcome, QueueState, RemoveOutcome};
use crate::telegram::types::{
    InlineKeyboardButton, InlineKeyboardMarkup, PollerCmd, TelegramConfig, TelegramConfigDto,
    TelegramError, TelegramStatus, TelegramTestResult,
};

/// The singleton that owns config, status, queue state, and the poller task.
pub struct TelegramManager {
    pub config: Arc<RwLock<TelegramConfig>>,
    pub status: Arc<RwLock<TelegramStatus>>,
    pub state: Arc<Mutex<QueueState>>,
    pub tx: Arc<Mutex<Option<watch::Sender<PollerCmd>>>>,
    pub app: AppHandle,
}

impl TelegramManager {
    pub async fn init(app: AppHandle) -> Arc<Self> {
        let path = config::config_path(&app).ok();
        let cfg = match &path {
            Some(p) => config::load_from(p).unwrap_or_default(),
            None => TelegramConfig::default(),
        };
        let status = TelegramStatus {
            configured: cfg.is_configured(),
            enabled: false,
            error: None,
            bot_username: None,
        };
        let manager = Arc::new(Self {
            config: Arc::new(RwLock::new(cfg.clone())),
            status: Arc::new(RwLock::new(status)),
            state: Arc::new(Mutex::new(QueueState::default())),
            tx: Arc::new(Mutex::new(None)),
            app: app.clone(),
        });

        // Auto-start poller if `enabled && configured`
        if cfg.enabled && cfg.is_configured() {
            let m = manager.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = m.start_poller().await {
                    crate::mlog_err!("Telegram auto-start failed: {e}");
                }
            });
        }

        manager
    }

    pub async fn get_status(&self) -> TelegramStatus {
        self.status.read().await.clone()
    }

    pub async fn get_config_dto(&self) -> TelegramConfigDto {
        let c = self.config.read().await;
        TelegramConfigDto {
            bot_token: c.bot_token.clone(),
            chat_id: c.chat_id.clone(),
        }
    }

    pub async fn save_config(&self, token: String, chat_id: String) -> Result<(), String> {
        let mut c = self.config.write().await;
        let token_changed = c.bot_token != token;
        let chat_changed = c.chat_id != chat_id;
        c.bot_token = token;
        c.chat_id = chat_id;
        let snapshot = c.clone();
        drop(c);

        if let Ok(path) = config::config_path(&self.app) {
            config::save_to(&path, &snapshot)?;
        }

        // Clear any recorded error — Save is treated as acknowledging it.
        {
            let mut s = self.status.write().await;
            s.error = None;
            s.configured = snapshot.is_configured();
        }
        self.emit_status().await;

        // If config changed and the persisted `enabled` flag is true, ensure
        // a fresh poller is running with the new config. Also drop queue state
        // because message_ids belong to the old bot/chat.
        if (token_changed || chat_changed) && snapshot.enabled && snapshot.is_configured() {
            self.stop_poller().await; // if running
            self.state.lock().await.clear();
            self.start_poller().await?;
        } else if snapshot.enabled && snapshot.is_configured() {
            // Not running yet (e.g. after fatal error) — try to start.
            let running = self.tx.lock().await.is_some();
            if !running {
                self.start_poller().await?;
            }
        }

        Ok(())
    }

    pub async fn test(
        &self,
        token: String,
        chat_id: Option<String>,
    ) -> Result<TelegramTestResult, String> {
        let client = TelegramClient::new(token);
        let bot = client.get_me().await.map_err(|e| e.to_string())?;
        let mut chat_tested = false;
        if let Some(cid) = chat_id.filter(|c| !c.trim().is_empty()) {
            client
                .send_message(&cid, "🏓 Masko Code test message", None)
                .await
                .map_err(|e| e.to_string())?;
            chat_tested = true;
        }
        Ok(TelegramTestResult {
            bot_username: bot.username,
            bot_first_name: bot.first_name,
            chat_tested,
        })
    }

    pub async fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        let mut c = self.config.write().await;
        if enabled && !c.is_configured() {
            return Err("Not configured".into());
        }
        c.enabled = enabled;
        let snapshot = c.clone();
        drop(c);
        if let Ok(path) = config::config_path(&self.app) {
            config::save_to(&path, &snapshot)?;
        }
        if enabled {
            self.start_poller().await?;
        } else {
            self.stop_poller().await;
            self.state.lock().await.clear();
            {
                let mut s = self.status.write().await;
                s.enabled = false;
                s.error = None;
            }
            self.emit_status().await;
        }
        Ok(())
    }

    pub async fn start_poller(&self) -> Result<(), String> {
        let mut tx_slot = self.tx.lock().await;
        if tx_slot.is_some() {
            return Ok(()); // already running
        }
        let cfg = self.config.read().await.clone();
        if !cfg.is_configured() {
            return Err("Not configured".into());
        }
        let (tx, rx) = watch::channel(PollerCmd::ConfigChanged);
        *tx_slot = Some(tx);
        drop(tx_slot);

        let state = self.state.clone();
        let status = self.status.clone();
        let app = self.app.clone();
        let tx_holder = self.tx.clone();

        tauri::async_runtime::spawn(async move {
            poller::run_poller(cfg, state, status, app, rx).await;
            // Task exited — clear the holder so start_poller can be called again.
            *tx_holder.lock().await = None;
        });

        Ok(())
    }

    pub async fn stop_poller(&self) {
        let mut tx_slot = self.tx.lock().await;
        if let Some(tx) = tx_slot.take() {
            let _ = tx.send(PollerCmd::Stop);
        }
    }

    pub async fn emit_status(&self) {
        let snapshot = self.status.read().await.clone();
        self.app.emit("telegram://status-changed", snapshot).ok();
    }

    /// Called by server.rs when a permission request arrives from the hook.
    pub async fn push_permission(&self, event: AgentEvent, request_id: String) {
        let enabled = self.status.read().await.enabled;
        if !enabled {
            return;
        }
        let outcome = {
            let mut s = self.state.lock().await;
            s.push(event.clone(), request_id.clone())
        };
        if matches!(outcome, PushOutcome::ShouldSendNow) {
            self.send_now(event, request_id).await;
        }
    }

    /// Called by commands.rs after the HTTP response is sent to the hook.
    pub async fn on_local_resolved(&self, request_id: &str, decision: &str) {
        let outcome = {
            let mut s = self.state.lock().await;
            s.remove_by_request_id(request_id)
        };
        match outcome {
            RemoveOutcome::WasActive { previous, next } => {
                // Fire-and-forget: edit the old message, send follow-up, pop next.
                let cfg = self.config.read().await.clone();
                let decision_label = pretty_decision(decision);
                let client = TelegramClient::new(cfg.bot_token.clone());
                let chat_id = cfg.chat_id.clone();
                let app = self.app.clone();
                let self_arc_state = self.state.clone();
                let manager = self.clone_refs();

                tauri::async_runtime::spawn(async move {
                    let _ = client
                        .edit_message_reply_markup(&chat_id, previous.message_id, None)
                        .await;
                    let text = format!("✓ Đã xử lý ở máy local ({decision_label})");
                    let _ = client.send_message(&chat_id, &text, None).await;

                    if let Some(queued) = next {
                        manager.send_now(queued.event, queued.request_id).await;
                    }

                    let _ = self_arc_state; // not used directly; kept for lifetime clarity
                    let _ = app; // keep variable live
                });
            }
            RemoveOutcome::RemovedFromQueue | RemoveOutcome::NotFound => {
                // nothing to do
            }
        }
    }

    /// Build inline keyboard + call sendMessage + cache active permission.
    async fn send_now(&self, event: AgentEvent, request_id: String) {
        let cfg = self.config.read().await.clone();
        if !cfg.is_configured() {
            return;
        }
        let html = formatter::build_html(&event);
        let suggestions = event
            .permission_suggestions
            .as_ref()
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let first = suggestions.first().cloned();
        let markup = build_keyboard(first.as_ref());
        let client = TelegramClient::new(cfg.bot_token.clone());

        let send_res = retry_send(&client, &cfg.chat_id, &html, Some(&markup)).await;
        match send_res {
            Ok(sent) => {
                let mut s = self.state.lock().await;
                s.set_active(ActivePermission {
                    request_id,
                    message_id: sent.message_id,
                    suggestion: first,
                });
            }
            Err(e) => {
                crate::mlog_err!("Telegram sendMessage failed: {e}");
                // Drop this from state entirely — treat as if Telegram missed it.
                self.app
                    .emit(
                        "telegram://send-failed",
                        json!({ "request_id": request_id, "error": e.to_string() }),
                    )
                    .ok();
            }
        }
    }

    /// Get a lightweight clone of the fields send_now needs — used inside
    /// spawned tasks without holding self across awaits.
    fn clone_refs(&self) -> TelegramManager {
        TelegramManager {
            config: self.config.clone(),
            status: self.status.clone(),
            state: self.state.clone(),
            tx: self.tx.clone(),
            app: self.app.clone(),
        }
    }
}

fn pretty_decision(decision: &str) -> &str {
    match decision {
        "allow" => "Approved",
        "deny" => "Denied",
        other => other,
    }
}

fn build_keyboard(suggestion: Option<&Value>) -> InlineKeyboardMarkup {
    let mut rows: Vec<Vec<InlineKeyboardButton>> = vec![vec![InlineKeyboardButton {
        text: "✅ Approve".into(),
        callback_data: "approve".into(),
    }]];
    if let Some(s) = suggestion {
        let label = formatter::display_label_for(s);
        rows.push(vec![InlineKeyboardButton {
            text: format!("⚡ {label}"),
            callback_data: "allow_suggestion".into(),
        }]);
    }
    rows.push(vec![InlineKeyboardButton {
        text: "❌ Deny".into(),
        callback_data: "deny".into(),
    }]);
    InlineKeyboardMarkup { inline_keyboard: rows }
}

async fn retry_send(
    client: &TelegramClient,
    chat_id: &str,
    html: &str,
    markup: Option<&InlineKeyboardMarkup>,
) -> Result<crate::telegram::types::SentMessage, TelegramError> {
    let delays = [std::time::Duration::from_secs(1), std::time::Duration::from_secs(3)];
    let mut last_err = None;
    for attempt in 0..=delays.len() {
        match client.send_message(chat_id, html, markup).await {
            Ok(ok) => return Ok(ok),
            Err(e) => {
                last_err = Some(e);
                if attempt < delays.len() {
                    tokio::time::sleep(delays[attempt]).await;
                }
            }
        }
    }
    Err(last_err.unwrap())
}

// ===== Update dispatch (called from poller) =====

pub(crate) mod dispatch {
    use super::*;
    use crate::telegram::types::Update;

    pub async fn handle_update(
        update: Update,
        client: &TelegramClient,
        state: &Arc<Mutex<QueueState>>,
        config: &TelegramConfig,
        _status: &Arc<RwLock<TelegramStatus>>,
        app: &AppHandle,
    ) {
        if let Some(cb) = update.callback_query {
            handle_callback(cb, client, state, config, app).await;
            return;
        }
        if let Some(msg) = update.message {
            handle_message(msg, client, state, config, app).await;
        }
    }

    async fn handle_callback(
        cb: crate::telegram::types::CallbackQuery,
        client: &TelegramClient,
        state: &Arc<Mutex<QueueState>>,
        config: &TelegramConfig,
        app: &AppHandle,
    ) {
        // Auth check.
        if cb.from.id.to_string() != config.chat_id {
            let _ = client
                .answer_callback_query(&cb.id, "Unauthorized")
                .await;
            return;
        }

        let data = cb.data.clone().unwrap_or_default();
        let toast = match data.as_str() {
            "approve" => "✓ Approved",
            "allow_suggestion" => "⚡ Applied suggestion",
            "deny" => "✗ Denied",
            _ => "?",
        };
        let _ = client.answer_callback_query(&cb.id, toast).await;

        // Snapshot active, then clear it atomically and pop next.
        let (active, next) = {
            let mut s = state.lock().await;
            let active = s.active.clone();
            let next = s.resolve_active();
            (active, next)
        };

        let Some(active) = active else {
            return;
        };

        // Edit keyboard away on the original message.
        if let Some(msg) = &cb.message {
            let _ = client
                .edit_message_reply_markup(&config.chat_id, msg.message_id, None)
                .await;
        } else {
            let _ = client
                .edit_message_reply_markup(&config.chat_id, active.message_id, None)
                .await;
        }

        let (decision, suggestion) = match data.as_str() {
            "approve" => ("allow", None),
            "deny" => ("deny", None),
            "allow_suggestion" => ("allow", active.suggestion.clone()),
            _ => return,
        };

        let mut payload = json!({
            "request_id": active.request_id,
            "decision": decision,
        });
        if let Some(s) = suggestion {
            payload["suggestion"] = s;
        }
        app.emit("telegram://permission-response", payload).ok();

        // Pop next queued permission (if any) and send it.
        if let Some(next) = next {
            let manager = app
                .state::<Arc<TelegramManager>>()
                .inner()
                .clone();
            manager.send_now(next.event, next.request_id).await;
        }
    }

    async fn handle_message(
        msg: crate::telegram::types::Message,
        client: &TelegramClient,
        state: &Arc<Mutex<QueueState>>,
        config: &TelegramConfig,
        app: &AppHandle,
    ) {
        if msg.chat.id.to_string() != config.chat_id {
            return; // silent ignore
        }
        let Some(text) = msg.text.clone() else {
            return; // ignore stickers, photos, etc.
        };

        let (active, next) = {
            let mut s = state.lock().await;
            if s.active.is_none() {
                // No reply text for "no active perm" scenario — send the
                // canned response and return.
                drop(s);
                let _ = client
                    .send_message(&config.chat_id, "Hiện không có request nào đang chờ", None)
                    .await;
                return;
            }
            let active = s.active.clone();
            let next = s.resolve_active();
            (active, next)
        };

        let Some(active) = active else { return };

        let _ = client
            .edit_message_reply_markup(&config.chat_id, active.message_id, None)
            .await;

        let payload = json!({
            "request_id": active.request_id,
            "decision": "deny",
            "feedback_text": text,
        });
        app.emit("telegram://permission-response", payload).ok();

        if let Some(next) = next {
            let manager = app
                .state::<Arc<TelegramManager>>()
                .inner()
                .clone();
            manager.send_now(next.event, next.request_id).await;
        }
    }
}
```

- [ ] **Step 2: Add `Manager` import note**

The dispatch module uses `app.state::<Arc<TelegramManager>>()`. This requires that `TelegramManager` is `managed` by Tauri in `lib.rs` Task 9. For now, `cargo check` should pass because `app.state` is polymorphic.

- [ ] **Step 3: Verify compile**

Run: `cd src-tauri && cargo check`
Expected: no errors. Warnings about unused variants or `Server` error path are OK.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/telegram/mod.rs
git commit -m "feat(telegram): manager + update dispatch (callback + message)"
```

---

## Task 8: Rust — new Tauri commands

**Files:**
- Modify: `src-tauri/src/commands.rs` — add 5 new commands + extend `resolve_permission`.

- [ ] **Step 1: Add the new commands at the bottom of `commands.rs`**

```rust
// ===== Telegram commands =====

use std::sync::Arc;

use crate::telegram::types::{TelegramConfigDto, TelegramStatus, TelegramTestResult};
use crate::telegram::TelegramManager;

#[tauri::command]
pub async fn telegram_get_config(
    manager: tauri::State<'_, Arc<TelegramManager>>,
) -> Result<TelegramConfigDto, String> {
    Ok(manager.get_config_dto().await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn telegram_save_config(
    manager: tauri::State<'_, Arc<TelegramManager>>,
    token: String,
    chat_id: String,
) -> Result<(), String> {
    manager.save_config(token, chat_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn telegram_test(
    manager: tauri::State<'_, Arc<TelegramManager>>,
    token: String,
    chat_id: Option<String>,
) -> Result<TelegramTestResult, String> {
    manager.test(token, chat_id).await
}

#[tauri::command]
pub async fn telegram_set_enabled(
    manager: tauri::State<'_, Arc<TelegramManager>>,
    enabled: bool,
) -> Result<(), String> {
    manager.set_enabled(enabled).await
}

#[tauri::command]
pub async fn telegram_get_status(
    manager: tauri::State<'_, Arc<TelegramManager>>,
) -> Result<TelegramStatus, String> {
    Ok(manager.get_status().await)
}
```

- [ ] **Step 2: Extend `resolve_permission` to notify the Telegram manager**

Replace the existing `resolve_permission` function:

```rust
#[tauri::command(rename_all = "camelCase")]
pub async fn resolve_permission(
    pending: State<'_, PendingPermissions>,
    manager: State<'_, Arc<crate::telegram::TelegramManager>>,
    request_id: String,
    decision: serde_json::Value,
) -> Result<(), String> {
    mlog!("resolve_permission called: id={}", request_id);

    // Extract decision label for the Telegram follow-up message BEFORE moving decision.
    let decision_label = decision
        .pointer("/hookSpecificOutput/decision/behavior")
        .and_then(|v| v.as_str())
        .unwrap_or("allow")
        .to_string();

    // Forward to the hook HTTP response.
    crate::server::resolve(&pending, request_id.clone(), decision).await?;

    // Notify Telegram — fire-and-forget style (spawn) so IPC returns quickly.
    let manager_clone: Arc<crate::telegram::TelegramManager> = manager.inner().clone();
    let req_id = request_id.clone();
    tauri::async_runtime::spawn(async move {
        manager_clone.on_local_resolved(&req_id, &decision_label).await;
    });

    Ok(())
}
```

- [ ] **Step 3: Verify compile**

Run: `cd src-tauri && cargo check`
Expected: no errors. If there's a lifetime error on `State`, ensure `pending` and `manager` are both `State<'_, ...>`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(telegram): add 5 Tauri commands + sync resolve_permission"
```

---

## Task 9: Rust — wire manager into `lib.rs` and `server.rs`

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/server.rs`
- Modify: `src-tauri/src/telegram/mod.rs` — remove the temporary `#![allow(dead_code)]` attributes on modules where everything is now used.

- [ ] **Step 1: In `lib.rs`, initialize the manager and register commands**

Inside `tauri::Builder::default()`, **before** `.setup(...)`, manage an initial placeholder is not possible because `init` requires `AppHandle`. So the right place is inside `setup`. Modify the setup closure:

```rust
.setup(move |app| {
    tray::create_tray(app.handle())?;

    // Initialize Telegram manager — reads config file and auto-starts poller if enabled.
    let tg_handle = app.handle().clone();
    let manager_cell: std::sync::Arc<tokio::sync::OnceCell<std::sync::Arc<telegram::TelegramManager>>> =
        std::sync::Arc::new(tokio::sync::OnceCell::new());
    let cell_clone = manager_cell.clone();
    let app_for_manage = app.handle().clone();
    tauri::async_runtime::block_on(async move {
        let m = telegram::TelegramManager::init(tg_handle).await;
        cell_clone.set(m.clone()).ok();
        app_for_manage.manage(m);
    });

    // ... existing code (server start, hook install, overlay setup) ...
```

**Simpler alternative** — because `TelegramManager::init` is async but called once at startup, and we're already doing `tauri::async_runtime::spawn` elsewhere, use a blocking init via a dedicated runtime:

```rust
.setup(move |app| {
    tray::create_tray(app.handle())?;

    // Initialize Telegram manager synchronously so the State is ready
    // before commands are invoked.
    let manager = tauri::async_runtime::block_on(
        telegram::TelegramManager::init(app.handle().clone())
    );
    app.manage(manager);

    // ... existing code ...
```

Use the simpler alternative. Remove the `OnceCell` approach.

- [ ] **Step 2: Register the new commands in `invoke_handler!`**

Find the `.invoke_handler(tauri::generate_handler![...])` call and add:

```rust
commands::telegram_get_config,
commands::telegram_save_config,
commands::telegram_test,
commands::telegram_set_enabled,
commands::telegram_get_status,
```

- [ ] **Step 3: In `server.rs::handle_hook`, push to Telegram after emitting events**

Open `src-tauri/src/server.rs`. Inside the `if event.hook_event_name == "PermissionRequest"` branch, after the two `.emit(...)` calls (line 104-106 in the current version) and **before** `match rx.await`, add:

```rust
// Push to Telegram manager (fire-and-forget; no-op if disabled).
if let Some(manager) = state.app_handle.try_state::<std::sync::Arc<crate::telegram::TelegramManager>>() {
    let m = manager.inner().clone();
    let ev = event.clone();
    let rid = request_id.clone();
    tokio::spawn(async move {
        m.push_permission(ev, rid).await;
    });
}
```

Note: `try_state` returns `None` if the manager wasn't managed yet, which keeps tests and edge cases safe.

- [ ] **Step 4: Remove temporary `#![allow(dead_code)]` attributes**

In each of these files, remove the top-level `#![allow(dead_code)]` (keep it on `types.rs` and `state.rs` if warnings persist):

- `src-tauri/src/telegram/mod.rs`
- `src-tauri/src/telegram/config.rs`
- `src-tauri/src/telegram/formatter.rs`
- `src-tauri/src/telegram/client.rs`
- `src-tauri/src/telegram/poller.rs`

- [ ] **Step 5: Build & run all tests**

Run: `cd src-tauri && cargo build` and `cargo test --lib telegram`
Expected: clean build; ~21 tests pass (4 config + 9 formatter + 8 state).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/server.rs src-tauri/src/telegram/
git commit -m "feat(telegram): wire manager into startup, server, and command registry"
```

---

## Task 10: Frontend — `src/stores/telegram-store.ts`

**Files:**
- Create: `src/stores/telegram-store.ts`

- [ ] **Step 1: Write the store**

```ts
// src/stores/telegram-store.ts
import { createStore } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { permissionStore } from "./permission-store";
import { log, error } from "../services/log";

export interface TelegramStatus {
  configured: boolean;
  enabled: boolean;
  error: string | null;
  bot_username: string | null;
}

export interface TelegramTestResult {
  bot_username: string;
  bot_first_name: string;
  chat_tested: boolean;
}

export interface TelegramConfigDto {
  bot_token: string;
  chat_id: string;
}

const [status, setStatus] = createStore<TelegramStatus>({
  configured: false,
  enabled: false,
  error: null,
  bot_username: null,
});

let initialized = false;

export async function initTelegramStore(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const s = await invoke<TelegramStatus>("telegram_get_status");
    setStatus(s);
  } catch (e) {
    error("telegram_get_status failed:", e);
  }

  await listen<TelegramStatus>("telegram://status-changed", (e) => {
    setStatus(e.payload);
  });

  await listen<{
    request_id: string;
    decision: "allow" | "deny";
    suggestion?: any;
    feedback_text?: string;
  }>("telegram://permission-response", (e) => {
    const { request_id, decision, suggestion, feedback_text } = e.payload;
    log("[telegram] permission-response", request_id, decision);
    const payloadSuggestion = feedback_text
      ? { type: "feedback", reason: feedback_text }
      : suggestion;
    permissionStore.resolve(request_id, decision, payloadSuggestion);
  });

  await listen<{ request_id: string; error: string }>(
    "telegram://send-failed",
    (e) => {
      error("[telegram] sendMessage failed", e.payload);
    },
  );
}

export const telegramStore = {
  get status() {
    return status;
  },

  async getConfig(): Promise<TelegramConfigDto> {
    return invoke<TelegramConfigDto>("telegram_get_config");
  },

  async saveConfig(token: string, chatId: string): Promise<void> {
    await invoke("telegram_save_config", { token, chatId });
    const s = await invoke<TelegramStatus>("telegram_get_status");
    setStatus(s);
  },

  async test(token: string, chatId: string | null): Promise<TelegramTestResult> {
    return invoke<TelegramTestResult>("telegram_test", { token, chatId });
  },

  async setEnabled(enabled: boolean): Promise<void> {
    await invoke("telegram_set_enabled", { enabled });
    const s = await invoke<TelegramStatus>("telegram_get_status");
    setStatus(s);
  },
};
```

- [ ] **Step 2: Call `initTelegramStore()` from both window entry points**

Modify `src/App.tsx` — in the `onMount` handler, add at the start:

```ts
import { initTelegramStore } from "./stores/telegram-store";
// ...
onMount(async () => {
  await initTelegramStore();
  appStore.start();
  // ... rest unchanged
});
```

Modify `src/overlay-entry.tsx` — rewrite to init the store before rendering:

```tsx
/* @refresh reload */
import { render } from "solid-js/web";
import MascotOverlay from "./components/overlay/MascotOverlay";
import { initTelegramStore } from "./stores/telegram-store";

const root = document.getElementById("root");
initTelegramStore().catch(() => {});
render(() => <MascotOverlay />, root!);
```

- [ ] **Step 3: Verify frontend build**

Run: `npm run build` from project root.
Expected: clean build. TypeScript may warn about unused `suggestion` type — cast as `any` is deliberate.

- [ ] **Step 4: Commit**

```bash
git add src/stores/telegram-store.ts src/App.tsx src/overlay-entry.tsx
git commit -m "feat(telegram): telegram-store with event listeners, init in both windows"
```

---

## Task 11: Frontend — `SettingsPanel.tsx` Telegram section

**Files:**
- Modify: `src/components/dashboard/SettingsPanel.tsx`

- [ ] **Step 1: Add imports and a new `TelegramSection` component at the bottom of the file**

Add to existing imports near the top:

```ts
import { telegramStore, type TelegramTestResult } from "../../stores/telegram-store";
import { appendNotification } from "../../stores/notification-store";
import { createNotification } from "../../models/notification";
```

Add the component at the bottom of the file (above the closing line, after `ToggleRow`):

```tsx
function TelegramSection() {
  const [token, setToken] = createSignal("");
  const [chatId, setChatId] = createSignal("");
  const [savedToken, setSavedToken] = createSignal("");
  const [savedChatId, setSavedChatId] = createSignal("");
  const [showToken, setShowToken] = createSignal(false);
  const [testing, setTesting] = createSignal(false);
  const [testResult, setTestResult] = createSignal<
    { ok: true; msg: string } | { ok: false; msg: string } | null
  >(null);
  const [saving, setSaving] = createSignal(false);

  onMount(async () => {
    try {
      const cfg = await telegramStore.getConfig();
      setToken(cfg.bot_token);
      setChatId(cfg.chat_id);
      setSavedToken(cfg.bot_token);
      setSavedChatId(cfg.chat_id);
    } catch (e) {
      error("[telegram] getConfig failed:", e);
    }
  });

  const hasUnsavedChanges = () =>
    token() !== savedToken() || chatId() !== savedChatId();

  const canEnable = () =>
    telegramStore.status.configured && !hasUnsavedChanges();

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res: TelegramTestResult = await telegramStore.test(
        token(),
        chatId().trim() === "" ? null : chatId(),
      );
      const suffix = res.chat_tested ? " · test message sent" : "";
      setTestResult({
        ok: true,
        msg: `✓ Bot: @${res.bot_username} (${res.bot_first_name})${suffix}`,
      });
    } catch (e: any) {
      setTestResult({ ok: false, msg: `✗ ${String(e)}` });
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 8000);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await telegramStore.saveConfig(token(), chatId());
      setSavedToken(token());
      setSavedChatId(chatId());
      appendNotification(
        createNotification(
          "Telegram",
          "Config đã lưu",
          "sessionLifecycle",
          "low",
        ),
      );
    } catch (e: any) {
      appendNotification(
        createNotification(
          "Telegram",
          `Lưu thất bại: ${String(e)}`,
          "toolFailed",
          "high",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEnabled() {
    const next = !telegramStore.status.enabled;
    try {
      await telegramStore.setEnabled(next);
    } catch (e: any) {
      appendNotification(
        createNotification(
          "Telegram",
          `Không thể ${next ? "bật" : "tắt"}: ${String(e)}`,
          "toolFailed",
          "high",
        ),
      );
    }
  }

  return (
    <Section title="Telegram Bot">
      <div class="space-y-3">
        {/* Enable toggle */}
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-body text-text-primary">Enabled</p>
            <p class="text-xs text-text-muted mt-0.5">
              {canEnable()
                ? "Bấm để bật/tắt polling"
                : hasUnsavedChanges()
                  ? "Lưu config trước khi bật"
                  : "Điền token và chat ID trước"}
            </p>
          </div>
          <button
            class="relative w-10 h-6 rounded-full transition-colors disabled:opacity-40"
            classList={{
              "bg-orange-primary": telegramStore.status.enabled,
              "bg-border": !telegramStore.status.enabled,
            }}
            disabled={!canEnable() && !telegramStore.status.enabled}
            onClick={handleToggleEnabled}
          >
            <div
              class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
              style={{
                transform: telegramStore.status.enabled
                  ? "translateX(16px)"
                  : "translateX(0)",
              }}
            />
          </button>
        </div>

        {/* Bot token */}
        <div>
          <label class="block text-xs font-body text-text-muted mb-1">
            Bot token
          </label>
          <div class="flex gap-2">
            <input
              class="flex-1 px-3 py-1.5 text-sm font-body rounded-card-sm border border-border bg-background text-text-primary"
              type={showToken() ? "text" : "password"}
              value={token()}
              onInput={(e) => setToken(e.currentTarget.value)}
              placeholder="123456:ABC-DEF..."
            />
            <button
              class="px-2 py-1.5 text-sm rounded-card-sm border border-border hover:bg-surface"
              onClick={() => setShowToken(!showToken())}
              type="button"
              title={showToken() ? "Hide" : "Show"}
            >
              {showToken() ? "🙈" : "👁"}
            </button>
          </div>
        </div>

        {/* Chat ID */}
        <div>
          <label class="block text-xs font-body text-text-muted mb-1">
            Chat ID
          </label>
          <input
            class="w-full px-3 py-1.5 text-sm font-body rounded-card-sm border border-border bg-background text-text-primary"
            type="text"
            value={chatId()}
            onInput={(e) => setChatId(e.currentTarget.value)}
            placeholder="987654321"
          />
        </div>

        {/* Test + Save */}
        <div class="flex items-center gap-2">
          <button
            class="px-3 py-1.5 text-sm font-body font-medium rounded-card-sm border border-border hover:bg-surface disabled:opacity-50"
            onClick={handleTest}
            disabled={testing() || token().trim() === ""}
          >
            {testing() ? "Testing..." : "Test"}
          </button>
          <button
            class="px-3 py-1.5 text-sm font-body font-medium rounded-card-sm bg-orange-primary text-white hover:bg-orange-hover disabled:opacity-50"
            onClick={handleSave}
            disabled={saving() || !hasUnsavedChanges()}
          >
            {saving() ? "Saving..." : "Save"}
          </button>
        </div>

        {/* Test result inline */}
        <Show when={testResult()}>
          {(r) => (
            <p
              class="text-xs font-body"
              classList={{
                "text-green-600": r().ok,
                "text-red-600": !r().ok,
              }}
            >
              {r().msg}
            </p>
          )}
        </Show>

        {/* Runtime error */}
        <Show when={telegramStore.status.error}>
          <p class="text-xs font-body text-red-600">
            ⚠️ {telegramStore.status.error}
          </p>
        </Show>
      </div>
    </Section>
  );
}
```

- [ ] **Step 2: Render the new section inside `SettingsPanel`'s return**

Find the JSX return block in `SettingsPanel` (around line 138). Add `<TelegramSection />` after the existing `Hotkey` or `Auto-approve` section (pick whichever is last before the color / appearance section). If unsure, place it right after the `Claude Code Hooks` Section block.

```tsx
      {/* Telegram */}
      <TelegramSection />
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/SettingsPanel.tsx
git commit -m "feat(telegram): Settings panel section with Test/Save/Enable"
```

---

## Task 12: Frontend — MascotOverlay context menu row

**Files:**
- Modify: `src/components/overlay/MascotOverlay.tsx`

- [ ] **Step 1: Import the store**

Add to the imports at the top:

```ts
import { telegramStore } from "../../stores/telegram-store";
```

- [ ] **Step 2: Add a `TelegramRow` helper or inline the logic in `ContextMenu`**

Inside `ContextMenu` (the function around line 22), before the return, add these helpers:

```ts
const telegramRowLabel = () => {
  const s = telegramStore.status;
  if (s.error) return "Telegram: Error";
  if (!s.configured) return "Telegram: Not configured";
  return s.enabled ? "Telegram: On" : "Telegram: Off";
};

const telegramRowIcon = () => {
  const s = telegramStore.status;
  if (s.error) return "⚠️";
  if (!s.configured) return "○";
  return s.enabled ? "●" : "○";
};

async function handleTelegramClick() {
  props.onClose();
  const s = telegramStore.status;
  if (!s.configured || s.error) {
    try {
      const win = await WebviewWindow.getByLabel("main");
      await win?.show();
      await win?.setFocus();
    } catch { /* ignore */ }
    return;
  }
  try {
    await telegramStore.setEnabled(!s.enabled);
  } catch (e) {
    // Status remains unchanged; user can open Dashboard for detail.
  }
}
```

- [ ] **Step 3: Add the row to the menu JSX**

Inside the existing menu panel (around line 85-150), after the `Flip` row and before `openDashboard` row, add:

```tsx
<MenuRow
  label={telegramRowLabel()}
  icon={telegramRowIcon()}
  onClick={handleTelegramClick}
/>
```

If `MenuRow` does not accept `icon` as a string, use whatever shape the existing rows use. Check the existing row invocations (e.g. Size, Opacity) and match their prop shape exactly.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src/components/overlay/MascotOverlay.tsx
git commit -m "feat(telegram): quick toggle row in mascot context menu"
```

---

## Task 13: End-to-end manual verification

**Files:** none (manual test pass)

- [ ] **Step 1: Build the full app**

Run: `npm run tauri build` from project root (or `npm run tauri dev` for faster iteration).
Expected: clean build, app launches.

- [ ] **Step 2: Walk the full manual checklist from the spec**

Open the spec's "Manual test checklist" section: [docs/superpowers/specs/2026-04-08-telegram-bot-integration-design.md](../specs/2026-04-08-telegram-bot-integration-design.md), and execute each box in order. Record any failures.

Key checks (not exhaustive — spec is the source of truth):

- [ ] Config panel behavior: disabled toggle, Test succeeds/fails, Save toast
- [ ] Permission flow happy path with 3 buttons
- [ ] Free-text chat → deny + feedback
- [ ] Queue FIFO with 3 rapid perms
- [ ] Local resolve → Telegram reflects "Đã xử lý ở máy local"
- [ ] Network unplug → Reconnecting → resume
- [ ] Token revoked → desktop notification + mascot ⚠️
- [ ] Context menu toggle states
- [ ] Security: second account DM → no response
- [ ] Lifecycle: enable + quit + relaunch → auto-starts

- [ ] **Step 3: If any box fails, fix and re-test**

Common failure modes to watch for:
- Tauri `State<'_, Arc<T>>` requires you to `clone` via `.inner().clone()`, not `.clone()` on the State directly.
- `build_html` with missing `cwd` may panic if `Path::file_name` on an empty string returns `None` unexpectedly — verify the fallback path works.
- `initTelegramStore` called twice (once per window) should be idempotent; the `initialized` flag handles this. Per-window listeners are fine because each window has its own JS runtime.

- [ ] **Step 4: Commit any fixes**

```bash
git add <files>
git commit -m "fix(telegram): <short description of issue>"
```

- [ ] **Step 5: Update the memory file for resume context**

Open `C:/Users/Admin/.claude/projects/d--project-other-masko-code/memory/project_web_share_progress.md` or create a new `project_telegram_bot_progress.md`. Write a 1-line progress entry like "Phase 1 Telegram bot integration complete on branch `telegram`, ready for PR to main." Then update `MEMORY.md` index accordingly.

---

## Task 14: Final commit hygiene & PR prep

- [ ] **Step 1: Verify no `#![allow(dead_code)]` leftover except `types.rs`**

Run: `grep -rn "allow(dead_code)" src-tauri/src/telegram/`
Expected: at most one hit in `types.rs` / `state.rs` (if truly unused). Remove any others.

- [ ] **Step 2: Run full test suite**

Run: `cd src-tauri && cargo test --lib` and `npm run build`
Expected: all tests pass, frontend builds.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore(telegram): cleanup dead_code attributes after integration" --allow-empty
```

- [ ] **Step 4: Do NOT push or create a PR**

Per project convention, only create PRs when the user explicitly asks. Report done and wait for instructions.

---

## Notes for the executing agent

- **File ordering matters**: Tasks 1–7 have interdependent modules. Do not skip `cargo check` between tasks. If `cargo check` fails partway through Task 1 because submodules are empty, add `#![allow(dead_code, unused_imports)]` temporarily and clean up in Task 9.
- **`State<'_, Arc<TelegramManager>>`**: when calling from inside a spawned task, always `.inner().clone()` first, then move the `Arc` into the task. Never hold `State<'_, ...>` across `.await`.
- **Event channel names**: `telegram://status-changed`, `telegram://permission-response`, `telegram://send-failed` — the double-slash is significant and matches the spec. Do not rename.
- **Vietnamese strings in the code**: the follow-up text "✓ Đã xử lý ở máy local (Approved)" and "Hiện không có request nào đang chờ" are intentional per the spec. Do not translate to English.
- **No hook contract changes**: `permission-store.ts::resolve()` signature stays exactly as-is. The Rust side of `resolve_permission` simply gains a fire-and-forget call to `on_local_resolved`. If that breaks existing permissions, roll back the change and investigate.
- **TDD boundary**: Rust logic modules (`config`, `formatter`, `state`) are unit-tested. HTTP (`client`), async orchestration (`poller`, `mod.rs`), and frontend UI are covered by the manual checklist only. This is deliberate per the spec.
