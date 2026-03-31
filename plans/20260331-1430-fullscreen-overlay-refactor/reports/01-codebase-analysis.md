# Codebase Analysis: Windows Overlay

## Current Architecture

### Window Configuration (`tauri.conf.json`)
- Overlay window: 320x520px, `decorations: false`, `transparent: true`, `alwaysOnTop: true`
- Fixed position at (100, 100) on startup
- Not resizable, no shadow, skip taskbar

### Rust Backend (`win_overlay.rs` + `lib.rs`)

**Frame suppression**: Custom `WM_STYLECHANGING` wndproc intercepts all style changes, strips frame/decoration bits (`WS_CAPTION`, `WS_THICKFRAME`, etc.). Prevents flash when `setIgnoreCursorEvents` triggers `SWP_FRAMECHANGED`.

**Click-through**: Cursor polling at ~60fps in a dedicated thread. `is_cursor_in_interactive_area()` checks if cursor is within:
- Mascot zone: bottom 200px, centered 200px wide (hardcoded `MASCOT_HEIGHT_PX`, `MASCOT_WIDTH_PX`)
- Permission band: 280px above mascot (when `PERMISSION_HIT_VISIBLE` atomic bool is true)
- Working bubble: 80px above mascot (when `WORKING_BUBBLE_VISIBLE` is true)

All hit-test math assumes mascot is pinned to bottom-center of the 320x520 window. Uses physical pixels via DPI scaling from `GetDpiForWindow`.

Emits `overlay-cursor-zone` event (bool) when zone changes. Frontend listens and calls `win.setIgnoreCursorEvents(shouldIgnore)`.

**Commands**: `set_overlay_permission_visible` and `set_overlay_working_bubble_visible` toggle atomic bools for hit-test.

### Frontend (`MascotOverlay.tsx`)

**Layout**: `fixed inset-0` container (fills 320x520 window). Mascot video div pinned `absolute bottom-0 left-1/2 -translate-x-1/2` (200x200px). Popups absolutely positioned at `bottom-[200px]`.

**Dragging**: Uses Tauri's `startDragging()` which moves the entire OS window. No CSS position tracking.

**State machine**: Drives mascot animations via video element. Manages agent states (working, idle, alert, compacting) via hook events.

**Permission/Bubble visibility**: Synced to Rust via `invoke()` for hit-test zones.

### Popup Components
- `PermissionPrompt.tsx`: 288px wide (`w-72`), positioned above mascot. Speech bubble with tail pointing down.
- `WorkingBubble.tsx`: 176px wide (`w-44`), positioned above mascot. Shows tool name and project.

### macOS Reference (`OverlayManager.swift`)
- Uses separate `OverlayPanel` instances for mascot, stats, and permission
- Panels are NSPanel subclasses — each independently positioned on screen
- Permission panel smart-positioned relative to mascot panel
- No fullscreen transparent overlay approach — uses floating panels

## Key Constraints for Refactor

1. **Hit-test math is hardcoded** — assumes bottom-center mascot in fixed-size window. Must become dynamic.
2. **`startDragging()` moves the OS window** — must be replaced with CSS mouse tracking.
3. **No monitor awareness** — window is placed at fixed (100,100), no multi-monitor logic.
4. **Popup positioning is relative to window edges** — must become relative to mascot position.
5. **DPI scaling** in hit-test must account for fullscreen dimensions and varying monitor DPI.
6. **`windows` crate features** — needs `Win32_Graphics_Gdi` for `EnumDisplayMonitors`/`GetMonitorInfoW`.
7. **WebView2 DirectComposition** — transparent fullscreen may have GPU cost; needs testing.

## Dependencies
- `windows` crate v0.58 — already has several Win32 features, needs `Win32_Graphics_Gdi` added
- Tauri v2 — `setIgnoreCursorEvents`, window positioning/resizing APIs available
- SolidJS — reactive state management for position tracking
