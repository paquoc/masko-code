# Mascot Token Usage Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact panel next to the mascot overlay showing cumulative Claude Code token usage aggregated across all active sessions, with configurable metrics, a hover tooltip per-session breakdown, and a quick toggle in the context menu.

**Architecture:** A new Rust module (`token_usage`) owns a `HashMap<session_id, SessionParseState>` and incrementally parses the Claude Code JSONL transcript, advancing a byte offset per call so only new lines are read. The frontend (overlay webview only) has a new `tokenUsageStore` keyed by session id, plus a `TokenPanel` component rendered alongside `WorkingBubble` in `MascotOverlay`. Settings live on the existing `WorkingBubbleSettings` struct and sync via the existing `bubble-settings-changed` Tauri event. No file watcher; refresh is driven by existing `hook-event` listeners on `SessionStart`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SessionEnd`.

**Tech Stack:** Rust (`serde_json`, `std::fs`, `std::sync::Mutex`), Tauri 2, SolidJS, TypeScript.

**Spec:** [docs/superpowers/specs/2026-04-11-mascot-token-usage-panel-design.md](../specs/2026-04-11-mascot-token-usage-panel-design.md)

---

## File Structure

### New files (Rust)

| Path                              | Responsibility |
| --------------------------------- | -------------- |
| `src-tauri/src/token_usage/mod.rs` | `RawUsage`, `SessionParseState`, `TokenUsageState`, pure `parse_usage_into`, `read_session_usage` core, Tauri command implementations (`get_session_token_usage`, `reset_session_token_usage`), plus `#[cfg(test)]` unit tests |

### New files (Frontend)

| Path                                      | Responsibility |
| ----------------------------------------- | -------------- |
| `src/stores/token-usage-store.ts`         | Reactive Solid store keyed by session id, `refreshSession`, `removeSession`, `aggregate`, `computed`, `sessions` |
| `src/components/overlay/TokenPanel.tsx`   | Compact panel + hover tooltip. Takes `appearance`, `tokenSettings`, position props. |

### Modified files

| Path | What changes |
| ---- | ------------ |
| `src-tauri/src/lib.rs` | Declare `mod token_usage;`, register `TokenUsageState` via `.manage()`, add 2 commands to `invoke_handler!` |
| `src-tauri/src/commands.rs` | Add 2 thin Tauri command wrappers following the telegram pattern |
| `src/stores/working-bubble-store.ts` | Add `TokenMetricKey`, `TokenPanelSettings`, extend `WorkingBubbleSettings` with `tokenPanel`, update `defaultSettings`, update `loadSettings` deep-merge |
| `src/components/overlay/MascotOverlay.tsx` | Import `tokenUsageStore` + `TokenPanel`, dispatch refresh/remove in the existing `hook-event` listener (~line 616), add layout helper for panel positioning, render `<TokenPanel>` in the overlay tree, extend `MenuRow` with optional `checked` prop, add "Tokens" row in `ContextMenu` |
| `src/components/dashboard/SettingsPanel.tsx` | Add "Token Panel" section (toggle + metric list with up/down reorder), extend `loadBubbleSettings` deep merge, mount a preview `TokenPanel` alongside the existing `WorkingBubble` preview |

### Unchanged but referenced

- `src/services/event-processor.ts` — not modified. Overlay has its own `hook-event` listener.
- `src-tauri/src/models.rs::AgentEvent` — already has `transcript_path: Option<String>` (line 10).
- `src/models/agent-event.ts` — already has `transcript_path?: string` (line 84).

---

## Task 0: Baseline verification

**Files:** no changes

- [ ] **Step 1:** Confirm current branch

Run: `git branch --show-current`
Expected: `usage` (or whichever feature branch the worktree is on).

- [ ] **Step 2:** Confirm clean tree

Run: `git status --short`
Expected: empty output.

- [ ] **Step 3:** Confirm workspace builds

Run: `cd src-tauri && cargo check` (from the repo root: `cd d:/project/other/masko-code && cd src-tauri && cargo check`)
Expected: finishes with `0 errors`.

- [ ] **Step 4:** Confirm TypeScript typechecks

Run: `npx tsc --noEmit`
Expected: finishes with no diagnostics.

---

## Task 1: Rust — `token_usage` module with TDD

**Files:**
- Create: `src-tauri/src/token_usage/mod.rs`

This task builds the pure parser and the stateful incremental reader, test-first. No Tauri wiring yet — that is Task 2.

- [ ] **Step 1:** Create the module file with skeleton types and empty function bodies

```rust
// src-tauri/src/token_usage/mod.rs

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::Serialize;

#[derive(Debug, Default, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RawUsage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_creation: u64,
}

impl RawUsage {
    fn add(&mut self, other: &RawUsage) {
        self.input = self.input.saturating_add(other.input);
        self.output = self.output.saturating_add(other.output);
        self.cache_read = self.cache_read.saturating_add(other.cache_read);
        self.cache_creation = self.cache_creation.saturating_add(other.cache_creation);
    }
}

#[derive(Debug)]
struct SessionParseState {
    path: PathBuf,
    offset: u64,
    mtime: Option<SystemTime>,
    totals: RawUsage,
}

#[derive(Default)]
pub struct TokenUsageState {
    sessions: Mutex<HashMap<String, SessionParseState>>,
}

impl TokenUsageState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Incrementally parse the transcript for `session_id` at `path`.
    /// Returns the current cumulative raw usage.
    pub fn read_session_usage(
        &self,
        session_id: &str,
        path: &Path,
    ) -> RawUsage {
        let _ = (session_id, path);
        RawUsage::default()
    }

    pub fn reset_session(&self, session_id: &str) {
        let _ = session_id;
    }
}

/// Parse a single JSONL line. If it has `message.usage`, add its fields into `totals`.
/// Unknown or missing fields default to 0. Malformed JSON is silently skipped.
fn parse_usage_into(line: &str, totals: &mut RawUsage) {
    let _ = (line, totals);
}
```

- [ ] **Step 2:** Add `mod token_usage;` declaration (private, matching the existing `mod telegram;` style)

Edit `src-tauri/src/lib.rs` line ~8 (after `mod telegram;`):

```rust
mod telegram;
mod token_usage;
```

- [ ] **Step 3:** Verify the module compiles

Run: `cd src-tauri && cargo check`
Expected: finishes with `0 errors` (warnings about unused code are fine).

- [ ] **Step 4:** Commit skeleton

```bash
git add src-tauri/src/token_usage/mod.rs src-tauri/src/lib.rs
git commit -m "feat(token-usage): scaffold rust module"
```

- [ ] **Step 5:** Write the first failing test — `parse_usage_into` with a well-formed line

