# Telegram Bot Integration — Design

**Date:** 2026-04-08
**Status:** Draft (pending review)
**Scope:** Phase 1 — Remote permission approval via Telegram bot

## Goal

Allow the user to approve, deny, or redirect Claude Code permission requests remotely through a Telegram bot, so they can keep sessions moving while away from the machine. The bot is a transport; decisions flow back through the existing `permission-store` resolution pipeline with no changes to the Claude Code hook contract.

## Non-goals (Phase 1)

- No general chat bridge between user and Claude Code (free-text chat always resolves an active permission).
- No multi-user, multi-chat support. Exactly one bot token, one chat id.
- No history / search of past permissions inside Telegram.
- No encryption at rest for the bot token (plaintext JSON in `app_data_dir`; migration to OS keyring deferred).
- No test coverage of the full poller loop end-to-end. Unit tests cover pure logic only.

## User-facing summary

1. User opens Dashboard → Settings → **Telegram** section, pastes bot token, pastes chat id, hits **Test** (optionally), hits **Save**, then flips **Enabled** on.
2. When Claude Code requests a permission, the bot sends a formatted message to the configured chat with three inline buttons: **Approve**, an optional suggestion button (e.g. "Auto-accept edits"), and **Deny**.
3. The user taps a button → the keyboard is removed and Claude Code receives the decision. Alternatively, the user types free text → Claude Code receives a deny with that text as feedback message.
4. Only one permission is "active" in Telegram at a time. Extra permissions queue up and surface one by one.
5. If the user resolves the permission locally (overlay bubble, hotkey) while Telegram is waiting, the Telegram message's keyboard is cleared and a follow-up message "✓ Đã xử lý ở máy local (Approved)" is posted.
6. A quick-toggle row appears in the mascot context menu to enable/disable polling without opening the Dashboard.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Rust backend (Tauri core, always alive)                        │
│                                                                 │
│  src-tauri/src/telegram/                                        │
│   ├─ mod.rs       — public API surface (TelegramManager)        │
│   ├─ config.rs    — load/save app_data_dir/telegram.json        │
│   ├─ client.rs    — reqwest wrapper (getMe, getUpdates,         │
│   │                 sendMessage, editMessageReplyMarkup,        │
│   │                 answerCallbackQuery)                        │
│   ├─ poller.rs    — tokio task: long-poll loop, controlled      │
│   │                 by watch::Sender<PollerCmd>                 │
│   ├─ state.rs     — QueueState (ActivePermission + VecDeque)    │
│   ├─ formatter.rs — builds HTML message body from AgentEvent    │
│   └─ types.rs     — DTOs (Update, CallbackQuery, InlineKeyboard)│
│                                                                 │
│  src-tauri/src/commands.rs (additions)                          │
│   telegram_get_config, telegram_save_config, telegram_test,     │
│   telegram_set_enabled, telegram_get_status                     │
│                                                                 │
│  src-tauri/src/server.rs (integration point)                    │
│   When a permission request arrives from the Claude Code hook,  │
│   after creating the PendingHttpRequest it also calls           │
│   telegram::push_permission(event, request_id).                 │
│                                                                 │
│  src-tauri/src/commands.rs::resolve_permission (integration)    │
│   After sending the HTTP response to the hook script, also      │
│   calls telegram::on_local_resolved(request_id, decision) to    │
│   keep the Telegram message in sync.                            │
└─────────────────────────────────────────────────────────────────┘
                              │ Tauri events
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (Solid, WebView)                                      │
│                                                                 │
│  src/stores/telegram-store.ts (new)                             │
│   Reactive { configured, enabled, error, bot_username }         │
│   Listens to "telegram://status-changed" and                    │
│                 "telegram://permission-response".               │
│   On permission-response, calls permissionStore.resolve().      │
│                                                                 │
│  src/components/dashboard/SettingsPanel.tsx (additions)         │
│   New "Telegram" section: toggle, token (password+eye),         │
│   Test button, chat id, Save button, inline status/error.       │
│                                                                 │
│  src/components/overlay/MascotOverlay.tsx (additions)           │
│   New MenuRow "Telegram" bound to telegramStore.status.         │
│                                                                 │
│  src/App.tsx                                                    │
│   Calls initTelegramStore() on mount.                           │
└─────────────────────────────────────────────────────────────────┘
```

## Why Rust backend instead of Node/Telegraf

The original request was to "use Telegraf for speed", but:

- **Telegraf is Node-only.** It depends on Node's `https` and `EventEmitter`. The Tauri WebView has no Node runtime, so importing it into Solid will not run.
- **Polling must outlive the Settings window.** The only long-lived process in this app is the Rust core. Running the bot in the frontend would make polling stop as soon as the user closed the Dashboard.
- **Bot API is tiny.** Only five endpoints are needed. Writing them on top of `reqwest` (already in Tauri's dependency graph) is ~150 lines of HTTP glue and beats adding a 50-dep `teloxide` or bundling a Node sidecar.

## Config schema & storage

Path: `<app_data_dir>/telegram.json`

```json
{
  "enabled": false,
  "bot_token": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
  "chat_id": "987654321"
}
```

- `chat_id` is a **string** so it can hold negative group chat ids like `-1001234567890`.
- Missing file → default `{ enabled: false, bot_token: "", chat_id: "" }`.
- **Atomic writes**: every save writes to `telegram.json.tmp` then renames over `telegram.json`. Prevents corrupted config on crash mid-save.
- Token is persisted in plaintext. Accepted trade-off for Phase 1; migration to OS keyring is a future task.
- The token is returned raw to the frontend; the Settings UI hides it behind a password field with an eye-toggle to reveal.

### In-memory status (Rust)

```rust
pub struct TelegramStatus {
    pub configured: bool,       // both bot_token and chat_id are non-empty
    pub enabled: bool,          // poller task is currently running
    pub error: Option<String>,  // last fatal error (e.g. "Invalid bot token")
    pub bot_username: Option<String>, // cached from last successful getMe
}
```

`bot_token` is never serialized into this struct or into `telegram://status-changed` events.

