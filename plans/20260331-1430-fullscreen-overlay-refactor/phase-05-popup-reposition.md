# Phase 5: Reposition Popups Relative to Mascot

## Context
- [Phase 2: Mascot Drag](phase-02-mascot-drag.md) (prerequisite)
- [Codebase Analysis](reports/01-codebase-analysis.md)

## Overview
Update PermissionPrompt and WorkingBubble positioning to follow the mascot's dynamic position instead of being anchored to the bottom of a fixed-size window. Popups appear above the mascot wherever it is on screen, with smart edge detection to avoid clipping off-screen.

## Key Insights
- Currently popups use `absolute bottom-[200px]` — assumes mascot at bottom of 320x520 window
- In fullscreen, popups must use `left`/`top` relative to mascot position from position store
- Popups should appear above mascot by default, but flip below if mascot is near top of screen
- Popup width (288px for permission, 176px for bubble) may clip horizontally — need edge clamping
- Context menu (if added later) follows same pattern

## Requirements
- Popups appear directly above mascot at any screen position
- If mascot is near top edge, popups appear below or beside mascot
- Horizontal clamping: popups don't extend beyond window/monitor edges
- Speech bubble tail points toward mascot regardless of popup position
- Hit-test zones in Rust match actual popup positions (Phase 3 already handles this via dynamic coords)

## Architecture

### Popup Positioning Logic
```typescript
function getPopupPosition(mascotX: number, mascotY: number, popupW: number, popupH: number) {
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  
  // Default: above mascot, aligned left
  let x = mascotX;
  let y = mascotY - popupH - 4; // 4px gap
  
  // Flip below if too close to top
  if (y < 8) {
    y = mascotY + 200 + 4; // below mascot (200 = mascot height)
  }
  
  // Clamp horizontal
  x = Math.max(8, Math.min(x, screenW - popupW - 8));
  
  return { x, y };
}
```

### Speech Bubble Tail Direction
- When popup is above mascot: tail points down (current behavior)
- When popup is below mascot: tail points up (flip `border-top` to `border-bottom`)
- Tail horizontal position: offset to align with mascot center

### MascotOverlay.tsx Layout Changes
Replace:
```tsx
<div class="absolute bottom-[200px] left-0 right-0 ...">
  <WorkingBubble />
</div>
```
With:
```tsx
<div class="absolute" style={{
  left: `${popupPos().x}px`,
  top: `${popupPos().y}px`,
}}>
  <WorkingBubble tailDirection={popupPos().tailDir} />
</div>
```

## Related Code Files
- `masko-windows/src/components/overlay/MascotOverlay.tsx` (lines 339-360, popup containers)
- `masko-windows/src/components/overlay/PermissionPrompt.tsx` (tail component)
- `masko-windows/src/components/overlay/WorkingBubble.tsx` (tail component)
- `masko-windows/src/stores/overlay-position-store.ts` (mascot position)

## Implementation Steps

### 1. Create popup positioning utility
New file or inline in MascotOverlay.tsx:
```typescript
function computePopupPosition(
  mascotX: number, mascotY: number,
  mascotW: number, mascotH: number,
  popupW: number, popupH: number,
  screenW: number, screenH: number,
): { x: number; y: number; tailDir: "down" | "up" } {
  // above by default, flip below if near top
  // clamp horizontal to screen bounds
}
```

### 2. Update MascotOverlay.tsx popup containers
- Read mascot position from position store
- Compute popup position for each popup type
- Apply `left`/`top` absolute positioning
- Pass `tailDirection` prop to popup components

### 3. Add `tailDirection` prop to WorkingBubble
- Accept `tailDir: "down" | "up"` prop
- When "up": render tail at top of bubble, pointing upward
- When "down": render tail at bottom (current behavior)

### 4. Add `tailDirection` prop to PermissionPrompt
- Same pattern as WorkingBubble
- SpeechBubbleTail component already exists — add direction parameter

### 5. Update Rust hit-test zone positions
The hit-test in Phase 3 places popup zones relative to mascot position. If popups flip below mascot (near top edge), the hit-test zones must also flip. Options:
- **Option A**: Frontend sends popup position to Rust (additional command)
- **Option B**: Rust replicates the flip logic
- **Recommended**: Option A — simpler, single source of truth

Add command: `update_popup_position(permX, permY, permW, permH, bubbleX, bubbleY, bubbleW, bubbleH)`
Or: send with mascot position update as one combined call.

### 6. Test edge cases
- Mascot at top-left corner: popup appears below and right
- Mascot at bottom-right: popup appears above and left
- Mascot centered: popup appears above
- Very small monitors or large DPI: popups may need to shrink (stretch goal)

## Todo
- [ ] Create `computePopupPosition()` utility function
- [ ] Update MascotOverlay.tsx to position popups dynamically
- [ ] Add `tailDirection` prop to WorkingBubble component
- [ ] Add `tailDirection` prop to PermissionPrompt / SpeechBubbleTail
- [ ] Sync popup positions to Rust for hit-test zones
- [ ] Test: mascot at top edge — popups flip below
- [ ] Test: mascot at left/right edge — popups clamp horizontally
- [ ] Test: mascot at center — popups above (default)
- [ ] Test: permission prompt interactive at all positions
- [ ] Test: working bubble interactive at all positions

## Success Criteria
- Popups always fully visible on screen regardless of mascot position
- Speech bubble tail always points toward mascot
- Click-through correctly identifies popup areas at any position
- No visual regression when mascot is at default/center position

## Risk Assessment
- **Low**: Popup flip logic adds complexity but is straightforward geometry
- **Low**: Tail direction prop is a simple conditional render
- **Medium**: Hit-test zone sync for flipped popups — if frontend and Rust disagree, click-through breaks in popup area. Mitigate by sending explicit popup rect from frontend.

## Security Considerations
- No new attack surface
- Popup positioning is purely visual

## Next Steps
After all phases complete:
- End-to-end testing across monitors with different DPI
- Performance profiling of fullscreen transparent overlay
- Consider: context menu positioning (same pattern as popups)
