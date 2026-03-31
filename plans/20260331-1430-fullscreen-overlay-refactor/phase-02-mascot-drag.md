# Phase 2: Replace startDragging with CSS/JS Mouse Tracking

## Context
- [Phase 1: Fullscreen Window](phase-01-window-fullscreen.md) (prerequisite)
- [Codebase Analysis](reports/01-codebase-analysis.md)

## Overview
Replace Tauri's `startDragging()` (which moves the OS window) with mousedown/mousemove/mouseup handlers that update the mascot's CSS position within the fullscreen overlay. Create a position store to track mascot coordinates and persist them.

## Key Insights
- Current `handleMouseDown` in `MascotOverlay.tsx` calls `getCurrentWindow().startDragging()` — this moves the window itself
- In fullscreen mode, window stays fixed; mascot div moves via `left`/`top` CSS
- Mouse coordinates from `MouseEvent` are relative to the viewport (which equals the monitor in fullscreen)
- Must handle edge clamping so mascot stays within window bounds
- Position must be persisted as screen coordinates for cross-session restoration

## Requirements
- Mascot can be dragged to any position on screen (including top edge)
- Smooth drag without jitter (requestAnimationFrame for position updates)
- Position persisted to localStorage as screen-relative coordinates
- Restored on app restart at correct position
- Drag cursor feedback (grab/grabbing) maintained

## Architecture

### New Store: `overlay-position-store.ts`
```typescript
interface OverlayPosition {
  screenX: number;  // screen coordinate (for multi-monitor persistence)
  screenY: number;
  windowX: number;  // position within current overlay window
  windowY: number;
}
```
- SolidJS store with reactive `position` signal
- `setPosition(x, y)` updates CSS position + syncs to Rust (throttled)
- `persistPosition()` saves to localStorage
- `restorePosition()` loads from localStorage, converts screen coords to window-relative

### MascotOverlay.tsx Changes
- Remove `startDragging()` call
- Add mousedown/mousemove/mouseup handlers on mascot div
- Track drag offset (mouse position relative to mascot top-left at drag start)
- Update mascot `left`/`top` on mousemove
- On mouseup: persist position, sync to Rust
- Use `position: absolute` with `left`/`top` (not transform) for simpler hit-test math

### Drag Implementation Detail
```
mousedown: record offsetX = e.clientX - mascot.left, offsetY = e.clientY - mascot.top
mousemove: mascot.left = e.clientX - offsetX, mascot.top = e.clientY - offsetY
mouseup: persist, sync to Rust
```
- Attach mousemove/mouseup to `window` (not mascot div) to handle fast mouse movement
- Use `e.preventDefault()` on mousedown to prevent text selection

### Click-Through Interaction
During drag, the mascot area is interactive (cursor is over mascot). The existing `overlay-cursor-zone` polling handles this — no special drag logic needed for click-through. However, if mouse moves fast and leaves mascot rect, click-through could engage. Solution: during drag, force `setIgnoreCursorEvents(false)` and restore on mouseup.

## Related Code Files
- `masko-windows/src/components/overlay/MascotOverlay.tsx` (lines 311-317, drag handler)
- `masko-windows/src/stores/` (new file: overlay-position-store.ts)
- `masko-windows/src-tauri/src/lib.rs` (cursor zone listener context)

## Implementation Steps

### 1. Create `overlay-position-store.ts`
- Define position state: `{ x: number, y: number }` (window-relative logical pixels)
- Default position: bottom-center of window (calculated from window size)
- `updatePosition(x, y)` — reactive setter
- `persistPosition()` — save `{ screenX, screenY }` to localStorage
- `restorePosition()` — load and convert to window-relative coords
- Expose `mascotScreenPosition()` computed — for Rust sync and multi-monitor detection

### 2. Modify MascotOverlay.tsx drag handling
Replace:
```tsx
const handleMouseDown = async (e: MouseEvent) => {
  if (e.buttons === 1) {
    setIsDragging(true);
    await getCurrentWindow().startDragging();
    setIsDragging(false);
  }
};
```
With:
```tsx
const handleMouseDown = (e: MouseEvent) => {
  if (e.buttons !== 1) return;
  e.preventDefault();
  setIsDragging(true);
  const startX = e.clientX - positionStore.x;
  const startY = e.clientY - positionStore.y;
  
  // Force interactive during drag
  getCurrentWindow().setIgnoreCursorEvents(false);
  
  const onMove = (ev: MouseEvent) => {
    const newX = clamp(ev.clientX - startX, 0, window.innerWidth - 200);
    const newY = clamp(ev.clientY - startY, 0, window.innerHeight - 200);
    positionStore.updatePosition(newX, newY);
  };
  const onUp = () => {
    setIsDragging(false);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    positionStore.persistPosition();
    // Resume normal cursor zone polling
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
};
```

### 3. Update mascot div positioning
Change from:
```tsx
class="absolute bottom-0 left-1/2 -translate-x-1/2 w-[200px] h-[200px]"
```
To:
```tsx
class="absolute w-[200px] h-[200px]"
style={{ left: `${positionStore.x}px`, top: `${positionStore.y}px` }}
```

### 4. Sync position to Rust (throttled)
- `createEffect` watches position, calls `invoke("update_mascot_position", { x, y, w: 200, h: 200 })` throttled to ~60fps
- Rust stores position in atomic/shared state for hit-test (see Phase 3)

### 5. Persist and restore position
- On mouseup: `localStorage.setItem("mascot_position", JSON.stringify({ screenX, screenY }))`
- On mount: read from localStorage, calculate window-relative position
- If no saved position: default to bottom-center

## Todo
- [ ] Create `overlay-position-store.ts` with reactive position state
- [ ] Replace `startDragging()` with mouse event handlers in MascotOverlay.tsx
- [ ] Update mascot div to use `left`/`top` absolute positioning
- [ ] Force `setIgnoreCursorEvents(false)` during drag, restore after
- [ ] Add throttled position sync to Rust via invoke
- [ ] Persist position to localStorage on drag end
- [ ] Restore position on mount
- [ ] Test: drag to all edges, corners, top of screen
- [ ] Test: click-through still works after drag ends
- [ ] Test: position persists across app restart

## Success Criteria
- Mascot draggable to any position within the fullscreen window
- No jitter during drag (smooth 60fps updates)
- Position survives app restart
- Click on mascot (without drag) still triggers `handleClick()`
- Click-through works correctly after drag ends
- Drag to top edge works (no restriction to bottom)

## Risk Assessment
- **Medium**: Fast mouse movement during drag may outpace mouse events — mitigated by attaching listeners to `window`
- **Medium**: Click vs drag distinction — current code sets `isDragging` on mousedown; need threshold (e.g., 3px movement) before treating as drag to preserve click behavior
- **Low**: Position persistence format change — no migration needed (new feature)

## Security Considerations
- No new attack surface
- `setIgnoreCursorEvents(false)` during drag is scoped to drag duration only

## Next Steps
Phase 3: Update Rust hit-test to use dynamic mascot position
