# Phase 1: Make Overlay Window Fullscreen

## Context
- [Codebase Analysis](reports/01-codebase-analysis.md)
- [Plan Overview](plan.md)

## Overview
Change the overlay window from 320x520 fixed size to covering the entire primary monitor. The window remains transparent, always-on-top, frameless, and click-through-capable.

## Key Insights
- `tauri.conf.json` sets initial size but we need runtime resizing to match actual monitor bounds
- `strip_frame()` and `subclass_overlay()` already handle frameless behavior — no changes needed there
- Window must cover full monitor work area (excluding taskbar would limit mascot movement)
- Full monitor bounds (not work area) is correct — mascot should be able to sit on taskbar area

## Requirements
- Overlay window covers entire primary monitor on startup
- Window position matches monitor origin (for multi-monitor, primary may not be at 0,0)
- No visual change initially (mascot still renders at bottom-center, popups above it)
- Frame suppression continues working at larger size

## Architecture

### tauri.conf.json Changes
```
overlay window: remove fixed x/y, set width/height to large defaults (will be overridden at runtime)
```

### lib.rs Changes
- On setup, query primary monitor bounds via Win32 API
- Resize and reposition overlay window to cover primary monitor
- Existing `strip_frame` and `subclass_overlay` calls remain unchanged

### win_overlay.rs Changes
- Add `get_primary_monitor_bounds()` function using `MonitorFromWindow` + `GetMonitorInfoW`
- Returns `(x, y, width, height)` in physical pixels

### Cargo.toml Changes
- Add `Win32_Graphics_Gdi` to windows crate features (needed for monitor APIs)

## Related Code Files
- `masko-windows/src-tauri/tauri.conf.json`
- `masko-windows/src-tauri/src/lib.rs` (lines 44-76, overlay setup)
- `masko-windows/src-tauri/src/win_overlay.rs`
- `masko-windows/src-tauri/Cargo.toml`

## Implementation Steps

### 1. Add Win32 Graphics feature to Cargo.toml
Add `"Win32_Graphics_Gdi"` to the windows crate features list.

### 2. Add monitor bounds query in win_overlay.rs
```rust
pub fn get_primary_monitor_bounds() -> (i32, i32, i32, i32) {
    // Use MonitorFromPoint(0,0, MONITOR_DEFAULTTOPRIMARY)
    // Then GetMonitorInfoW to get rcMonitor bounds
    // Return (left, top, width, height)
}
```

### 3. Update tauri.conf.json overlay config
- Remove `"x": 100, "y": 100`
- Change width/height to `1920`/`1080` (will be overridden at runtime)
- Keep all other properties (`transparent`, `alwaysOnTop`, etc.)

### 4. Resize overlay to primary monitor in lib.rs setup
After `strip_frame` and `subclass_overlay`:
```rust
let (mx, my, mw, mh) = crate::win_overlay::get_primary_monitor_bounds();
// Use SetWindowPos to resize overlay to monitor bounds
SetWindowPos(hwnd, HWND_TOPMOST, mx, my, mw, mh, SWP_NOACTIVATE | SWP_FRAMECHANGED);
```
Or use Tauri's `overlay.set_position()` + `overlay.set_size()`.

### 5. Verify transparent fullscreen renders correctly
- Build and run, confirm overlay covers full screen
- Confirm mascot still visible at bottom-center
- Confirm click-through still works (cursor polling + `setIgnoreCursorEvents`)
- Confirm no GPU performance regression

## Todo
- [ ] Add `Win32_Graphics_Gdi` feature to Cargo.toml
- [ ] Implement `get_primary_monitor_bounds()` in win_overlay.rs
- [ ] Update tauri.conf.json overlay dimensions
- [ ] Resize overlay to monitor on startup in lib.rs
- [ ] Test: transparent fullscreen renders, click-through works, no frame flash
- [ ] Test: GPU/memory impact of fullscreen transparent WebView2

## Success Criteria
- Overlay window covers entire primary monitor
- Mascot visible at bottom-center (same as before, just within larger window)
- Click-through works everywhere except mascot area
- No visible frame or window chrome
- No significant GPU increase (< 5% GPU usage from overlay alone)

## Risk Assessment
- **High**: Fullscreen transparent WebView2 may cause GPU overhead — test with Task Manager GPU tab
- **Medium**: `SetWindowPos` at large dimensions could cause flicker during startup — use `SWP_NOREDRAW` if needed
- **Low**: Primary monitor detection edge case on single-monitor setups — `MONITOR_DEFAULTTOPRIMARY` handles this

## Security Considerations
- No new attack surface; overlay remains local-only
- Click-through ensures no input interception of non-mascot areas

## Next Steps
Phase 2: Replace startDragging with CSS/JS mouse tracking within the fullscreen window