Append to `src-tauri/src/token_usage/mod.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_ASSISTANT_LINE: &str = r#"{"type":"assistant","message":{"usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":30,"cache_read_input_tokens":200}}}"#;

    #[test]
    fn parse_usage_into_well_formed_line_adds_all_fields() {
        let mut totals = RawUsage::default();
        parse_usage_into(SAMPLE_ASSISTANT_LINE, &mut totals);
        assert_eq!(
            totals,
            RawUsage {
                input: 100,
                output: 50,
                cache_read: 200,
                cache_creation: 30,
            }
        );
    }
}
```

- [ ] **Step 6:** Run test — verify FAIL

Run: `cd src-tauri && cargo test --lib token_usage::tests::parse_usage_into_well_formed_line_adds_all_fields`
Expected: FAIL (`left: RawUsage { ..zeros.. }, right: RawUsage { input: 100, ... }`).

- [ ] **Step 7:** Implement `parse_usage_into`

Replace the stub:

```rust
fn parse_usage_into(line: &str, totals: &mut RawUsage) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    let value: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return,
    };
    let Some(usage) = value.get("message").and_then(|m| m.get("usage")) else {
        return;
    };

    let pick = |key: &str| -> u64 {
        usage.get(key).and_then(|v| v.as_u64()).unwrap_or(0)
    };

    let delta = RawUsage {
        input: pick("input_tokens"),
        output: pick("output_tokens"),
        cache_read: pick("cache_read_input_tokens"),
        cache_creation: pick("cache_creation_input_tokens"),
    };
    totals.add(&delta);
}
```

- [ ] **Step 8:** Run test — verify PASS

Run: `cd src-tauri && cargo test --lib token_usage::tests::parse_usage_into_well_formed_line_adds_all_fields`
Expected: PASS.

- [ ] **Step 9:** Add negative-case tests

Append to the `tests` module:

```rust
    #[test]
    fn parse_usage_into_no_usage_field_is_noop() {
        let mut totals = RawUsage { input: 5, ..Default::default() };
        parse_usage_into(r#"{"type":"user","message":{"content":"hi"}}"#, &mut totals);
        assert_eq!(totals.input, 5);
        assert_eq!(totals.output, 0);
    }

    #[test]
    fn parse_usage_into_malformed_json_is_noop() {
        let mut totals = RawUsage::default();
        parse_usage_into("{not json", &mut totals);
        assert_eq!(totals, RawUsage::default());
    }

    #[test]
    fn parse_usage_into_missing_fields_default_to_zero() {
        let mut totals = RawUsage::default();
        parse_usage_into(
            r#"{"message":{"usage":{"input_tokens":7}}}"#,
            &mut totals,
        );
        assert_eq!(
            totals,
            RawUsage { input: 7, output: 0, cache_read: 0, cache_creation: 0 }
        );
    }

    #[test]
    fn parse_usage_into_accumulates_across_calls() {
        let mut totals = RawUsage::default();
        parse_usage_into(SAMPLE_ASSISTANT_LINE, &mut totals);
        parse_usage_into(SAMPLE_ASSISTANT_LINE, &mut totals);
        assert_eq!(totals.input, 200);
        assert_eq!(totals.output, 100);
        assert_eq!(totals.cache_read, 400);
        assert_eq!(totals.cache_creation, 60);
    }
```

- [ ] **Step 10:** Run all parser tests — verify PASS

Run: `cd src-tauri && cargo test --lib token_usage::tests::parse_usage_into`
Expected: 4 passed.

- [ ] **Step 11:** Commit parser

```bash
git add src-tauri/src/token_usage/mod.rs
git commit -m "feat(token-usage): pure line parser with tests"
```

- [ ] **Step 12:** Write failing test for `read_session_usage` over a fixture file

Append to the `tests` module:

```rust
    use std::io::Write;
    use tempfile::tempdir;

    fn write_jsonl(path: &Path, lines: &[&str]) {
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        for line in lines {
            writeln!(f, "{}", line).unwrap();
        }
        f.flush().unwrap();
    }

    #[test]
    fn read_session_usage_parses_full_file_on_first_call() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        write_jsonl(
            &path,
            &[
                r#"{"type":"user","message":{}}"#,
                SAMPLE_ASSISTANT_LINE,
                SAMPLE_ASSISTANT_LINE,
            ],
        );

        let state = TokenUsageState::new();
        let totals = state.read_session_usage("sid", &path);

        assert_eq!(totals.input, 200);
        assert_eq!(totals.output, 100);
        assert_eq!(totals.cache_read, 400);
        assert_eq!(totals.cache_creation, 60);
    }
```

Check `src-tauri/Cargo.toml` for `tempfile` under `[dev-dependencies]`. If missing, add it:

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 13:** Run test — verify FAIL

Run: `cd src-tauri && cargo test --lib token_usage::tests::read_session_usage_parses_full_file_on_first_call`
Expected: FAIL (totals stay zero because `read_session_usage` is still a stub).

- [ ] **Step 14:** Implement `read_session_usage`

Replace the stub:

```rust
impl TokenUsageState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn read_session_usage(
        &self,
        session_id: &str,
        path: &Path,
    ) -> RawUsage {
        let meta = match std::fs::metadata(path) {
            Ok(m) => m,
            Err(_) => return RawUsage::default(), // file not created yet
        };
        let file_len = meta.len();
        let mtime = meta.modified().ok();

        let mut sessions = self.sessions.lock().expect("token_usage mutex poisoned");
        let entry = sessions
            .entry(session_id.to_string())
            .or_insert_with(|| SessionParseState {
                path: path.to_path_buf(),
                offset: 0,
                mtime: None,
                totals: RawUsage::default(),
            });

        // Reset on path change or truncation/rotation
        if entry.path != path || file_len < entry.offset {
            entry.path = path.to_path_buf();
            entry.offset = 0;
            entry.totals = RawUsage::default();
        }
        entry.mtime = mtime;

        // Nothing new to read
        if file_len == entry.offset {
            return entry.totals;
        }

        let file = match File::open(path) {
            Ok(f) => f,
            Err(_) => return entry.totals,
        };
        let mut reader = BufReader::new(file);
        if reader.seek(SeekFrom::Start(entry.offset)).is_err() {
            return entry.totals;
        }

        let mut buf = String::new();
        loop {
            buf.clear();
            let n = match reader.read_line(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            if !buf.ends_with('\n') {
                // Partial last line — do not advance past it.
                break;
            }
            entry.offset = entry.offset.saturating_add(n as u64);
            parse_usage_into(&buf, &mut entry.totals);
        }

        entry.totals
    }

    pub fn reset_session(&self, session_id: &str) {
        let mut sessions = self.sessions.lock().expect("token_usage mutex poisoned");
        sessions.remove(session_id);
    }
}
```

