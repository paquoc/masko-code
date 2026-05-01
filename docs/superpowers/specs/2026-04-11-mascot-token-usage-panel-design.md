# Mascot Token Usage Panel — Design

**Date:** 2026-04-11
**Status:** Draft (pending review)
**Scope:** Display cumulative per-session Claude Code token usage as a panel next to the mascot overlay, with configurable metrics and a hover tooltip breakdown.

## Goal

Surface the token cost of running Claude Code sessions in real time as a compact panel anchored to the mascot overlay. The panel aggregates token counts across every active session, refreshes incrementally on every `PostToolUse` / `Stop` hook event, and exposes a configurable list of computed metrics (read, write, total, plus the four raw fields) so the user can decide what they want to see and in what order.

## Non-goals

- No billing/currency conversion. Numbers are raw token counts; cost in dollars is out of scope.
- No historical charts or time-series. The panel shows the current cumulative total, not a trend.
- No per-model breakdown. If a session switches models mid-stream, all usage is still summed together.
- No support for Codex / non-Claude-Code sessions. Token parsing targets the Claude Code JSONL transcript format only.
- No editing or trimming the transcript. Masko is strictly read-only against the JSONL file.
- No persistence of token totals across app restarts. On startup, totals are rebuilt by re-parsing transcripts from offset 0 for currently active sessions.

## User-facing summary

1. A Claude Code session runs in any project. Hooks are installed, so Masko sees every `SessionStart`, `PostToolUse`, `Stop`, etc.
2. Next to the mascot, a small panel appears on the side opposite the `WorkingBubble` (or on a free side if the bubble is hidden). Each enabled metric is rendered as one line, e.g.:
   ```
   ↓ 12.3K
   ↑  8.7K
   Σ 21.0K
   ```
3. Numbers update automatically after every tool call completion and session stop. Numbers are cumulative: they include every assistant turn in the transcript from the beginning of the session.
4. Hovering the panel opens a tooltip listing every active session separately, with its project name and all four raw fields (`input`, `output`, `cache read`, `cache create`) shown with full comma-separated numbers.
5. Clicking the panel is a no-op. Right-clicking the mascot opens the existing context menu, which now has a **Tokens** toggle row that enables/disables the panel globally.
6. Dashboard → Settings gains a **Token Panel** section where the user picks which metrics are visible and reorders them. The existing font-size / color controls for the working bubble also apply to the token panel (shared `appearance` struct). The settings preview area renders a mock token panel alongside the existing bubble preview so style changes are visible immediately.

## Core terminology

Given a Claude Code assistant message's `message.usage` object with fields `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, the user-visible **computed metrics** are:

| Metric key       | Formula                                              |
|------------------|------------------------------------------------------|
| `read`           | `input + cache_read`                                 |
| `write`          | `output + cache_creation`                            |
| `total`          | `input + output + cache_read + cache_creation`       |
| `input`          | `input_tokens` (raw)                                 |
| `output`         | `output_tokens` (raw)                                |
| `cache_read`     | `cache_read_input_tokens` (raw)                      |
| `cache_creation` | `cache_creation_input_tokens` (raw)                  |

**Cumulative** means the sum of each raw field across every assistant message with a `usage` object in the JSONL, from the first line to the last. The computed metrics (read/write/total) are then derived from the cumulative raw totals. Note: because Claude Code re-sends the full conversation context every turn, cumulative `input_tokens` double-counts context. This is intentional — the number reflects total tokens billed by the API, which is what the user wants to track.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Rust backend (src-tauri/src/token_usage/mod.rs)  [NEW]         │
│                                                                 │
│  struct TokenUsageState {                                       │
│      sessions: Mutex<HashMap<String, SessionParseState>>,       │
│  }                                                              │
│  struct SessionParseState {                                     │
│      path: PathBuf,                                             │
│      offset: u64,                                               │
│      mtime: SystemTime,                                         │
│      totals: RawUsage,                                          │
│  }                                                              │
│  struct RawUsage { input, output, cache_read, cache_creation }  │
│                                                                 │
│  Tauri commands:                                                │
│    get_session_token_usage(session_id, transcript_path)         │
│      -> RawUsage                                                │
│    reset_session_token_usage(session_id)                        │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ invoke (overlay webview only)
                              │
