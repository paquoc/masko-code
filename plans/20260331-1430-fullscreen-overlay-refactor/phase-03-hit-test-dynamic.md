# Phase 3: Dynamic Hit-Test Zones in Rust

## Context
- [Phase 2: Mascot Drag](phase-02-mascot-drag.md) (prerequisite)
- [Codebase Analysis](reports/01-codebase-analysis.md)

## Overview
Replace hardcoded hit-test zone calculations in `win_overlay.rs` with dynamic zones based on the mascot's current CSS position (received from frontend via Tauri command). The cursor polling loop remains unchanged; only the zone geometry becomes dynamic.

## Key Insights
- Current hit-test assumes mascot at bottom-center of 320x520 window — completely wrong for fullscreen
- Frontend knows mascot position (from overlay-position-store); Rust needs it for `is_cursor_in_interactive_area()`
- Position must be in window-relative logical pixels; Rust scales to physical via DPI
- Atomic integers are sufficient for sharing position (same pattern as existing `PERMISSION_HIT_VISIBLE`)
- Popup positions also need dynamic hit-test zones — permission prompt and working bubble are positioned relative to mascot

## Requirements
- Hit-test zones track mascot's actual position in real-time
- Permission and working bubble zones calculated relative to mascot position
- Position updates from frontend don't block or slow the 60fps polling loop
- Existing frame suppression and click-through behavior unchanged

## Architecture

### Shared State in `win_overlay.rs`
```rust
// Mascot position in logical (CSS) pixels — set by frontend via Tauri command
static MASCOT_X: AtomicI32 = AtomicI32::new(0);
static MASCOT_Y: AtomicI32 = AtomicI32::new(0);
static MASCOT_W: AtomicI32 = AtomicI32::new(200);
static MASCOT_H: AtomicI32 = AtomicI32::new(200);
```

### Updated `is_cursor_in_interactive_area()`
Instead of computing mascot rect from window bottom-center:
1. Read `MASCOT_X`, `MASCOT_Y`, `MASCOT_W`, `MASCOT_H` atomics
2. Scale to physical pixels using DPI
3. Add window origin to get screen coordinates
4. Check cursor against mascot rect
5. If permission visible: check rect above mascot (same width as permission popup, height = `PERMISSION_BAND_PX`)
6. If working bubble visible: check rect above mascot (same width as bubble, height = `WORKING_BUBBLE_PX`)

### New Tauri Command
```rust
#[tauri::command]
pub fn update_mascot_position(x: i32, y: i32, w: i32, h: i32) {
    MASCOT_X.store(x, Ordering::Relaxed);
    MASCOT_Y.store(y, Ordering::Relaxed);
    MASCOT_W.store(w, Ordering::Relaxed);
    MASCOT_H.store(h, Ordering::Relaxed);
}
```

## Related Code Files
- `masko-windows/src-tauri/src/win_overlay.rs` (lines 125-175, `is_cursor_in_interactive_area`)
- `masko-windows/src-tauri/src/commands.rs` (add new command)
- `masko-windows/src-tauri/src/lib.rs` (register command in invoke_handler)
- `masko-windows/src/stores/overlay-position-store.ts` (sends position updates)

## Implementation Steps

### 1. Add position atomics to win_overlay.rs
Add `AtomicI32` statics for mascot x, y, w, h. Initialize with reasonable defaults (center-bottom of a 1920x1080 screen).

### 2. Add `update_mascot_position` function
Public function that stores values to atomics. No locking needed — atomics with Relaxed ordering are fine for position data (eventual consistency is acceptable for hit-test).