- [ ] **Step 15:** Run test — verify PASS

Run: `cd src-tauri && cargo test --lib token_usage::tests::read_session_usage_parses_full_file_on_first_call`
Expected: PASS.

- [ ] **Step 16:** Add incremental test — second call only reads new lines

Append to `tests`:

```rust
    #[test]
    fn read_session_usage_incremental_second_call_only_reads_new_lines() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        write_jsonl(&path, &[SAMPLE_ASSISTANT_LINE]);

        let state = TokenUsageState::new();
        let first = state.read_session_usage("sid", &path);
        assert_eq!(first.input, 100);

        write_jsonl(&path, &[SAMPLE_ASSISTANT_LINE]);
        let second = state.read_session_usage("sid", &path);

        assert_eq!(second.input, 200);
        assert_eq!(second.output, 100);
    }

    #[test]
    fn read_session_usage_missing_file_returns_zero() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("not-there.jsonl");
        let state = TokenUsageState::new();
        let totals = state.read_session_usage("sid", &path);
        assert_eq!(totals, RawUsage::default());
    }

    #[test]
    fn read_session_usage_truncation_resets_and_reparses() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        write_jsonl(&path, &[SAMPLE_ASSISTANT_LINE, SAMPLE_ASSISTANT_LINE]);

        let state = TokenUsageState::new();
        let _ = state.read_session_usage("sid", &path);

        // Truncate the file to a smaller size by rewriting
        std::fs::write(&path, "").unwrap();
        write_jsonl(&path, &[SAMPLE_ASSISTANT_LINE]);

        let after = state.read_session_usage("sid", &path);
        assert_eq!(after.input, 100);
        assert_eq!(after.output, 50);
    }

    #[test]
    fn read_session_usage_partial_last_line_is_not_counted() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("session.jsonl");

        // Write a complete line, then a partial (no trailing newline)
        {
            let mut f = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .unwrap();
            writeln!(f, "{}", SAMPLE_ASSISTANT_LINE).unwrap();
            write!(f, "{}", SAMPLE_ASSISTANT_LINE).unwrap(); // partial — no \n
        }

        let state = TokenUsageState::new();
        let first = state.read_session_usage("sid", &path);
        assert_eq!(first.input, 100, "partial line should not be counted");

        // Now finish the partial line
        {
            let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
            writeln!(f).unwrap();
        }
        let second = state.read_session_usage("sid", &path);
        assert_eq!(second.input, 200);
    }

    #[test]
    fn reset_session_removes_entry() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        write_jsonl(&path, &[SAMPLE_ASSISTANT_LINE]);
        let state = TokenUsageState::new();
        let _ = state.read_session_usage("sid", &path);
        state.reset_session("sid");
        // After reset, a new read re-parses from offset 0
        let again = state.read_session_usage("sid", &path);
        assert_eq!(again.input, 100);
    }
```

- [ ] **Step 17:** Run all token_usage tests — verify PASS

Run: `cd src-tauri && cargo test --lib token_usage::`
Expected: 9 passed.

- [ ] **Step 18:** Commit state machine

```bash
git add src-tauri/src/token_usage/mod.rs src-tauri/Cargo.toml
git commit -m "feat(token-usage): incremental parser with full test coverage"
```

---

## Task 2: Rust — Tauri commands and state registration

**Files:**
- Modify: `src-tauri/src/commands.rs` (add 2 commands)
- Modify: `src-tauri/src/lib.rs` (register state, add to invoke_handler)

- [ ] **Step 1:** Append Tauri command wrappers to `src-tauri/src/commands.rs`

Add at the very bottom of the file (after the Telegram block, ~line 318):

```rust
// ===== Token usage commands =====

use crate::token_usage::{RawUsage, TokenUsageState};
use std::path::PathBuf;

#[tauri::command(rename_all = "camelCase")]
pub fn get_session_token_usage(
    state: tauri::State<'_, TokenUsageState>,
    session_id: String,
    transcript_path: String,
) -> Result<RawUsage, String> {
    let path = PathBuf::from(&transcript_path);
    Ok(state.read_session_usage(&session_id, &path))
}

#[tauri::command(rename_all = "camelCase")]
pub fn reset_session_token_usage(
    state: tauri::State<'_, TokenUsageState>,
    session_id: String,
) -> Result<(), String> {
    state.reset_session(&session_id);
    Ok(())
}
```

- [ ] **Step 2:** Register `TokenUsageState` in `src-tauri/src/lib.rs`

Find the `.manage(pending_permissions)` call (~line 29) and add after it:

```rust
        .manage(pending_permissions)
        .manage(crate::token_usage::TokenUsageState::new())
```

- [ ] **Step 3:** Add the two commands to the `invoke_handler!` macro list

In `src-tauri/src/lib.rs` (~line 135), at the end of the list (after `commands::telegram_get_status,`):

```rust
            commands::telegram_get_status,
            commands::get_session_token_usage,
            commands::reset_session_token_usage,
```

- [ ] **Step 4:** Verify the Rust side compiles

Run: `cd src-tauri && cargo check`
Expected: no errors. Warnings about unused `RawUsage` reexport are fine.

- [ ] **Step 5:** Verify tests still pass

Run: `cd src-tauri && cargo test --lib token_usage::`
Expected: 9 passed.

- [ ] **Step 6:** Commit

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(token-usage): register tauri commands and state"
```

---

## Task 3: Frontend — extend `working-bubble-store` with `TokenPanelSettings`

**Files:**
- Modify: `src/stores/working-bubble-store.ts`

- [ ] **Step 1:** Add new exported types after the existing `BubbleAppearance` declaration

Insert after the `BubbleAppearance` interface (~line 22):

```ts
export type TokenMetricKey =
  | "read"
  | "write"
  | "total"
  | "input"
  | "output"
  | "cache_read"
  | "cache_creation";

export const ALL_TOKEN_METRICS: TokenMetricKey[] = [
  "read",
  "write",
  "total",
  "input",
  "output",
  "cache_read",
  "cache_creation",
];