┌─────────────────────────────────────────────────────────────────┐
│  Overlay webview (src/overlay-entry.tsx)                        │
│                                                                 │
│  src/stores/token-usage-store.ts   [NEW]                        │
│    bySession: Record<sessionId, SessionTokenUsage>              │
│    pathCache: Record<sessionId, string>  // fallback path memo  │
│    refreshSession(sessionId, path, projectName)                 │
│    removeSession(sessionId)                                     │
│    aggregate() -> RawUsage                                      │
│    computed(metric) -> number                                   │
│    sessions -> SessionTokenUsage[]                              │
│                                                                 │
│  src/components/overlay/TokenPanel.tsx   [NEW]                  │
│    Renders ordered metric rows from working-bubble settings     │
│    Hover → tooltip component showing per-session raw breakdown  │
│                                                                 │
│  src/components/overlay/MascotOverlay.tsx   [MODIFIED]          │
│    hook-event listener: dispatch tokenUsageStore.refreshSession │
│      on SessionStart/PostToolUse/PostToolUseFailure/Stop        │
│    hook-event listener: dispatch removeSession on SessionEnd    │
│    Render <TokenPanel> inside the overlay root                  │
│    ContextMenu: add Tokens toggle row                           │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Tauri event: bubble-settings-changed
                              │
┌─────────────────────────────────────────────────────────────────┐
│  Main webview (src/App.tsx → dashboard)                         │
│                                                                 │
│  src/stores/working-bubble-store.ts   [EXTENDED]                │
│    WorkingBubbleSettings {                                      │
│      ...existing...                                             │
│      tokenPanel: TokenPanelSettings                             │
│    }                                                            │
│    TokenPanelSettings {                                         │
│      enabled: boolean                                           │
│      order: TokenMetricKey[]                                    │
│      visible: Record<TokenMetricKey, boolean>                   │
│    }                                                            │
│                                                                 │
│  src/components/dashboard/SettingsPanel.tsx   [MODIFIED]        │
│    New "Token Panel" section with metric list + reorder         │
│    Preview area mounts a mock TokenPanel alongside the bubble   │
└─────────────────────────────────────────────────────────────────┘
```

### Why overlay owns the store

Masko runs two Tauri webviews: `main` (dashboard) and `overlay` (mascot). Each webview listens to `hook-event` independently (see `src/services/ipc.ts` for main, `MascotOverlay.tsx:616` for overlay) and maintains its own store instances — Solid stores are not shared across webview processes.

Because the token panel is rendered on the overlay, the store must live in the overlay webview. The event-processor in `src/services/event-processor.ts` (which runs only in main) is **not** modified. Integration happens in the overlay's existing `hook-event` listener.

### Why event-driven + incremental (not polling, not full re-scan)

Hooks fire on every `PostToolUse`, which gives us a natural refresh signal. Polling would waste I/O during idle moments; a file watcher (e.g. `notify` crate) would be real-time but requires extra lifecycle plumbing that doesn't buy much over event-driven. Full re-scan on every refresh is simple but becomes wasteful on multi-MB transcripts — sessions can produce tens of megabytes after a long day. The incremental approach stores a per-session `(offset, totals, mtime)` tuple in Rust and only reads the new bytes appended since the last call.

## Rust module: `token_usage`

### Module layout

```
src-tauri/src/token_usage/
  mod.rs            — public types, state, Tauri commands
```

One file is fine; this module is small (~200 lines).

### `SessionParseState` invariants

- `offset` is always at a line boundary (end of a `\n`-terminated line), except when the file ends in a partial line — in that case `offset` points at the start of the partial line.
- `totals` is the running sum of every raw field across every assistant message parsed so far.
- `mtime` is the last observed `fs::Metadata::modified()` value. Used only to detect file replacement/truncation, not incremental updates.

### `get_session_token_usage(session_id, transcript_path)` algorithm

```
1. state = self.sessions.lock()
2. meta = fs::metadata(transcript_path).ok()
   if meta is None: return RawUsage::default()  // file not written yet