### 3. Rewrite `is_cursor_in_interactive_area()`
```rust
pub fn is_cursor_in_interactive_area(hwnd_raw: usize) -> bool {
    unsafe {
        let hwnd = HWND(hwnd_raw as *mut _);
        let mut cursor = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut cursor).is_err() { return false; }
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() { return false; }

        let dpi = GetDpiForWindow(hwnd);
        let scale = if dpi > 0 { dpi as f64 / 96.0 } else { 1.0 };

        // Read mascot position (logical CSS px) and scale to physical
        let mx = (MASCOT_X.load(Relaxed) as f64 * scale) as i32;
        let my = (MASCOT_Y.load(Relaxed) as f64 * scale) as i32;
        let mw = (MASCOT_W.load(Relaxed) as f64 * scale) as i32;
        let mh = (MASCOT_H.load(Relaxed) as f64 * scale) as i32;

        // Convert to screen coords
        let mascot_left = rect.left + mx;
        let mascot_top = rect.top + my;
        let mascot_right = mascot_left + mw;
        let mascot_bottom = mascot_top + mh;

        let in_mascot = cursor.x >= mascot_left && cursor.x < mascot_right
            && cursor.y >= mascot_top && cursor.y < mascot_bottom;

        // Permission zone: above mascot, same x range but wider (w-72 = 288px)
        let perm_w = (288.0 * scale) as i32;
        let perm_h = (PERMISSION_BAND_PX as f64 * scale) as i32;
        let perm_left = mascot_left;  // align left with mascot
        let perm_top = mascot_top - perm_h;
        let perm_on = PERMISSION_HIT_VISIBLE.load(Relaxed);
        let in_perm = perm_on
            && cursor.x >= perm_left && cursor.x < perm_left + perm_w
            && cursor.y >= perm_top && cursor.y < mascot_top;

        // Working bubble: above mascot (only if no permission shown)
        let bubble_w = (176.0 * scale) as i32;  // w-44
        let bubble_h = (WORKING_BUBBLE_PX as f64 * scale) as i32;
        let bubble_left = mascot_left;
        let bubble_top = mascot_top - bubble_h;
        let bubble_on = WORKING_BUBBLE_VISIBLE.load(Relaxed);
        let in_bubble = bubble_on
            && cursor.x >= bubble_left && cursor.x < bubble_left + bubble_w
            && cursor.y >= bubble_top && cursor.y < mascot_top;

        in_mascot || in_perm || in_bubble
    }
}
```

### 4. Add command to commands.rs
```rust
#[tauri::command]
pub fn update_mascot_position(x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    crate::win_overlay::update_mascot_position(x, y, w, h);
    Ok(())
}
```

### 5. Register command in lib.rs
Add `commands::update_mascot_position` to `invoke_handler`.

### 6. Remove hardcoded constants
Remove `MASCOT_HEIGHT_PX`, `MASCOT_WIDTH_PX` from win_overlay.rs (replaced by dynamic values). Keep `PERMISSION_BAND_PX` and `WORKING_BUBBLE_PX` as height constants (or make them dynamic too if popup heights vary).

## Todo
- [ ] Add `AtomicI32` position statics to win_overlay.rs
- [ ] Implement `update_mascot_position()` in win_overlay.rs
- [ ] Rewrite `is_cursor_in_interactive_area()` with dynamic zones
- [ ] Add `update_mascot_position` Tauri command to commands.rs
- [ ] Register command in lib.rs invoke_handler
- [ ] Remove hardcoded `MASCOT_HEIGHT_PX`/`MASCOT_WIDTH_PX` constants
- [ ] Wire frontend position store to call `update_mascot_position` (throttled)
- [ ] Test: hover over mascot at various positions — cursor changes correctly
- [ ] Test: hover over permission prompt at various mascot positions
- [ ] Test: click-through works everywhere outside interactive zones

## Success Criteria
- Click-through correctly follows mascot to any position on screen
- Permission prompt and working bubble are interactive at any mascot position
- No increase in cursor polling latency (still ~16ms/60fps)
- No frame flash or style regression

## Risk Assessment
- **Low**: `AtomicI32` with Relaxed ordering may read stale values for 1-2 frames — imperceptible to users
- **Low**: Popup hit-test zones assume fixed popup dimensions — if popup sizes become dynamic, constants need updating
- **Medium**: DPI change during runtime (e.g., moving between monitors) — handled in Phase 4

## Security Considerations
- `update_mascot_position` command accepts arbitrary coordinates — no security risk since it only affects hit-test, not window content
- No file system or network access

## Next Steps
Phase 4: Multi-monitor detection and window transition
