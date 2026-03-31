# Fullscreen Transparent Overlay Refactor

## Goal
Replace the 320x520 draggable overlay window with a fullscreen transparent overlay. Mascot dragged within window via CSS/JS mouse tracking. Multi-monitor support: overlay follows mascot across monitors.

## Context
- Current: small fixed window, `startDragging()` moves OS window, hardcoded hit-test zones
- Target: fullscreen transparent window covering one monitor at a time, CSS-positioned mascot, dynamic hit-test, monitor-aware transitions
- See `reports/01-codebase-analysis.md` for current architecture details

## Phases

| Phase | File | Summary |
|-------|------|---------|
| 1 | `phase-01-window-fullscreen.md` | Make overlay window fullscreen, cover primary monitor |
| 2 | `phase-02-mascot-drag.md` | Replace startDragging with CSS/JS mouse tracking |
| 3 | `phase-03-hit-test-dynamic.md` | Dynamic hit-test zones in Rust |
| 4 | `phase-04-multi-monitor.md` | Monitor detection and transition |
| 5 | `phase-05-popup-reposition.md` | Reposition popups relative to mascot |

## Execution Order
Phases 1-3 are sequential (each builds on previous). Phase 4 depends on 1-3. Phase 5 can start after Phase 2.

## Key Design Decisions
1. **One fullscreen window per monitor** (not spanning all monitors) — avoids DPI mismatch, simpler hit-test
2. **CSS `position: absolute` with `left`/`top`** for mascot — simpler math than transforms for hit-testing
3. **Throttled position sync** from frontend to Rust (~60fps matches existing poll rate)
4. **Monitor transition via Rust command** — frontend detects edge proximity, Rust resizes/repositions window
5. **Persist screen coordinates** (not window-relative) so mascot restores to correct monitor position

## Files Changed (Summary)
- `tauri.conf.json` — initial window size to primary monitor dimensions
- `Cargo.toml` — add `Win32_Graphics_Gdi` feature
- `win_overlay.rs` — dynamic hit-test from shared mascot position, monitor enumeration
- `lib.rs` — fullscreen init, new Tauri commands
- `commands.rs` — new commands: `update_mascot_position`, `get_monitors`, `move_to_monitor`
- `MascotOverlay.tsx` — CSS drag, position tracking, monitor transition
- `PermissionPrompt.tsx` — position relative to mascot
- `WorkingBubble.tsx` — position relative to mascot
- New: `overlay-position-store.ts` — mascot screen position state

## Risk Summary
- **GPU cost** of fullscreen transparent WebView2 — mitigate by testing early, use `will-change: transform` sparingly
- **DPI transitions** between monitors — handle in monitor transition logic
- **Edge cases** in multi-monitor geometry (gaps, different orientations) — handle rectangular bounds only