export interface TokenPanelSettings {
  enabled: boolean;
  order: TokenMetricKey[];
  visible: Record<TokenMetricKey, boolean>;
}
```

- [ ] **Step 2:** Add `tokenPanel` to `WorkingBubbleSettings`

Modify the existing interface (~line 24):

```ts
export interface WorkingBubbleSettings {
  showToolBubble: boolean;
  showSessionStart: boolean;
  showSessionEnd: boolean;
  appearance: BubbleAppearance;
  tokenPanel: TokenPanelSettings;
}
```

- [ ] **Step 3:** Add a default constant for `tokenPanel`

After the existing `defaultAppearance` constant (~line 49):

```ts
export const defaultTokenPanel: TokenPanelSettings = {
  enabled: true,
  order: ["read", "write", "total", "input", "output", "cache_read", "cache_creation"],
  visible: {
    read: true,
    write: true,
    total: true,
    input: false,
    output: false,
    cache_read: false,
    cache_creation: false,
  },
};
```

- [ ] **Step 4:** Include `tokenPanel` in `defaultSettings`

Modify `defaultSettings` (~line 51):

```ts
const defaultSettings: WorkingBubbleSettings = {
  showToolBubble: true,
  showSessionStart: true,
  showSessionEnd: true,
  appearance: { ...defaultAppearance },
  tokenPanel: {
    ...defaultTokenPanel,
    order: [...defaultTokenPanel.order],
    visible: { ...defaultTokenPanel.visible },
  },
};
```

- [ ] **Step 5:** Deep-merge `tokenPanel` in `loadSettings`

Replace the existing `loadSettings` body (~line 33):

```ts
function loadSettings(): WorkingBubbleSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WorkingBubbleSettings>;
      return {
        ...defaultSettings,
        ...parsed,
        appearance: { ...defaultSettings.appearance, ...(parsed.appearance ?? {}) },
        tokenPanel: mergeTokenPanel(parsed.tokenPanel),
      };
    }
  } catch { /* ignore */ }
  return {
    ...defaultSettings,
    appearance: { ...defaultSettings.appearance },
    tokenPanel: {
      ...defaultTokenPanel,
      order: [...defaultTokenPanel.order],
      visible: { ...defaultTokenPanel.visible },
    },
  };
}

function mergeTokenPanel(stored: Partial<TokenPanelSettings> | undefined): TokenPanelSettings {
  const base: TokenPanelSettings = {
    ...defaultTokenPanel,
    order: [...defaultTokenPanel.order],
    visible: { ...defaultTokenPanel.visible },
  };
  if (!stored) return base;
  if (typeof stored.enabled === "boolean") base.enabled = stored.enabled;
  if (Array.isArray(stored.order)) {
    const seen = new Set<TokenMetricKey>();
    const filtered: TokenMetricKey[] = [];
    for (const k of stored.order) {
      if (ALL_TOKEN_METRICS.includes(k as TokenMetricKey) && !seen.has(k as TokenMetricKey)) {
        filtered.push(k as TokenMetricKey);
        seen.add(k as TokenMetricKey);
      }
    }
    for (const k of ALL_TOKEN_METRICS) {
      if (!seen.has(k)) filtered.push(k);
    }
    base.order = filtered;
  }
  if (stored.visible && typeof stored.visible === "object") {
    for (const k of ALL_TOKEN_METRICS) {
      const v = (stored.visible as Record<string, unknown>)[k];
      if (typeof v === "boolean") base.visible[k] = v;
    }
  }
  return base;
}
```

- [ ] **Step 6:** Run TypeScript check

Run: `npx tsc --noEmit`
Expected: no diagnostics.

- [ ] **Step 7:** Commit

```bash
git add src/stores/working-bubble-store.ts
git commit -m "feat(token-panel): extend working bubble settings with token panel config"
```

---

## Task 4: Frontend — `tokenUsageStore`

**Files:**
- Create: `src/stores/token-usage-store.ts`

- [ ] **Step 1:** Create the store file

```ts
// src/stores/token-usage-store.ts

import { createStore, produce } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { error, log } from "../services/log";
import type { TokenMetricKey } from "./working-bubble-store";

export interface RawUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface SessionTokenUsage extends RawUsage {
  sessionId: string;
  projectName: string;
}

interface TokenUsageStoreState {
  bySession: Record<string, SessionTokenUsage>;
  pathCache: Record<string, string>;
}

const [state, setState] = createStore<TokenUsageStoreState>({
  bySession: {},
  pathCache: {},
});

interface RustRawUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

async function refreshSession(
  sessionId: string,
  transcriptPath?: string,
  projectName?: string,
): Promise<void> {
  if (!sessionId) return;
  const path = transcriptPath || state.pathCache[sessionId];
  if (!path) return;

  if (transcriptPath) {
    setState("pathCache", sessionId, transcriptPath);
  }

  try {
    const raw = await invoke<RustRawUsage>("get_session_token_usage", {
      sessionId,
      transcriptPath: path,
    });

    const prev = state.bySession[sessionId];
    setState("bySession", sessionId, {
      sessionId,
      projectName: projectName ?? prev?.projectName ?? "",
      input: raw.input ?? 0,
      output: raw.output ?? 0,
      cacheRead: raw.cacheRead ?? 0,
      cacheCreation: raw.cacheCreation ?? 0,
    });
  } catch (e) {
    error("tokenUsageStore.refreshSession failed:", e);
  }
}

async function removeSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  try {
    await invoke("reset_session_token_usage", { sessionId });
  } catch (e) {
    log("tokenUsageStore.removeSession invoke failed (ignored):", e);
  }
  setState(
    "bySession",
    produce((bs) => {
      delete bs[sessionId];
    }),
  );
  setState(
    "pathCache",
    produce((pc) => {
      delete pc[sessionId];
    }),
  );
}

function aggregate(): RawUsage {
  const totals: RawUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  for (const s of Object.values(state.bySession)) {
    totals.input += s.input;
    totals.output += s.output;
    totals.cacheRead += s.cacheRead;
    totals.cacheCreation += s.cacheCreation;
  }
  return totals;
}

function computed(metric: TokenMetricKey): number {
  const t = aggregate();
  switch (metric) {
    case "read": return t.input + t.cacheRead;
    case "write": return t.output + t.cacheCreation;
    case "total": return t.input + t.output + t.cacheRead + t.cacheCreation;
    case "input": return t.input;
    case "output": return t.output;
    case "cache_read": return t.cacheRead;
    case "cache_creation": return t.cacheCreation;
  }
}

function sessions(): SessionTokenUsage[] {
  return Object.values(state.bySession)
    .filter((s) => s.input + s.output + s.cacheRead + s.cacheCreation > 0)
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId));
}

function hasAnyUsage(): boolean {
  for (const s of Object.values(state.bySession)) {
    if (s.input + s.output + s.cacheRead + s.cacheCreation > 0) return true;
  }
  return false;
}

export const tokenUsageStore = {
  get bySession() { return state.bySession; },
  refreshSession,
  removeSession,
  aggregate,
  computed,
  sessions,
  hasAnyUsage,
};
```

- [ ] **Step 2:** Run TypeScript check

Run: `npx tsc --noEmit`
Expected: no diagnostics.

- [ ] **Step 3:** Commit

```bash
git add src/stores/token-usage-store.ts
git commit -m "feat(token-panel): add token usage store with incremental refresh"
```

---

## Task 5: Frontend — `TokenPanel` component (panel rendering only, no tooltip)

**Files:**
- Create: `src/components/overlay/TokenPanel.tsx`

- [ ] **Step 1:** Create the panel component with the body-only variant (tooltip added in Task 6)

```tsx
// src/components/overlay/TokenPanel.tsx