## Tauri commands

```rust
#[tauri::command]
async fn telegram_get_config() -> Result<TelegramConfigDto, String>;
// TelegramConfigDto { bot_token: String, chat_id: String }

#[tauri::command]
async fn telegram_save_config(token: String, chat_id: String) -> Result<(), String>;
// Persists config. Side effects:
//   - Always clears status.error (saving is treated as user acknowledging the error).
//   - If the stored enabled flag is still true and the new config is `configured`,
//     (re)starts the poller. This covers the "fatal error → fix token → Save" case:
//     the fatal error sets status.error but the poller task is down; Save restarts it.
//     NOTE: the fatal-error branch does NOT persist enabled=false; it only sets the
//     in-memory status.error and stops the running task. The persisted enabled flag
//     is preserved so Save can resume polling. (This reverses the earlier note — see
//     "Error classification" below.)
//   - If poller is running and config changed, restart it (drops in-flight Telegram state).

#[tauri::command]
async fn telegram_test(
    token: String,
    chat_id: Option<String>,
) -> Result<TelegramTestResult, String>;
// Does NOT persist. Calls getMe. If chat_id is Some and non-empty,
// additionally calls sendMessage with a canned test body.
// TelegramTestResult { bot_username, bot_first_name, chat_tested: bool }

#[tauri::command]
async fn telegram_set_enabled(enabled: bool) -> Result<(), String>;
// Rejects with "Not configured" if enabled=true and !configured.
// Otherwise: starts or stops the poller, persists flag to config file.

#[tauri::command]
async fn telegram_get_status() -> Result<TelegramStatus, String>;
```

## Events emitted to the frontend

### `telegram://status-changed`

Payload: `TelegramStatus`.

Emitted whenever any field in `TelegramStatus` changes (enable toggled, error cleared, error set, reconnect succeeds, etc.). The frontend store simply replaces its local copy.

### `telegram://permission-response`

Payload:

```ts
{
  request_id: string;
  decision: "allow" | "deny";
  suggestion?: PermissionSuggestion; // when user tapped the suggestion button
  feedback_text?: string;            // when user sent a free-text reply
}
```

