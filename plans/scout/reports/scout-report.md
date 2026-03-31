# Masko Windows Overlay Scout Report

## Summary
Complete mapping of the Tauri overlay window setup, mascot positioning system, appearance control, and click-through handling.

## 1. Overlay Window Setup (tauri.conf.json)

Window definition for overlay:
- label: overlay
- url: overlay.html
- transparent: true (full window transparency)
- alwaysOnTop: true (always above other windows)
- decorations: false (no window frame)
- skipTaskbar: true (hidden from taskbar)
- resizable: false (fixed 1920x1080)
- visible: false (starts hidden)
- focus: false (never gets keyboard focus)
- shadow: false (no drop shadow)

## 2. Rust Backend Setup (src-tauri/src/lib.rs)

Key initialization steps:
1. Gets overlay window via app.get_webview_window(overlay)
2. Calls Windows-specific setup:
   - strip_frame() - Remove window frame decorations
   - subclass_overlay() - Install custom WM_STYLECHANGING handler
   - resize_to_monitor() - Resize to primary monitor bounds
3. Spawns 60fps cursor polling thread
4. Emits overlay-cursor-zone events to frontend

## 3. Windows Overlay Management (win_overlay.rs)

Window Message Handler:
- Intercepts WM_STYLECHANGING before style bits apply
- Strips banned styles to maintain frameless appearance
- Preserves WS_EX_TRANSPARENT for click-through toggle

Dynamic Mascot Position (Atomic Variables):
- MASCOT_X, MASCOT_Y: Position in CSS pixels (default 60, 320)
- MASCOT_W, MASCOT_H: Size in CSS pixels (200x200)
- Updated by frontend via update_mascot_position command
- Read by cursor polling thread with Relaxed ordering

Interactive Zone Detection (is_cursor_in_interactive_area):
- Mascot zone: 200x200 at MASCOT_X/Y
- Permission bubble zone: 280px height above mascot (if visible)
- Working bubble zone: 80px height above mascot (if visible)
- All coordinates scaled from CSS pixels to physical pixels using DPI

Control Flags (AtomicBool):
- PERMISSION_HIT_VISIBLE: Enable/disable permission zone
- WORKING_BUBBLE_VISIBLE: Enable/disable working bubble zone
- DRAGGING: Suppress click-through during drag

Monitor Detection:
- get_monitor_at_point(x, y): Returns (left, top, width, height)
- resize_to_monitor(): Resizes overlay to monitor bounds
- Uses Windows MonitorFromPoint API

## 4. Tauri Commands (commands.rs)

- update_mascot_position(x, y, w, h): Updates hit-test position
- set_overlay_permission_visible(bool): Enable/disable permission zone
- set_overlay_working_bubble_visible(bool): Enable/disable working bubble zone
- set_overlay_dragging(bool): Suppress click-through during drag
- get_monitor_at_point(x, y): Returns monitor bounds
- move_overlay_to_monitor(x, y): Resize overlay to cover monitor

## 5. Frontend Overlay Component (MascotOverlay.tsx)

Core functionality:
- Full-screen transparent container
- Loads mascot configs from /mascots/slug.json
- State machine for animation states (idle/working/alert)
- Drag-to-move with 3px threshold
- Event listeners for hook events, permissions, bubble settings
- Dynamic bubble positioning based on screen location
- Cursor zone synchronization

Bubble Layout Algorithm:
- Bottom half: Bubble above mascot, tail down
- Top-left: Bubble to right, tail left
- Top-right: Bubble to left, tail right
- 4px gap between bubble and mascot, 8px from screen edges

Video Playback:
- HTML5 video element with opacity transition
- Waits for canplay event before showing
- Muted and playsinline attributes

Drag Handling:
- Set overlay_dragging=true for interactivity
- Update position via overlayPositionStore
- Detect monitor change, call move_overlay_to_monitor if needed
- Persist position to localStorage on drag end

Click-through Integration:
- Listen to overlay-cursor-zone events
- Call window.setIgnoreCursorEvents(shouldIgnore)
- Clear selection/blur before going click-through

## 6. Position Management (overlay-position-store.ts)