import { createMemo, For, Show, createSignal } from "solid-js";
import type { BubbleAppearance, TokenMetricKey, TokenPanelSettings } from "../../stores/working-bubble-store";
import { tokenUsageStore, type SessionTokenUsage } from "../../stores/token-usage-store";

const METRIC_ICON: Record<TokenMetricKey, string> = {
  read: "↓",
  write: "↑",
  total: "Σ",
  input: "→",
  output: "←",
  cache_read: "⇣",
  cache_creation: "⇡",
};

function formatShort(n: number): string {
  if (n < 1_000) return n.toString();
  if (n < 1_000_000) return (n / 1_000).toFixed(1) + "K";
  if (n < 1_000_000_000) return (n / 1_000_000).toFixed(1) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

function formatFull(n: number): string {
  return n.toLocaleString("en-US");
}

export interface TokenPanelProps {
  appearance: BubbleAppearance;
  tokenSettings: TokenPanelSettings;
  previewSessions?: SessionTokenUsage[];  // preview in SettingsPanel
}

export default function TokenPanel(props: TokenPanelProps) {
  const metrics = createMemo(() =>
    props.tokenSettings.order.filter((k) => props.tokenSettings.visible[k]),
  );

  const totalsFromPreview = createMemo(() => {
    const list = props.previewSessions;
    if (!list) return null;
    const t = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    for (const s of list) {
      t.input += s.input;
      t.output += s.output;
      t.cacheRead += s.cacheRead;
      t.cacheCreation += s.cacheCreation;
    }
    return t;
  });

  const computed = (k: TokenMetricKey): number => {
    const pv = totalsFromPreview();
    if (pv) {
      switch (k) {
        case "read": return pv.input + pv.cacheRead;
        case "write": return pv.output + pv.cacheCreation;
        case "total": return pv.input + pv.output + pv.cacheRead + pv.cacheCreation;
        case "input": return pv.input;
        case "output": return pv.output;
        case "cache_read": return pv.cacheRead;
        case "cache_creation": return pv.cacheCreation;
      }
    }
    return tokenUsageStore.computed(k);
  };

  const sessionsList = (): SessionTokenUsage[] =>
    props.previewSessions ?? tokenUsageStore.sessions();

  const shouldRender = createMemo(() => {
    if (!props.tokenSettings.enabled) return false;
    if (metrics().length === 0) return false;
    if (props.previewSessions) {
      // Preview always renders when enabled so users see style changes
      return true;
    }
    return tokenUsageStore.hasAnyUsage();
  });

  const [hovering, setHovering] = createSignal(false);

  return (
    <Show when={shouldRender()}>
      <div
        class="rounded-lg shadow-md select-none relative"
        style={{
          background: props.appearance.bgColor,
          color: props.appearance.textColor,
          "font-size": `${props.appearance.fontSize}px`,
          "font-family": "system-ui, sans-serif",
          padding: "6px 10px",
          "min-width": "78px",
          "pointer-events": "auto",
        }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClick={(e) => { e.stopPropagation(); /* no-op */ }}
      >
        <div class="flex flex-col gap-0.5">
          <For each={metrics()}>
            {(k) => (
              <div class="flex items-center gap-1.5 tabular-nums">
                <span style={{ color: props.appearance.mutedColor, width: "0.9em", "text-align": "center" }}>
                  {METRIC_ICON[k]}
                </span>
                <span class="flex-1 text-right">{formatShort(computed(k))}</span>
              </div>
            )}
          </For>
        </div>

        {/* Tooltip slot — filled in Task 6 */}
        <Show when={hovering()}>
          <div data-testid="token-tooltip-placeholder" style={{ display: "none" }} />
        </Show>
      </div>
    </Show>
  );
}

export { formatShort, formatFull };
```

- [ ] **Step 2:** Run TypeScript check

Run: `npx tsc --noEmit`
Expected: no diagnostics.

- [ ] **Step 3:** Commit

```bash
git add src/components/overlay/TokenPanel.tsx
git commit -m "feat(token-panel): add TokenPanel component (body, no tooltip yet)"
```

---

## Task 6: Frontend — `TokenPanel` hover tooltip

**Files:**
- Modify: `src/components/overlay/TokenPanel.tsx`

- [ ] **Step 1:** Replace the placeholder tooltip slot with the real tooltip block

Inside `TokenPanel`, replace the `Show when={hovering()}` block with:

```tsx
        <Show when={hovering() && sessionsList().length > 0}>
          <div
            class="absolute rounded-lg shadow-lg"
            style={{
              "z-index": 60,
              background: props.appearance.bgColor,
              color: props.appearance.textColor,
              "font-size": `${Math.max(10, props.appearance.fontSize - 1)}px`,
              "font-family": "system-ui, sans-serif",
              padding: "8px 10px",
              "min-width": "200px",
              "max-height": "80vh",
              "overflow-y": "auto",
              // Anchor to the right edge of the panel body by default
              left: "calc(100% + 8px)",
              top: "0",
              "pointer-events": "none",
              "white-space": "nowrap",
            }}
          >
            <For each={sessionsList()}>
              {(s, i) => (
                <div>
                  <Show when={i() > 0}>
                    <div style={{ height: "1px", background: props.appearance.mutedColor, opacity: "0.25", margin: "6px 0" }} />
                  </Show>
                  <div style={{ "font-weight": "600", "margin-bottom": "2px" }}>
                    {s.projectName || s.sessionId.slice(0, 8)}
                  </div>
                  <TooltipRow label="input"        value={s.input}         muted={props.appearance.mutedColor} />
                  <TooltipRow label="output"       value={s.output}        muted={props.appearance.mutedColor} />
                  <TooltipRow label="cache read"   value={s.cacheRead}     muted={props.appearance.mutedColor} />
                  <TooltipRow label="cache create" value={s.cacheCreation} muted={props.appearance.mutedColor} />
                </div>
              )}
            </For>
          </div>
        </Show>
```

- [ ] **Step 2:** Add the `TooltipRow` helper at the bottom of the file

```tsx
function TooltipRow(props: { label: string; value: number; muted: string }) {
  return (
    <div class="flex items-center justify-between gap-4 tabular-nums">
      <span style={{ color: props.muted }}>{props.label}</span>
      <span>{formatFull(props.value)}</span>
    </div>
  );
}
```

- [ ] **Step 3:** Run TypeScript check

Run: `npx tsc --noEmit`
Expected: no diagnostics.

- [ ] **Step 4:** Commit

```bash
git add src/components/overlay/TokenPanel.tsx
git commit -m "feat(token-panel): add hover tooltip with per-session breakdown"
```

---

## Task 7: Frontend — integrate panel into `MascotOverlay`

**Files:**
- Modify: `src/components/overlay/MascotOverlay.tsx`

- [ ] **Step 1:** Add imports near the top (~line 11)

```ts
import { tokenUsageStore } from "../../stores/token-usage-store";
import TokenPanel from "./TokenPanel";
```

- [ ] **Step 2:** Dispatch refresh/remove in the hook-event listener (~line 616)

Inside the `listen<any>("hook-event", (e) => { ... })` handler, after the `switch (eventType) { ... }` block and before the closing `});`, insert:

```ts
      // Token usage refresh
      if (event.session_id) {
        const projectNameForToken = event.cwd
          ? event.cwd.replace(/\\/g, "/").split("/").pop() || ""
          : "";
        switch (eventType) {
          case HookEventType.SessionStart:
          case HookEventType.PostToolUse:
          case HookEventType.PostToolUseFailure:
          case HookEventType.Stop:
            tokenUsageStore.refreshSession(
              event.session_id,
              event.transcript_path,
              projectNameForToken,
            );
            break;
          case HookEventType.SessionEnd:
            tokenUsageStore.removeSession(event.session_id);
            break;
        }
      }