The frontend telegram-store listens and calls `permissionStore.resolve(id, decision, s)`. When `feedback_text` is set, it is wrapped as `{ type: "feedback", reason: feedback_text }` so the existing pipeline in [permission-store.ts:140-170](../../../src/stores/permission-store.ts#L140-L170) maps it to `hookDecision.message`.

**Contract invariant:** `suggestion` and `feedback_text` are **mutually exclusive**. The Rust side emits exactly one or neither:
- Callback button `allow_suggestion` → `suggestion` set, `feedback_text` absent.
- Callback buttons `approve` / `deny` → both absent.
- Free-text message → `feedback_text` set, `suggestion` absent, `decision = "deny"`.

The frontend may assume this and does not handle the "both set" case.

## Data flow — four permission cases

### Case 1: New permission arrives while Telegram is idle

1. Claude Code hook → existing Rust `server.rs` creates `PendingHttpRequest` and emits the event to the frontend (unchanged).
2. `server.rs` additionally calls `telegram::push_permission(event, request_id)`.
3. Inside `push_permission`:
   - If `!enabled` → drop silently (permissions still work on local overlay).
   - If `active.is_some()` → append to `queue`.
   - Else → `send_now(event, request_id)`.
4. `send_now`:
   - Build HTML via `formatter::build_html(event)`.
   - Build inline keyboard (2 or 3 buttons, see next section).
   - `client.send_message(chat_id, html, Some(keyboard))` → get `message_id`.
   - Set `state.active = Some(ActivePermission { request_id, message_id, suggestion: picked_suggestion })`.

### Case 2: User taps an inline button

1. Poller receives `Update { callback_query: { id, from, message, data } }`.
2. Verify `from.id.to_string() == config.chat_id`. If not, call `answerCallbackQuery(id, "Unauthorized")` and return.
3. Parse `data`:
   - `"approve"` → decision `allow`, suggestion `None`.
   - `"allow_suggestion"` → decision `allow`, suggestion `state.active.suggestion.clone()`.
   - `"deny"` → decision `deny`, suggestion `None`.
4. Call `answerCallbackQuery(id, toast_text)` for the Telegram toast. Mapping:

   | `callback_data`    | `toast_text`                |
   | ------------------ | --------------------------- |
   | `approve`          | `"✓ Approved"`              |
   | `allow_suggestion` | `"⚡ Applied suggestion"`   |
   | `deny`             | `"✗ Denied"`                |
5. `client.edit_message_reply_markup(chat_id, message_id, None)` to clear the inline keyboard on the original message.
6. Emit `telegram://permission-response { request_id: active.request_id, decision, suggestion }`.
7. Clear `state.active`. If `queue.pop_front()` returns a queued permission, call `send_now` for it.

### Case 3: User sends free text

1. Poller receives `Update { message: { text, from, chat } }` where `text` is plain text (not a callback).
2. Verify `chat.id.to_string() == config.chat_id`. Otherwise ignore entirely (no reply at all — this protects against spam).
3. If `state.active.is_none()` → `client.send_message(chat_id, "Hiện không có request nào đang chờ", None)` and return.
4. Otherwise:
   - `client.edit_message_reply_markup(chat_id, active.message_id, None)` to clear the keyboard on the active perm's message.
   - Emit `telegram://permission-response { request_id: active.request_id, decision: "deny", feedback_text: text }`.
   - Clear `state.active`, pop queue if any.

Non-text messages (stickers, photos, voice, commands like `/start`) are ignored silently. Phase 1 does not attempt to handle them.

### Case 4: Permission resolved locally (overlay, hotkey, dismiss, timeout)

1. Frontend calls `permissionStore.resolve(id, decision)`, which invokes Rust command `resolve_permission(request_id, decision)`.
2. Existing Rust logic sends the HTTP response back to the hook script.
3. **New:** after sending the HTTP response, Rust calls `telegram::on_local_resolved(request_id, decision)`.
4. `on_local_resolved`:
   - If `state.active.as_ref().map(|a| &a.request_id) == Some(&req_id)`:
     - Spawn a detached task (do not block the caller):
       - `client.edit_message_reply_markup(chat_id, msg_id, None)`
       - `client.send_message(chat_id, format!("✓ Đã xử lý ở máy local ({})", pretty(decision)), None)`
     - Clear `state.active`, pop queue if any.
   - Else: `queue.retain(|q| q.request_id != req_id)` (silent drop; no Telegram message was ever sent for it).

This covers all existing dismiss paths (`dismissByRequestId`, `dismissForAgent`, `dismissByToolUseId`, `dismissIfCliAccepted`) because they all end up calling `resolve_permission` on the backend.

## Inline keyboard shape

```rust
// Zero suggestions on the event
[
  [{ text: "✅ Approve", callback_data: "approve" }],
  [{ text: "❌ Deny",    callback_data: "deny"    }],
]

// One or more suggestions — use suggestions[0]
[
  [{ text: "✅ Approve",                          callback_data: "approve"          }],
  [{ text: format!("⚡ {}", display_label_for(&suggestions[0])), callback_data: "allow_suggestion" }],
  [{ text: "❌ Deny",                             callback_data: "deny"             }],
]
```

- Each button is its own row ("mỗi nút 1 dòng").
- `callback_data` is a fixed short string; the `request_id` is not embedded because only one permission is active at a time and the state lookup keeps it under the 64-byte API limit.
- `state.active.suggestion` caches `suggestions[0]` at `send_now` time so the callback handler can emit it back to the frontend.
- **`display_label_for(&suggestion)`** is a Rust port of the label-building logic in [permission.ts:21-59](../../../src/models/permission.ts#L21-L59). The Rust side receives raw `permission_suggestions` from the Claude hook event (camelCase fields: `type`, `rules`, `mode`, `destination`, `behavior`, `ruleContent`, `toolName`) and builds the display label itself. When forwarding the suggestion back to the frontend via `telegram://permission-response`, Rust emits the **raw** suggestion object (not the computed label) so the frontend's existing `parsePermissionSuggestions` path can consume it unchanged.

## Message format

Parse mode: **HTML**.

```html
📁 <b>{project_folder}</b>
🔧 <b>{tool_name}</b>
{tool_body}
<i>💬 Chat để bảo tôi làm gì khác</i>
```

**`project_folder`** — from `event.cwd` if present, otherwise `basename(process.cwd())`. The `transcript_path` parse is not used in Phase 1 to keep things simple.

**`tool_body`** by tool name:

| Tool      | Body                                                                   |
| --------- | ---------------------------------------------------------------------- |
| `Bash`    | `<pre>{command, escaped, truncated to first 100 chars with ellipsis}</pre>` |
| `Edit`    | `Edit: <code>{file_path}</code>`                                       |
| `Write`   | `Write: <code>{file_path}</code>`                                      |
| `Read`    | `Read: <code>{file_path}</code>`                                       |
| `Grep`    | `Grep: <code>{pattern}</code>`                                         |
| `Glob`    | `Glob: <code>{pattern}</code>`                                         |
| _default_ | `<code>{tool_name}</code> <code>{JSON.stringify(input).slice(0,100)}</code>` |

HTML-sensitive characters (`<`, `>`, `&`) in user-supplied strings must be escaped. The formatter has a helper `html_escape(&str) -> String` used for every interpolation.

## Poller state machine

```
        ┌──────────┐
        │ Stopped  │ ◄─── initial, OR set_enabled(false), OR fatal error
        └────┬─────┘
             │ set_enabled(true) && configured
             ▼
        ┌──────────┐
   ┌──► │ Running  │ ◄──┐
   │    └────┬─────┘    │
   │         │ network / 5xx / 409
   │         ▼          │
   │    ┌────────────┐  │ getUpdates OK
   │    │Reconnecting│──┘
   │    └────┬───────┘
   │         │ 401 / fatal
   │         ▼
   │    ┌────────┐  emit status-changed { error } + desktop notification
   │    │ Error  │
   │    └────┬───┘
   │         │ task stops; persisted `enabled` flag is preserved
   │         │ so a later save_config can resume polling
   │         ▼
   │    ┌──────────┐
   └─── │ Stopped  │
        └──────────┘
```

### Error classification & retry

| Error from `getUpdates`        | Handling                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Network / timeout / 5xx        | Enter Reconnecting, backoff 1s → 2s → 5s → 10s (capped). Status emitted on transition. No user action needed.  |
| 401 Unauthorized               | Fatal. Stop poller task, set `status.error = "Invalid bot token"`, fire desktop notification. **Do not persist `enabled=false`** — the persisted flag stays `true` so that `save_config` with a fixed token can transparently resume polling. |
| 409 Conflict                   | Log warning, sleep 5s, retry. Usually clears itself when the conflicting instance stops.                       |
| 429 Too Many Requests          | Sleep for `retry_after` seconds from the response body, then retry. Stay in Running state.                     |

### sendMessage errors (during `push_permission`)

- Retry up to 2 times with 1s and 3s delays.
- If all retries fail: log error, drop the Telegram attempt, fire an in-app notification "Không gửi được Telegram". The permission is still alive in the local overlay; behavior from the user's POV is "Telegram silently missed this one".

### Control channel

```rust
enum PollerCmd {
    Stop,
    ConfigChanged,
}

struct TelegramManager {
    config: Arc<RwLock<TelegramConfig>>,
    status: Arc<RwLock<TelegramStatus>>,
    state:  Arc<Mutex<QueueState>>,
    tx:     Option<watch::Sender<PollerCmd>>, // Some iff poller running
    app:    AppHandle,
}
```

The poller task owns a `watch::Receiver<PollerCmd>` and checks it inside a `tokio::select!` alongside the `get_updates` future.

## Lifecycle hooks

- **App startup**: `telegram::init(app)` reads the config file; if `enabled && configured`, spawns the poller.
- **`save_config` with changes**: if the poller is running, send `ConfigChanged` → loop breaks → manager respawns it with the new config. **The active permission and queue are dropped** because the old `message_id` belongs to the old bot/chat. Permissions still pending in the frontend overlay remain visible and functional; only the Telegram side is reset. The next new permission starts a fresh flow.
- **`set_enabled(false)`**: send `Stop`, clear active + queue silently, emit status. No "cancelled" messages are posted to Telegram (the user explicitly turned it off).
- **`set_enabled(true)` first time while perms are already pending in frontend**: those existing perms are **not** backfilled into Telegram. Only perms arriving after enable are pushed. Accepted trade-off — backfill would require caching raw `AgentEvent`s in Rust and adding a replay path.
- **App quit**: Tauri shutdown hook → `manager.shutdown()` → `Stop`. Poller breaks gracefully within at most one long-poll timeout (30s). Not awaited — task is detached so shutdown is not blocked.

## Frontend changes in detail

### `src/stores/telegram-store.ts` (new)

```ts
import { createStore } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { permissionStore } from "./permission-store";

interface TelegramStatus {
  configured: boolean;
  enabled: boolean;
  error: string | null;
  bot_username: string | null;
}

const [status, setStatus] = createStore<TelegramStatus>({
  configured: false,
  enabled: false,
  error: null,
  bot_username: null,
});

export async function initTelegramStore(): Promise<void> {
  setStatus(await invoke("telegram_get_status"));

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
    const payloadSuggestion = feedback_text
      ? { type: "feedback", reason: feedback_text }
      : suggestion;
    permissionStore.resolve(request_id, decision, payloadSuggestion);
  });
}

export const telegramStore = {
  get status() { return status; },

  async saveConfig(token: string, chatId: string) {
    await invoke("telegram_save_config", { token, chatId });
    setStatus(await invoke("telegram_get_status"));
  },

  async test(token: string, chatId: string | null) {
    return invoke<{ bot_username: string; bot_first_name: string; chat_tested: boolean }>(
      "telegram_test",
      { token, chatId },
    );
  },

  async setEnabled(enabled: boolean) {
    await invoke("telegram_set_enabled", { enabled });
    setStatus(await invoke("telegram_get_status"));
  },

  async getConfig() {
    return invoke<{ bot_token: string; chat_id: string }>("telegram_get_config");
  },
};
```

`initTelegramStore()` is called from `App.tsx` on mount, parallel to existing store init.

### `SettingsPanel.tsx` — new Telegram section

Placed after existing sections, before any "Danger Zone" region if present.

Layout sketch:

```
┌─ Telegram Bot ────────────────────────────────────────────┐
│  [toggle: Enabled]   ●──  (disabled if !configured        │
│                           || hasUnsavedChanges)           │
│                                                           │
│  Bot token                                                │
│  [••••••••••••••••••••••••••••]  [👁]                     │
│                                                           │
│  Chat ID                                                  │
│  [987654321                     ]                         │
│                                                           │
│  [Test]  → "✓ Bot: @my_bot (Masko) · test message sent"  │
│           (red on failure: "✗ Invalid token")             │
│                                                           │
│  [Save]  → in-app toast "Telegram config đã lưu"          │
│                                                           │
│  <Show when={status.error}>                               │
│    ⚠️ {status.error}                                       │
│  </Show>                                                  │
└───────────────────────────────────────────────────────────┘
```

- `hasUnsavedChanges` is a local signal comparing `(token, chatId)` against the snapshot taken from `getConfig()` (or the values last passed to Save). When true, the Enable toggle is disabled and the Save button is highlighted.
- The token input uses `type="password"`; the eye toggle swaps it to `type="text"`.
- **Test button**: calls `telegramStore.test()`. Shows a loading spinner inside the button, displays the result inline below the button for ~5 seconds, then fades.
- **Save button**: calls `saveConfig`. On success, fires an **in-app notification** (via the existing `notification-store`).
- **Enable toggle** `onChange`: calls `setEnabled(v)`. If it rejects (e.g. `"Not configured"`), revert the toggle and show an error toast.

### `MascotOverlay.tsx` ContextMenu — new row

Inserted between existing rows "Flip" and "Open Dashboard".

```tsx
<MenuRow
  label={telegramRowLabel()}
  icon={telegramRowIcon()}
  onClick={handleTelegramClick}
/>
```

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

const handleTelegramClick = async () => {
  props.onClose();
  const s = telegramStore.status;
  if (!s.configured || s.error) {
    const win = await WebviewWindow.getByLabel("main");
    await win?.show();
    await win?.setFocus();
    return;
  }
  await telegramStore.setEnabled(!s.enabled);
};
```

Scrolling the Dashboard to the Telegram section is **not** implemented in Phase 1 — opening the window is enough for the user to find it.

## Notification routing

- **Save success**: in-app notification via existing `notification-store`. Low importance, no OS interruption.
- **Poller fatal error (Invalid token, etc.)**: OS-level notification via `@tauri-apps/plugin-notification` with title "Telegram Bot" and body "Polling dừng: Invalid bot token. Mở Settings để kiểm tra." The user may not have the Dashboard open when this happens.
- **sendMessage failure during push**: in-app notification only, brief text.

## Security considerations

1. **Chat id allowlist**: the poller only acts on updates whose `from.id` (callback) or `chat.id` (message) matches the configured `chat_id`. Updates from any other chat/user are ignored silently — never answered, never logged except at debug level. This prevents anyone who knows the bot username from interacting with it.
2. **No token leakage in events**: `TelegramStatus` emitted to the frontend never contains `bot_token`. Only `telegram_get_config` returns it (explicit user action in the Settings panel).
3. **Plaintext token on disk**: accepted for Phase 1. Windows `app_data_dir` is per-user; any process running as the same user can read it. Not worse than e.g. Discord's token storage. Documented so the decision is explicit.
4. **Free-text semantics are destructive**: user's text becomes a `deny` + feedback to Claude Code. A typo or accidental message can abort a command. This is by design — the user explicitly enabled Telegram control knowing each message has consequences. The note "💬 Chat để bảo tôi làm gì khác" in the message body reminds them.
5. **Suggestion replay trust**: the callback handler uses the suggestion cached in `state.active.suggestion` — it does **not** trust any data from the callback payload beyond `"approve" / "deny" / "allow_suggestion"`. An attacker with access to the chat cannot craft a suggestion.

## Testing strategy

This project currently has no test infrastructure. The strategy is pragmatic: unit-test pure logic, rely on a documented manual checklist for integration.

### Rust unit tests

Under `src-tauri/src/telegram/**.rs`, gated with `#[cfg(test)]`:

- **`formatter::build_html`**
  - Bash command longer than 100 chars is truncated with ellipsis.
  - HTML-sensitive characters in Bash input are escaped.
  - Edit/Write/Read/Grep/Glob produce the table-specified output.
  - Unknown tool name falls through to the generic JSON stringify branch.
- **`state::QueueState`**
  - `push` while idle sets active, keeps queue empty.
  - `push` while busy leaves active untouched and appends to queue.
  - `resolve_active` pops one from the queue into active when available.
  - `remove_by_request_id` for a queued (non-active) id clears it from the queue.
  - `remove_by_request_id` for the active id clears active and promotes the next queued entry.
- **`config::TelegramConfig::is_configured`**
  - Empty token or empty chat_id → false.
  - Both non-empty → true.
- **HTTP error classification** — a pure function `classify(status, body) -> PollError`:
  - 401 → Unauthorized
  - 409 → Conflict
  - 429 with `retry_after: 5` → TooManyRequests(5)
  - 500-599 → Server
  - Transport error → Network

The poller loop itself is **not** unit-tested (would require mocking tokio time + HTTP, not worth it for Phase 1).

### Manual test checklist

**Setup**

1. Create a bot via @BotFather, copy the token.
2. Get the chat id via @userinfobot (or any helper bot).
3. Open Dashboard → Settings → Telegram.

**Config panel**

- [ ] With both fields empty, Enable toggle is disabled.
- [ ] Type token, press Test → bot info (username, first name) appears inline.
- [ ] Type a deliberately wrong token, press Test → red error inline.
- [ ] Type valid token + chat id, press Test → a test message arrives in the chat.
- [ ] Press Save → in-app success toast.
- [ ] Enable toggle is now clickable. Flip it on → mascot menu icon flips to ●.

**Permission flow — happy path**

- [ ] In another project, run Claude Code and trigger a Bash permission.
- [ ] The Telegram message appears with: project folder, 🔧 Bash, `<pre>command</pre>`, italic note, and three inline buttons.
- [ ] Tap Approve → keyboard disappears, Claude Code proceeds.
- [ ] Trigger another, tap Deny → Claude Code reports denial.
- [ ] Trigger another with a suggestion available → suggestion button visible, tap it → Claude Code applies the suggestion.

**Free-text chat**

- [ ] With an active perm, send text "chạy build thay vì test" → keyboard clears, Claude Code receives deny + that text as feedback message.
- [ ] With no active perm, send any text → bot replies "Hiện không có request nào đang chờ".

**Queue**

- [ ] Trigger three permissions in quick succession. Only the first shows in Telegram.
- [ ] Resolve the first on Telegram → the second appears immediately.
- [ ] Resolve the second on the local overlay → Telegram posts "✓ Đã xử lý ở máy local (...)" and the third appears.

**Local ↔ Telegram sync**

- [ ] Push a permission to Telegram, then approve it on the overlay bubble → Telegram: keyboard cleared, follow-up message "✓ Đã xử lý ở máy local (Approved)".
- [ ] Same with Deny.
- [ ] Trigger a dismiss (session end / CLI accepted) while Telegram has an active perm → Telegram reflects the local resolution.

**Error handling**

- [ ] While enabled, pull the network. Status transitions to Reconnecting (verify via mascot menu or Dashboard status). Plug back in → auto-resumes.
- [ ] Revoke the token via @BotFather. Within ~30s the poller should stop, mascot icon → ⚠️, and an OS notification appears.
- [ ] Fix the token, Save → polling restarts without manual enable toggling (save-triggered restart).

**Context menu quick toggle**

- [ ] Right-click mascot. Row label reflects current state.
- [ ] Click when Off → turns On.
- [ ] Click when On → turns Off.
- [ ] Click when Not configured → Dashboard window opens and focuses.
- [ ] Click when Error → Dashboard window opens and focuses.

**Security**

- [ ] From a second Telegram account that knows the bot username, DM the bot → no reply of any kind (verify Rust logs show update ignored).

**Lifecycle**

- [ ] Enable, quit app, relaunch → polling auto-starts.
- [ ] Disable, quit app, relaunch → polling does not start.

### Out of scope for tests (YAGNI)

- No live Telegram integration test (flaky, rate limits, secrets).
- No mocked Tauri IPC layer.
- No E2E browser test.

## Open questions / future work

- **Keyring migration** for the bot token.
- **Multi-chat support**: send permissions to several chats, accept decisions from any, first-resolved wins.
- **Backfill**: push currently-pending perms into Telegram when enabling for the first time.
- **Rich formatting for non-Bash tools**: show file diffs, previews.
- **Timeout on Telegram message**: auto-deny if the user doesn't respond in N minutes (needs separate design — interacts with queue).
- **General chat bridge**: free-text messages outside a permission context, routed to Claude as a prompt.
