# Phase 4: Multi-Monitor Detection and Transition

## Context
- [Phase 1-3](plan.md) (prerequisites)
- [Codebase Analysis](reports/01-codebase-analysis.md)

## Overview
Detect when the mascot is dragged near a monitor edge and transition the fullscreen overlay window to cover the target monitor. The mascot's position recalculates relative to the new window origin.

## Key Insights
- Windows monitors have independent coordinate spaces — primary at (0,0), others offset
- `EnumDisplayMonitors` returns all monitors; `GetMonitorInfoW` gives bounds and work area
- Monitor transitions happen when mascot crosses the boundary between two monitors
- Overlay window must resize to new monitor dimensions (monitors may differ in resolution/DPI)
- During transition, brief flicker is acceptable (window resize is not instantaneous)
- Simpler approach: check which monitor contains the mascot center point, transition if different from current

## Requirements
- Mascot can be dragged from one monitor to another seamlessly
- Overlay window resizes to cover the target monitor on transition
- Mascot position recalculates correctly for new window origin
- DPI scaling adjusts for new monitor's DPI
- Works with 2+ monitors in any arrangement (horizontal, vertical, mixed)
- Persisted position includes monitor identifier for correct restoration

## Architecture

### Monitor Detection (Rust)
```rust
struct MonitorInfo {
    x: i32, y: i32, width: i32, height: i32,
    dpi_scale: f64,
    name: String,  // \\.\DISPLAY1, etc.
}

fn enumerate_monitors() -> Vec<MonitorInfo> { ... }
fn monitor_at_point(x: i32, y: i32) -> Option<MonitorInfo> { ... }
```

### Transition Flow
1. Frontend tracks mascot screen position (window origin + CSS position)
2. On drag end (or periodically during drag), frontend calls `invoke("get_monitor_at_point", { x, y })`
3. If returned monitor differs from current, frontend calls `invoke("move_overlay_to_monitor", { monitorName })`
4. Rust resizes/repositions overlay window to cover new monitor
5. Frontend recalculates mascot CSS position: `newX = screenX - newMonitor.x`, `newY = screenY - newMonitor.y`
6. Update position store and persist

### Current Monitor Tracking
- Store current monitor name in position store
- On startup: determine which monitor contains saved position, move overlay there

### Edge Behavior
- When mascot center crosses monitor boundary, trigger transition
- During drag across boundary: complete the drag on current monitor, then transition on mouseup
- This avoids window resize mid-drag (which would disrupt mouse capture)

## Related Code Files
- `masko-windows/src-tauri/src/win_overlay.rs` — add monitor enumeration
- `masko-windows/src-tauri/src/commands.rs` — add monitor commands
- `masko-windows/src-tauri/src/lib.rs` — register commands, init to correct monitor
- `masko-windows/src/stores/overlay-position-store.ts` — monitor tracking
- `masko-windows/src/components/overlay/MascotOverlay.tsx` — trigger transitions
- `masko-windows/src-tauri/Cargo.toml` — already has `Win32_Graphics_Gdi` from Phase 1

## Implementation Steps

### 1. Implement monitor enumeration in win_overlay.rs
```rust
use windows::Win32::Graphics::Gdi::*;

pub fn enumerate_monitors() -> Vec<MonitorInfo> {
    // Use EnumDisplayMonitors(None, None, callback, lparam)
    // In callback: GetMonitorInfoW for each HMONITOR
    // Return vec of MonitorInfo structs
}

pub fn monitor_at_point(x: i32, y: i32) -> MonitorInfo {
    // Use MonitorFromPoint(POINT{x,y}, MONITOR_DEFAULTTONEAREST)
    // GetMonitorInfoW for bounds
}
```

### 2. Add Tauri commands
```rust
#[tauri::command]
pub fn get_monitors() -> Vec<MonitorInfo> { ... }

#[tauri::command]
pub fn get_monitor_at_point(x: i32, y: i32) -> MonitorInfo { ... }

#[tauri::command]
pub fn move_overlay_to_monitor(monitor_name: String) -> Result<(i32, i32, i32, i32), String> {
    // Find monitor by name
    // SetWindowPos overlay to cover that monitor
    // Return new (x, y, width, height) bounds
}
```

### 3. Track current monitor in position store
```typescript
interface OverlayPosition {
  x: number;          // CSS left within window
  y: number;          // CSS top within window
  screenX: number;    // absolute screen coordinate
  screenY: number;
  monitorName: string;
  monitorBounds: { x: number; y: number; w: number; h: number };
}
```

### 4. Add transition logic to MascotOverlay.tsx
On mouseup after drag:
```typescript
const screenX = monitorBounds.x + position.x;
const screenY = monitorBounds.y + position.y;
const targetMonitor = await invoke("get_monitor_at_point", { x: screenX, y: screenY });
if (targetMonitor.name !== currentMonitor.name) {
  const newBounds = await invoke("move_overlay_to_monitor", { monitorName: targetMonitor.name });
  // Recalculate CSS position relative to new window
  positionStore.updatePosition(screenX - newBounds.x, screenY - newBounds.y);
  positionStore.setMonitor(targetMonitor);
}
```

### 5. Startup monitor detection
In lib.rs setup:
- Read saved position from frontend (or have frontend handle this)
- Alternative: frontend on mount checks saved position, calls `get_monitor_at_point`, then `move_overlay_to_monitor` if needed

### 6. Handle DPI changes across monitors
- When moving to new monitor, DPI may differ
- Hit-test in Rust already reads DPI per-window via `GetDpiForWindow` — this updates when window moves to new monitor
- Frontend CSS uses logical pixels — no change needed
- The overlay window size in physical pixels will differ but Tauri handles logical-to-physical conversion

## Todo
- [ ] Implement `enumerate_monitors()` in win_overlay.rs
- [ ] Implement `monitor_at_point()` in win_overlay.rs
- [ ] Add `get_monitors`, `get_monitor_at_point`, `move_overlay_to_monitor` commands
- [ ] Register commands in lib.rs
- [ ] Add monitor tracking to overlay-position-store.ts
- [ ] Add transition logic on drag end in MascotOverlay.tsx
- [ ] Handle startup: restore to correct monitor
- [ ] Test: drag mascot from monitor 1 to monitor 2
- [ ] Test: restart app — mascot restores on correct monitor
- [ ] Test: monitors with different DPI scales
- [ ] Test: monitor disconnected — fallback to primary

## Success Criteria
- Mascot can be dragged to any connected monitor
- Overlay window covers the correct monitor after transition
- Hit-test works correctly on new monitor (with potentially different DPI)
- Position persists across restart on correct monitor
- If saved monitor is disconnected, mascot falls back to primary monitor

## Risk Assessment
- **Medium**: `EnumDisplayMonitors` callback pattern is tricky in Rust — use `unsafe` carefully, test with 1, 2, 3 monitors
- **Medium**: Monitor hotplug (connect/disconnect while running) — handle gracefully by falling back to primary
- **Low**: Different monitor DPI during transition — Tauri and Win32 handle DPI per-window automatically
- **Low**: Ultra-wide or vertical monitor arrangements — hit-test uses rectangular bounds, works regardless of arrangement

## Security Considerations
- Monitor enumeration exposes display names (e.g., `\\.\DISPLAY1`) — not sensitive information
- No elevated privileges needed for monitor APIs

## Next Steps
Phase 5: Reposition popups relative to mascot's dynamic position