```

- [ ] **Step 3:** Add a `tokenPanelLayout` helper next to `bubbleLayout` (~line 920)

After the `bubbleLayout` closure, add:

```ts
  // Token panel layout: place opposite to working bubble, fall back gracefully.
  // Note: TOKEN_PANEL_H is a coarse approximation — the real panel height grows
  // with the number of enabled metrics. This value is only used to pick a side
  // and to clamp to the screen, so exact pixels don't matter. Do not "fix" it.
  const TOKEN_PANEL_W = 96;
  const TOKEN_PANEL_H = 90;
  const tokenPanelLayout = (): { x: number; y: number } => {
    const mx = overlayPositionStore.x;
    const my = overlayPositionStore.y;
    const MASCOT = effectiveSize();
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const GAP_PX = 8;

    // Prefer: left of mascot, right of mascot, below mascot, above mascot
    const candidates: Array<{ x: number; y: number }> = [
      { x: mx - TOKEN_PANEL_W - GAP_PX, y: my + MASCOT / 2 - TOKEN_PANEL_H / 2 },
      { x: mx + MASCOT + GAP_PX,        y: my + MASCOT / 2 - TOKEN_PANEL_H / 2 },
      { x: mx + MASCOT / 2 - TOKEN_PANEL_W / 2, y: my + MASCOT + GAP_PX },
      { x: mx + MASCOT / 2 - TOKEN_PANEL_W / 2, y: my - TOKEN_PANEL_H - GAP_PX },
    ];

    // If WorkingBubble is visible, avoid its side (left/right/down tails)
    const bubbleTail = workingBubbleStore.state.visible
      ? bubbleLayout(176, 80).tail
      : null;

    const prefer = (c: { x: number; y: number }): boolean => {
      if (!bubbleTail) return true;
      // Skip candidates that collide with the bubble's anchor side
      if (bubbleTail === "left" && c.x > mx) return false;      // bubble on right → skip right candidate
      if (bubbleTail === "right" && c.x < mx) return false;     // bubble on left  → skip left candidate
      if (bubbleTail === "down" && c.y < my) return false;      // bubble above    → skip above candidate
      return true;
    };

    const fits = (c: { x: number; y: number }): boolean =>
      c.x >= 4 && c.y >= 4 && c.x + TOKEN_PANEL_W <= screenW - 4 && c.y + TOKEN_PANEL_H <= screenH - 4;

    for (const c of candidates) {
      if (prefer(c) && fits(c)) return c;
    }
    for (const c of candidates) {
      if (fits(c)) return c;
    }
    // Last resort: clamp first candidate to screen
    const c = candidates[0];
    return {
      x: Math.max(4, Math.min(c.x, screenW - TOKEN_PANEL_W - 4)),
      y: Math.max(4, Math.min(c.y, screenH - TOKEN_PANEL_H - 4)),
    };
  };
```

- [ ] **Step 4:** Render `<TokenPanel>` inside the overlay tree

Find the `<Show when={workingBubbleStore.state.visible && !currentPermission()}>` block (~line 982). Immediately **after** its closing `</Show>`, add:

```tsx
      {/* Token usage panel — positioned independently of working bubble */}
      <Show when={workingBubbleStore.settings.tokenPanel.enabled}>
        {(() => {
          const l = () => tokenPanelLayout();
          return (
            <div
              class="absolute"
              style={{
                "z-index": 14,
                left: `${l().x}px`,
                top: `${l().y}px`,
              }}
            >
              <TokenPanel
                appearance={workingBubbleStore.settings.appearance}
                tokenSettings={workingBubbleStore.settings.tokenPanel}
              />
            </div>
          );
        })()}
      </Show>
```

- [ ] **Step 5:** Run TypeScript check

Run: `npx tsc --noEmit`
Expected: no diagnostics.

- [ ] **Step 6:** Commit

```bash
git add src/components/overlay/MascotOverlay.tsx
git commit -m "feat(token-panel): wire TokenPanel into mascot overlay"
```

---

## Task 8: Frontend — ContextMenu quick toggle

**Files:**
- Modify: `src/components/overlay/MascotOverlay.tsx`

- [ ] **Step 1:** Extend `MenuRow` with an optional `checked` prop

Replace the `MenuRow` component (~line 217) with:

```tsx
function MenuRow(props: {
  label: string;
  icon: string;
  danger?: boolean;
  hasArrow?: boolean;
  active?: boolean;
  checked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      class="w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left"
      classList={{
        "text-red-400 hover:bg-red-500/15": !!props.danger,
        "text-white/80 hover:bg-white/10": !props.danger,
        "bg-white/10": !!props.active,
      }}
      onClick={props.onClick}
    >
      <span class="w-4 text-center text-xs opacity-90">{props.icon}</span>
      <span class="flex-1 font-medium" style={{ "font-size": "13px", "font-family": "system-ui, sans-serif" }}>
        {props.label}
      </span>
      <Show when={props.hasArrow}>
        <span class="opacity-40 text-xs">{props.active ? "▲" : "▼"}</span>
      </Show>
      <Show when={props.checked !== undefined && !props.hasArrow}>
        <span class="text-xs" style={{ color: props.checked ? "#fb923c" : "rgba(255,255,255,0.3)" }}>
          {props.checked ? "●" : "○"}
        </span>
      </Show>
    </button>
  );
}
```

- [ ] **Step 2:** Reference `workingBubbleStore` inside the `ContextMenu` component (not just the outer component)

Inside the `ContextMenu` function (~line 23), just below the existing `const telegramConfigured = ...` helper, add:

```tsx
  const tokenPanelEnabled = () => workingBubbleStore.settings.tokenPanel.enabled;
  const toggleTokenPanel = () => {
    const cur = workingBubbleStore.settings;
    workingBubbleStore.updateSettings({
      tokenPanel: { ...cur.tokenPanel, enabled: !cur.tokenPanel.enabled },
    });
    emit("bubble-settings-changed", {
      ...cur,
      tokenPanel: { ...cur.tokenPanel, enabled: !cur.tokenPanel.enabled },
    }).catch(() => {});
  };