3. entry = state.entry(session_id).or_insert_with(|| fresh(transcript_path, meta))
4. if entry.path != transcript_path
      OR file_len < entry.offset:   // truncated or rotated
      reset entry (offset=0, totals=zero, mtime=meta.modified())
   else:
      entry.mtime = meta.modified()  // bump even if unchanged
5. file = File::open(transcript_path)
   file.seek(SeekFrom::Start(entry.offset))
   reader = BufReader::new(file)
6. loop:
     let mut line = String::new()
     let start_pos = entry.offset
     let n = reader.read_line(&mut line)?
     if n == 0: break
     if !line.ends_with('\n'):
         // partial line — rewind by n bytes, stop
         break
     entry.offset += n as u64
     parse_usage_into(&line, &mut entry.totals)
     (parse errors are logged and skipped; line is still advanced)
7. return entry.totals
```

### `parse_usage_into(line, totals)`

- `serde_json::from_str::<Value>(line)` — if parse fails, log warning, return.
- Extract `message.usage` as object; if missing, return (user messages, tool results, etc.).
- Read `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` as `u64`, defaulting to 0 for missing/non-number values.
- Add into `totals.input`, `totals.output`, `totals.cache_read`, `totals.cache_creation` using saturating addition.

### `reset_session_token_usage(session_id)`

Removes the entry from the HashMap. Called from the frontend on `SessionEnd`. Not strictly required for correctness (stale entries are fine), but prevents unbounded growth over long-running masko instances that see thousands of sessions.

### State wiring

`TokenUsageState` is registered via `.manage()` in `src-tauri/src/main.rs` (or `lib.rs`, wherever other state is set up). The two commands are added to the `invoke_handler![]` list.

### Error handling

Commands return `Result<RawUsage, String>`. The frontend tolerates errors by leaving the previous value in place. File-not-found is not an error (returns zeros).

### Thread safety

Single `Mutex<HashMap>` is sufficient — refresh calls are rare (one per hook event) and hold the lock only for the parse duration (tens of milliseconds worst case). No contention expected.

## Frontend: `token-usage-store`

### Types

```ts
export type TokenMetricKey =
  | "read" | "write" | "total"
  | "input" | "output" | "cache_read" | "cache_creation";

export interface RawUsage {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
}

export interface SessionTokenUsage extends RawUsage {
  sessionId: string;
  projectName: string;
}
```

### Store shape

```ts
const [state, setState] = createStore<{
  bySession: Record<string, SessionTokenUsage>;
  pathCache: Record<string, string>;  // sessionId → last-known transcript_path
}>({ bySession: {}, pathCache: {} });
```

### `refreshSession(sessionId, transcriptPath?, projectName?)`

- If `transcriptPath` is provided, store it in `pathCache` and use it for this call.
- Otherwise, fall back to `pathCache[sessionId]`. If still unknown, no-op.
- `invoke<RawUsage>("get_session_token_usage", { sessionId, transcriptPath })`
- On success, write `{ sessionId, projectName: projectName ?? prev?.projectName ?? "", ...raw }` into `bySession[sessionId]`.
- On failure, log and leave previous entry untouched.

### `removeSession(sessionId)`

- `invoke("reset_session_token_usage", { sessionId })` (fire-and-forget).
- Delete from `bySession` and `pathCache`.

### `aggregate()`

Reactive getter that sums all four raw fields across `Object.values(bySession)`. Returns `{ input, output, cache_read, cache_creation }`.

### `computed(metricKey): number`

Given the aggregate, returns the value for the requested metric using the formula table above.

### `sessions` (reactive getter)

Returns `Object.values(bySession)` sorted by some stable key (e.g. `sessionId`) for consistent tooltip ordering.

### Integration in `MascotOverlay.tsx`

In the existing `hook-event` listener block starting around line 616, after the `switch` that updates state-machine inputs, insert:

```ts
// Token usage refresh
if (event.session_id) {
  const projectName = event.cwd
    ? event.cwd.replace(/\\/g, "/").split("/").pop() || ""
    : "";
  switch (eventType) {
    case HookEventType.SessionStart:
    case HookEventType.PostToolUse:
    case HookEventType.PostToolUseFailure:
    case HookEventType.Stop:
      if (event.transcript_path) {
        tokenUsageStore.refreshSession(event.session_id, event.transcript_path, projectName);
      } else {
        tokenUsageStore.refreshSession(event.session_id, undefined, projectName);
      }
      break;
    case HookEventType.SessionEnd:
      tokenUsageStore.removeSession(event.session_id);
      break;
  }
}
```

## `TokenPanel` component

### File: `src/components/overlay/TokenPanel.tsx`

### Props

```ts
interface TokenPanelProps {
  appearance: BubbleAppearance;  // from working-bubble-store.settings
  tokenSettings: TokenPanelSettings;
  anchorSide: "left" | "right" | "top" | "bottom";
  anchorX: number;
  anchorY: number;
}
```

### Visibility rules

The component returns `null` if any of:
- `tokenSettings.enabled === false`
- All entries in `bySession` have every raw field equal to 0 (nothing meaningful to show yet)
- `tokenSettings.order.filter(k => tokenSettings.visible[k]).length === 0` (no metric enabled)

An enabled metric whose computed value is 0 while other metrics are non-zero is still rendered (e.g. `→ 0`). Zero rows are only suppressed by the "all-zero" panel-level visibility rule above.

### Metric row rendering

For each metric key in `order` where `visible[k] === true`, render one row:

| Metric key       | Icon | Label shown in panel |
|------------------|------|----------------------|
| `read`           | `↓`  | `↓ 12.3K`            |
| `write`          | `↑`  | `↑ 8.7K`             |
| `total`          | `Σ`  | `Σ 21.0K`            |
| `input`          | `→`  | `→ 1.2K`             |
| `output`         | `←`  | `← 345`              |
| `cache_read`     | `⇣`  | `⇣ 45.6K`            |
| `cache_creation` | `⇡`  | `⇡ 2.1K`             |

### Number formatting

```
format(n):
  if n < 1_000:          return n.toString()                    // 123
  if n < 1_000_000:      return (n/1_000).toFixed(1) + "K"      // 12.3K
  if n < 1_000_000_000:  return (n/1_000_000).toFixed(1) + "M"  // 1.2M
  else:                  return (n/1_000_000_000).toFixed(1) + "B"