Constants:
- MASCOT_SIZE: 200px (fixed, CSS logical pixels)

State Signals:
- x, y: Position in CSS pixels relative to overlay window
- monitorX, monitorY, monitorW, monitorH: Current monitor bounds

Functions:
- updatePosition(newX, newY): Clamp to window bounds, sync to Rust
- persistPosition(): Save to localStorage as screen coordinates
- restorePosition(): Load from localStorage, handle multi-monitor
- syncToRust(): Throttled 16ms, update MASCOT_X/Y/W/H atomics
- setMonitorBounds(): Update monitor info
- screenCenter(): Return center point for monitor detection

Persistence:
- Uses screen coordinates (not window-relative)
- Survives monitor layout changes

## 7. Appearance Management (working-bubble-store.ts)

BubbleAppearance:
- fontSize: Base font size (default 11px)
- bgColor: Bubble background (default rgba(255,255,255,0.95))
- textColor: Primary text (default #23113c)
- mutedColor: Secondary text (default rgba(35,17,60,0.55))
- accentColor: Button/status dot (default #f95d02)
- buttonTextColor: Text on buttons (default #ffffff)
- hoverColor: Mascot hover (default rgba(255,176,72,0.45))

Settings:
- showToolBubble: Display during tool execution
- showSessionStart: Display on session start (auto-hide 4s)
- showSessionEnd: Display DONE (auto-hide 10s)

Storage:
- localStorage key: masko_working_bubble_settings

## 8. Overlay Components

BubbleTail (BubbleTail.tsx):
- Directional pointer: down/left/right
- TAIL_SIZE: 8px
- CSS border triangle technique
- Drop-shadow filter

WorkingBubble (WorkingBubble.tsx):
- Fixed width 176px
- Project name (small muted)
- Tool name with status indicator
- Auto-hide 20s (working) or 10s (done)

PermissionPrompt (PermissionPrompt.tsx):
- Fixed width 288px
- Tool name, project, input display
- Permission suggestions (selectable)
- AskUserQuestion: text input or options
- Approve/Allow Rule and Deny buttons
- Queue counter badge

## 9. Context Menu & Input Handling

Context Menu Prevention (MascotOverlay.tsx line 165):
- Clear selection: window.getSelection().removeAllRanges()
- Blur active element: document.activeElement.blur()
- Done before going click-through
- No explicit contextmenu event handler found

Tray Menu (tray.rs):
- Show Mascot: Shows overlay window
- Open Dashboard: Shows main window
- Settings: Shows main window (TODO: navigate to settings)
- Quit Masko: Exit app
- No overlay-specific right-click menu

## 10. Currently Controllable Properties

CONTROLLABLE:
- Mascot X, Y position (drag to move)
- Position persistence (localStorage)
- Bubble colors (6 properties)
- Font size (base + derived)
- Visibility toggles
- Auto-hide timers
- Click-through behavior
- Interactive zones
- Monitor detection
- Always-on-top

NOT CONTROLLABLE:
- Window opacity (hard-coded transparent: true)
- Mascot size (fixed 200x200px)
- Window dimensions (fixed 1920x1080)
- Z-index values (hard-coded 15, 20)
- Drag threshold (fixed 3px)
- Polling frequency (fixed 60fps)

## 11. Key Files

Core:
- src-tauri/tauri.conf.json
- src-tauri/src/lib.rs
- src-tauri/src/commands.rs
- src-tauri/src/win_overlay.rs
- src/overlay-entry.tsx
- src/components/overlay/MascotOverlay.tsx
- src/stores/overlay-position-store.ts
- src/stores/working-bubble-store.ts

Components:
- src/components/overlay/WorkingBubble.tsx
- src/components/overlay/PermissionPrompt.tsx
- src/components/overlay/BubbleTail.tsx
- src-tauri/src/tray.rs

## Unresolved Questions

1. Runtime opacity control: May need to expose Tauri window.setOpacity()
2. Context menu behavior: Does default browser context menu appear?
3. Performance: 60fps polling impact on CPU
4. DPI scaling: Edge cases during monitor transitions