```

(If `workingBubbleStore` is not already imported at the top of the file, add: `import { workingBubbleStore } from "../../stores/working-bubble-store";` — it is already imported at line 11, confirm before adding.)

- [ ] **Step 3:** Insert the Tokens row in the ContextMenu JSX

Find the `{/* Telegram */}` block that ends with `</Show>` followed by `<div class="h-px bg-white/10 mx-2" />` and then `<MenuRow label="Open Dashboard" ... />` (~line 203). Insert **after** the Telegram `</Show>` and **before** the divider:

```tsx
        {/* Tokens quick toggle */}
        <MenuRow
          label="Tokens"
          icon="#"
          checked={tokenPanelEnabled()}
          onClick={() => { toggleTokenPanel(); }}
        />
```

- [ ] **Step 4:** Run TypeScript check

Run: `npx tsc --noEmit`
Expected: no diagnostics.

- [ ] **Step 5:** Commit

```bash
git add src/components/overlay/MascotOverlay.tsx
git commit -m "feat(token-panel): add Tokens quick toggle in mascot context menu"
```

---

## Task 9: Frontend — SettingsPanel section + preview

**Files:**
- Modify: `src/components/dashboard/SettingsPanel.tsx`

- [ ] **Step 1:** Update imports first (types are used by steps below)

Modify the import line at the top (~line 5):

```ts
import type {
  WorkingBubbleSettings,
  BubbleAppearance,
  TokenPanelSettings,
  TokenMetricKey,
} from "../../stores/working-bubble-store";
import { defaultTokenPanel, ALL_TOKEN_METRICS } from "../../stores/working-bubble-store";
import TokenPanel from "../overlay/TokenPanel";
import type { SessionTokenUsage } from "../../stores/token-usage-store";
```

- [ ] **Step 2:** Update `loadBubbleSettings` to include the `tokenPanel` deep-merge

Replace the defaults object and the `loadBubbleSettings` body (~line 29) with:

```ts
function loadBubbleSettings(): WorkingBubbleSettings {
  const defaults: WorkingBubbleSettings = {
    showToolBubble: true,
    showSessionStart: true,
    showSessionEnd: true,
    appearance: { ...defaultAppearance },
    tokenPanel: {
      ...defaultTokenPanel,
      order: [...defaultTokenPanel.order],
      visible: { ...defaultTokenPanel.visible },
    },
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...defaults,
        ...parsed,
        appearance: { ...defaults.appearance, ...parsed.appearance },
        tokenPanel: mergeParsedTokenPanel(defaults.tokenPanel, parsed.tokenPanel),
      };
    }
  } catch { /* ignore */ }
  return defaults;
}

function mergeParsedTokenPanel(base: TokenPanelSettings, parsed: any): TokenPanelSettings {
  if (!parsed || typeof parsed !== "object") return base;
  const result: TokenPanelSettings = {
    enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : base.enabled,
    order: [...base.order],
    visible: { ...base.visible },
  };
  if (Array.isArray(parsed.order)) {
    const seen = new Set<TokenMetricKey>();
    const filtered: TokenMetricKey[] = [];
    for (const k of parsed.order) {
      if ((ALL_TOKEN_METRICS as string[]).includes(k) && !seen.has(k as TokenMetricKey)) {
        filtered.push(k as TokenMetricKey);
        seen.add(k as TokenMetricKey);
      }
    }
    for (const k of ALL_TOKEN_METRICS) {
      if (!seen.has(k)) filtered.push(k);
    }
    result.order = filtered;
  }
  if (parsed.visible && typeof parsed.visible === "object") {
    for (const k of ALL_TOKEN_METRICS) {
      if (typeof parsed.visible[k] === "boolean") result.visible[k] = parsed.visible[k];
    }
  }
  return result;
}
```

- [ ] **Step 3:** Add a stable preview dataset near the existing `previewPermission` (~line 50)

```ts
const previewTokenSessions: SessionTokenUsage[] = [
  {
    sessionId: "preview-a",
    projectName: "demo-project",
    input: 12_345,
    output: 3_210,
    cacheRead: 45_678,
    cacheCreation: 987,
  },
  {
    sessionId: "preview-b",
    projectName: "other-repo",
    input: 2_100,
    output: 450,
    cacheRead: 8_900,
    cacheCreation: 120,
  },
];
```

- [ ] **Step 4:** Add helper setters for token panel settings next to the existing setters (~line 106)

```ts
  function setTokenPanelEnabled(enabled: boolean) {
    setBubbleSettings("tokenPanel", "enabled", enabled);
    persistAndEmit();
  }

  function setMetricVisible(metric: TokenMetricKey, visible: boolean) {
    setBubbleSettings("tokenPanel", "visible", metric, visible);
    persistAndEmit();
  }

  function moveMetric(metric: TokenMetricKey, delta: -1 | 1) {
    const order = [...bubbleSettings.tokenPanel.order];
    const idx = order.indexOf(metric);
    const target = idx + delta;
    if (idx === -1 || target < 0 || target >= order.length) return;
    [order[idx], order[target]] = [order[target], order[idx]];
    setBubbleSettings("tokenPanel", "order", order);
    persistAndEmit();
  }
```

- [ ] **Step 5:** Update the "Bubble Appearance" preview area (~line 328) to render the token panel preview alongside

Replace the preview flex container (the `<div class="flex items-end justify-center gap-3 py-2">` block) with:

```tsx
          {/* Previews */}
          <div class="flex items-end justify-center gap-3 py-2 flex-wrap">
            <WorkingBubble
              appearance={bubbleSettings.appearance}
              previewState={{
                visible: true,
                status: "working",
                toolName: "Edit",
                toolDetail: "src/components/App.tsx",
                projectName: "my-project",
                sessionId: "",
              }}
            />
            <div style={{ transform: "scale(0.85)", "transform-origin": "bottom center" }}>
              <PermissionPrompt
                appearance={bubbleSettings.appearance}
                permission={previewPermission}
              />
            </div>
            <Show when={bubbleSettings.tokenPanel.enabled}>
              <TokenPanel
                appearance={bubbleSettings.appearance}
                tokenSettings={bubbleSettings.tokenPanel}
                previewSessions={previewTokenSessions}
              />
            </Show>
          </div>