```

Tooltip uses `n.toLocaleString("en-US")` to get comma-separated full digits.

### Styling

Shared with `WorkingBubble`:
- Background: `appearance.bgColor`
- Text: `appearance.textColor`
- Muted: `appearance.mutedColor` (for icons)
- Font size: `appearance.fontSize` (px)

Padding, radius, shadow match `WorkingBubble` for visual consistency.

### Positioning

Position relative to the mascot, same coordinate system as `WorkingBubble`. Uses the same tail-direction logic from `MascotOverlay.tsx`:

1. Read `workingBubbleStore.state.visible` and the current `tailDir` from the overlay's layout computation (`l()` in MascotOverlay).
2. If `WorkingBubble` is visible, pick the opposite side for the token panel.
3. If not visible, prefer `right`, fall back to `left` if mascot is near the right edge, then `bottom`, then `top`.
4. Offset from mascot equals `TAIL_SIZE` plus a small gap (e.g. 4 px). No tail arrow on the token panel — it is a plain rounded rectangle.

Position computation lives inside `MascotOverlay.tsx` (alongside the existing bubble layout code), and the panel component receives final coordinates via props. This keeps all layout logic in one place.

### Tooltip on hover

Implemented as a second element rendered conditionally when `isHovering()` is true. Structure:

```
┌────────────────────────────┐
│  project-a                 │
│    input        1,234,567  │
│    output         456,789  │
│    cache read  45,678,901  │
│    cache create 2,100,345  │
│  ──────────────────        │
│  project-b                 │
│    input        2,000,000  │
│    ...                     │
└────────────────────────────┘
```

- Trigger: `onMouseEnter` / `onMouseLeave` on the panel root.
- Positioning: anchored next to the panel on the side away from the mascot (so hover doesn't flicker as the cursor crosses a gap). If that side is off-screen, flip.
- Z-index: higher than `TokenPanel` itself, lower than `ContextMenu` (99) — use `60`.
- Content source: `tokenUsageStore.sessions` sorted stably. If a session has all zeros it is omitted from the tooltip.
- If `sessions.length === 0` (shouldn't happen because panel itself would be hidden), render "No active sessions" as muted text.

### Click behavior

`onClick` on the panel root is a no-op. The panel does not block mascot hover or context menu — pointer events on the panel's own area do not propagate to the mascot sprite, which is fine because the mascot hover is already a separate region.

## Settings: `WorkingBubbleSettings` extension

### New types in `src/stores/working-bubble-store.ts`

```ts
export type TokenMetricKey =
  | "read" | "write" | "total"
  | "input" | "output" | "cache_read" | "cache_creation";