```

- [ ] **Step 6:** Add a new "Token Panel" `<Section>` after the "Bubble Appearance" section (~line 381, after its closing `</Section>`)

```tsx
      {/* Token Panel */}
      <Section title="Token Panel">
        <div class="space-y-3">
          <ToggleRow
            label="Show token panel"
            description="Cumulative token counts next to the mascot"
            checked={bubbleSettings.tokenPanel.enabled}
            onChange={() => setTokenPanelEnabled(!bubbleSettings.tokenPanel.enabled)}
          />
          <Show when={bubbleSettings.tokenPanel.enabled}>
            <div class="space-y-1.5">
              <p class="text-xs text-text-muted">Metrics — drag is not supported; use arrows to reorder. Checkbox toggles visibility.</p>
              <For each={bubbleSettings.tokenPanel.order}>
                {(metricKey, idx) => (
                  <TokenMetricRow
                    metric={metricKey}
                    index={idx()}
                    total={bubbleSettings.tokenPanel.order.length}
                    visible={bubbleSettings.tokenPanel.visible[metricKey]}
                    onToggle={() => setMetricVisible(metricKey, !bubbleSettings.tokenPanel.visible[metricKey])}
                    onUp={() => moveMetric(metricKey, -1)}
                    onDown={() => moveMetric(metricKey, 1)}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
      </Section>
```

- [ ] **Step 7:** Add the `TokenMetricRow` helper component at the bottom of the file (near other helper components like `ColorRow`, `ToggleRow`)

```tsx
const METRIC_LABEL: Record<TokenMetricKey, { title: string; hint: string }> = {
  read: { title: "Read", hint: "input + cache read" },
  write: { title: "Write", hint: "output + cache create" },
  total: { title: "Total", hint: "all combined" },
  input: { title: "Input", hint: "raw input tokens" },
  output: { title: "Output", hint: "raw output tokens" },
  cache_read: { title: "Cache read", hint: "raw cache read input" },
  cache_creation: { title: "Cache create", hint: "raw cache creation input" },
};

function TokenMetricRow(props: {
  metric: TokenMetricKey;
  index: number;
  total: number;
  visible: boolean;
  onToggle: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const meta = () => METRIC_LABEL[props.metric];
  const isFirst = () => props.index === 0;
  const isLast = () => props.index === props.total - 1;
  return (
    <div class="flex items-center gap-2 py-1 px-2 rounded hover:bg-white/5">
      <div class="flex flex-col">
        <button
          class="text-[10px] leading-none px-1 disabled:opacity-20"
          disabled={isFirst()}
          onClick={props.onUp}
          title="Move up"
        >
          ▲
        </button>
        <button
          class="text-[10px] leading-none px-1 disabled:opacity-20"
          disabled={isLast()}
          onClick={props.onDown}
          title="Move down"
        >
          ▼
        </button>
      </div>
      <label class="flex items-center gap-2 flex-1 cursor-pointer">
        <input
          type="checkbox"
          checked={props.visible}
          onChange={props.onToggle}
          class="accent-orange-primary"
        />
        <span class="text-sm text-text-primary">{meta().title}</span>
        <span class="text-xs text-text-muted">{meta().hint}</span>
      </label>
    </div>
  );
}
```

- [ ] **Step 8:** Run TypeScript check

Run: `npx tsc --noEmit`
Expected: no diagnostics.

- [ ] **Step 9:** Commit

```bash
git add src/components/dashboard/SettingsPanel.tsx
git commit -m "feat(token-panel): add Token Panel section to settings with preview"
```

---

## Task 10: Full build + manual smoke test

**Files:** no changes

- [ ] **Step 1:** Full Rust check & tests

Run: `cd src-tauri && cargo check && cargo test --lib`
Expected: clean check, all tests pass (should include 9 new `token_usage::` tests).

- [ ] **Step 2:** Frontend typecheck

Run: `npx tsc --noEmit`
Expected: no diagnostics.

- [ ] **Step 3:** Dev run

Run: `npm run tauri dev` (or equivalent dev script if the project uses a different name — check `package.json` scripts first)
Expected: app launches, mascot overlay appears.

- [ ] **Step 4:** Smoke test — fresh session

1. Start a Claude Code session in any project (separate terminal: `cd some-project && claude`).
2. Issue a prompt that triggers at least one tool call.
3. After the first `PostToolUse`, confirm: a small panel appears next to the mascot showing `↓`, `↑`, `Σ` rows with non-zero `K` values.
4. Hover the panel. Confirm the tooltip appears showing the project name and four rows with full comma-separated numbers.

- [ ] **Step 5:** Smoke test — multi-session aggregate

1. Start a second Claude Code session in another project.
2. Run a prompt in both sessions. Confirm the panel's numbers roughly sum both sessions' contributions.
3. Hover the panel. Confirm the tooltip lists both sessions in separate blocks.

- [ ] **Step 6:** Smoke test — context menu toggle

1. Right-click the mascot. Confirm a "Tokens ● " row appears with an orange dot (enabled).
2. Click the Tokens row. Confirm the panel disappears and the dot becomes dim/hollow.
3. Click again. Confirm the panel re-appears.

- [ ] **Step 7:** Smoke test — settings

1. Open Dashboard → Settings. Scroll to "Token Panel".
2. Toggle `input` visibility on. Confirm the live overlay panel gains an `input` row.
3. Click the ▲ button on `input`. Confirm its position moves up in the live panel.
4. Change the font size slider in "Bubble Appearance". Confirm both the bubble preview and the token panel preview scale together, and the overlay panel also scales.
5. Toggle "Show token panel" off. Confirm the panel disappears and the ContextMenu toggle reflects the change.

- [ ] **Step 8:** Smoke test — session end

1. Stop one of the Claude Code sessions (Ctrl+C or exit).
2. Wait for `SessionEnd` hook. Confirm that session no longer appears in the hover tooltip and the panel's totals drop accordingly.

- [ ] **Step 9:** Commit any stray config/version bump if needed

If nothing needs committing:

```bash
git status
# should be clean
```

Otherwise commit the bump.

- [ ] **Step 10:** Final commit marker (optional)

If the plan introduced any late docstring or formatting fixes during smoke testing, commit them now with:

```bash
git commit -m "chore(token-panel): smoke-test cleanup"
```

---

## Remember
- Each task commits at the end. Do not batch commits across tasks.
- Run `cargo check` + `npx tsc --noEmit` before every commit.
- If a TDD step fails unexpectedly, fix the code — do not relax the test.
- Do not add features beyond the spec (no USD cost, no sparklines, no drag reorder).