export interface TokenPanelSettings {
  enabled: boolean;
  order: TokenMetricKey[];
  visible: Record<TokenMetricKey, boolean>;
}

// Added field on WorkingBubbleSettings:
tokenPanel: TokenPanelSettings;
```

### Defaults

```ts
const defaultTokenPanel: TokenPanelSettings = {
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

### Persistence

Same localStorage key `masko_working_bubble_settings`. `loadSettings` merges `tokenPanel` from stored JSON over the default (deep merge one level), so existing installs without the new field get the defaults on first load without wiping other fields.

### Change broadcast

`updateSettings` already emits `bubble-settings-changed` via Tauri event. No new event type needed — the overlay listener at `MascotOverlay.tsx:819` already updates the whole settings object, so the token panel will pick up changes automatically.

## SettingsPanel UI

### New section location

Directly after the existing "Appearance" section in `src/components/dashboard/SettingsPanel.tsx`, before the "Notifications" / other sections.

### Section layout

```
── Token Panel ──────────────────────
[x] Show token panel on mascot

Metrics (use ↑/↓ to reorder, checkbox to show):
 ↑ ↓ [x] Read         input + cache read
 ↑ ↓ [x] Write        output + cache create
 ↑ ↓ [x] Total        all combined
 ↑ ↓ [ ] Input        raw input tokens
 ↑ ↓ [ ] Output       raw output tokens
 ↑ ↓ [ ] Cache read   raw cache read input
 ↑ ↓ [ ] Cache create raw cache creation input
```

- Each row has a checkbox (binds to `tokenPanel.visible[key]`), an up arrow, a down arrow, the metric display name, and a muted hint.
- Up arrow is disabled on the first row, down arrow on the last row.
- Clicking up/down swaps the row with its neighbor in `tokenPanel.order`.
- The "Show token panel" checkbox binds to `tokenPanel.enabled`.
- All changes call `workingBubbleStore.updateSettings(...)`.

### Preview section update

The existing preview area at `SettingsPanel.tsx:330` renders a `WorkingBubble` preview. Mount a second preview: a `TokenPanel` with mock session data:

```ts
const previewTokenData = {
  session_id: "preview",
  projectName: "demo-project",
  input: 12_345,
  output: 3_210,
  cache_read: 45_678,
  cache_creation: 987,
};
```

The preview `TokenPanel` receives the live `appearance` and `tokenPanel` settings, so font-size / color / order changes render immediately. Positioning within the preview area is static (side-by-side with the bubble preview); there is no mascot in the preview, so `anchorSide` is a fixed value.

## ContextMenu quick toggle

### New row in `MascotOverlay.tsx` ContextMenu

Insert after the Telegram submenu block and before the "Open Dashboard" row (verify exact anchor during implementation — the context menu has been evolving in recent commits). The new row:

```tsx
<MenuRow
  label="Tokens"
  icon="#"
  checked={bubbleSettings.tokenPanel.enabled}
  onClick={() => workingBubbleStore.updateSettings({
    tokenPanel: { ...bubbleSettings.tokenPanel, enabled: !bubbleSettings.tokenPanel.enabled }
  })}
/>
```

Uses the existing `MenuRow` component with the checkmark variant (same pattern as other toggles in the menu). No submenu — metric picker lives in SettingsPanel only.

## Edge cases

### Transcript file not yet created

When `SessionStart` fires, Claude Code may not have written the transcript file yet. `fs::metadata()` returns `NotFound`, the Rust command returns zeros, the store entry is created with zeros. The next `PostToolUse` will find the file and populate real numbers.

### Transcript file rotated / replaced

If Claude Code replaces the file (unlikely but possible via session compaction), the Rust parser detects this via `mtime` change combined with a file length smaller than the cached offset. On detection, it resets offset to 0 and zeroes the totals before re-parsing.

### Partial last line

A hook event may fire while Claude Code is mid-write on a JSONL line. The parser uses `BufReader::read_line` and treats a line without a trailing `\n` as partial — it does not advance `offset` past it and it does not update totals. The next refresh re-reads that line from the same offset.

### Malformed JSON lines

Any line that fails `serde_json::from_str` is logged and skipped, but `offset` still advances past it. This prevents a single corrupt line from blocking all subsequent parses.

### Concurrent refresh for the same session

The `Mutex<HashMap<...>>` serializes access. Two back-to-back events for the same session will parse serially — one will see the state the other produced.

### Masko restart mid-session

On restart, every session is a "new" entry in the Rust `HashMap`. The first refresh for a given session re-parses from offset 0, producing the correct cumulative total based on the transcript file as it exists on disk.

### Session that never sees an event after restart

If masko restarts and Claude Code sessions continue but no new hook event fires (rare — sessions are chatty), the token panel shows zeros for that session until the next event. This is acceptable — no hidden state to preserve.

### Hook event without `transcript_path`

Observed in practice: at least `PostToolUse` carries `transcript_path`. If any event type omits it, the store falls back to `pathCache[sessionId]` populated from earlier events. If `SessionStart` omits it, the first `PostToolUse` will populate the cache and refresh.

### Mascot position near screen edge

Panel positioning uses the same boundary logic the existing bubble uses. Panel is never placed off-screen — preference order is right → bottom → left → top, picking the first side with enough space and with the `WorkingBubble` not already there.

### Many active sessions (5+)

The aggregate math is O(n) over sessions — trivial even at n=50. The tooltip uses vertical scrolling as its primary overflow strategy, with `max-height: 80vh` and `overflow-y: auto`. No hard cap on visible sessions — scrolling alone handles the realistic upper bound. If the DOM ever holds enough session blocks to slow rendering, that's a future concern, not a current one.

### Very large transcript (>100 MB)

Rare but possible. Incremental parsing handles this — only the delta is read per event. The first parse on masko startup for an in-progress session reads the whole file, which at 100 MB sequential read is ~1 second on a modern SSD. Acceptable as a one-time cost; the result is cached in the Rust state.

## Testing strategy

### Rust unit tests

- `parse_usage_into` with a well-formed line → correct per-field increments.
- `parse_usage_into` with a line that has no `message.usage` → no change.
- `parse_usage_into` with malformed JSON → no change, no panic.
- `get_session_token_usage` over a fixture JSONL → cumulative total matches hand-computed expectation.
- Incremental call: parse once, append lines to the fixture file, parse again → second call returns first-call total plus appended-line totals.
- Mtime change / truncation → reset and re-parse.

### Frontend unit tests (if the project has them)

The project does not appear to have frontend unit test infrastructure; skipping unless one is added as part of this work.

### Manual smoke test

1. Start masko. Open Dashboard → Settings → Token Panel. Verify defaults.
2. Start a Claude Code session. Verify panel appears next to mascot after the first `PostToolUse`.
3. Let session run for several turns. Verify numbers monotonically increase.
4. Hover the panel. Verify tooltip shows the session with four raw numbers.
5. Open a second Claude Code session in another project. Verify the panel's numbers reflect the aggregate; hover verifies two session blocks.
6. Stop the first session. Verify it disappears from the tooltip and numbers drop.
7. Toggle Tokens in the context menu off/on. Verify panel hides/shows.
8. In SettingsPanel, reorder metrics and toggle input/output on. Verify the live panel updates.
9. In SettingsPanel, change font size. Verify both bubble preview and token panel preview scale.
10. Stop all sessions, quit masko, relaunch with an active session. Verify the panel re-appears with correct cumulative numbers on the first event.

## Open questions

None — all clarifications have been resolved during brainstorming. Any follow-up questions are expected to surface during implementation planning and be addressed there.

## Out of scope for this design (possible follow-ups)

- Estimated cost in USD based on model pricing.
- Per-turn delta indicator (e.g. `+1.2K` next to the running total).
- Sparkline of token rate over time.
- Warning badge when tokens exceed a user-configured threshold.
- Drag-to-reorder in SettingsPanel (up/down buttons used instead for simplicity).
