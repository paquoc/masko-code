# Phase 05: Overlay Window & Mascot Animation

## Context
- Parent: [plan.md](plan.md)
- Dependencies: Phase 01, Phase 02
- Reference: `Sources/Views/Overlay/OverlayManager.swift`, `Sources/Views/Shared/MascotVideoView.swift`

## Overview
- **Date:** 2026-03-26
- **Priority:** Critical
- **Status:** Pending
- **Review:** Not started
- **Description:** Create the floating transparent overlay window with mascot video animation. This is the core visual feature — the animated character that floats above all windows.

## Key Insights
- macOS uses NSPanel (non-activating) + AVPlayer with HEVC alpha channel
- Tauri v2: frameless + transparent + alwaysOnTop window
- **WebM VP9 alpha** already exists in mascot configs — use HTML5 `<video>` element
- WebView2 (Chromium-based) supports WebM VP9 alpha natively
- Window must NOT steal focus when clicked (non-activating behavior)
- Draggable via custom drag region, resizable via handle

## Requirements
- Transparent frameless window floating above all other windows
- WebM video playback with alpha transparency (transparent background)
- Smooth loop playback, transition between videos
- Draggable by clicking on the mascot
- Resizable with handle (S/M/L/XL presets)
- No taskbar icon for overlay window
- Does not steal focus from other apps

## Architecture

```
Overlay Window (Tauri)
├── transparent: true
├── decorations: false
├── alwaysOnTop: true
├── skipTaskbar: true
└── WebView Content:
    ├── <video> element (WebM VP9 alpha)
    ├── CSS: background transparent, pointer-events zones
    └── Drag region (data-tauri-drag-region)
```

## Related Code Files

### Create:
- `src/components/overlay/MascotOverlay.tsx` — Main overlay component
- `src/components/overlay/MascotVideo.tsx` — Video player component
- `src/components/overlay/ResizeHandle.tsx` — Drag-to-resize handle
- `src/overlay.html` — Separate HTML entry for overlay window
- `src/overlay-entry.tsx` — SolidJS entry for overlay window

### Modify:
- `src-tauri/tauri.conf.json` — Add overlay window config
- `src-tauri/src/commands.rs` — Window management commands

### Reference:
- `Sources/Views/Overlay/OverlayManager.swift` — Panel lifecycle
- `Sources/Views/Shared/MascotVideoView.swift` — AVPlayer setup
- `Sources/Views/Overlay/OverlayMascotView.swift` — Mascot view
- `Sources/Views/Overlay/ResizeHandleView.swift` — Resize UI

## Implementation Steps

1. Configure overlay window in `tauri.conf.json`:
   ```json
   {
     "label": "overlay",
     "url": "overlay.html",
     "width": 200,
     "height": 200,
     "decorations": false,
     "transparent": true,
     "alwaysOnTop": true,
     "skipTaskbar": true,
     "resizable": false,
     "focus": false
   }
   ```

2. Create overlay HTML entry point with transparent background:
   ```html
   <html style="background: transparent;">
   <body style="background: transparent; margin: 0; overflow: hidden;">
   <div id="root"></div>
   </body></html>
   ```

3. Create MascotVideo component:
   ```tsx
   function MascotVideo(props: { url: string; loop: boolean; playbackRate: number }) {
     let videoRef: HTMLVideoElement;
     return (
       <video
         ref={videoRef!}
         src={props.url}
         autoplay
         loop={props.loop}
         muted
         playsinline
         style={{ background: 'transparent', width: '100%', height: '100%', 'object-fit': 'contain' }}
         playbackRate={props.playbackRate}
         onEnded={() => !props.loop && onVideoEnded()}
       />
     );
   }
   ```

4. Implement drag support using `data-tauri-drag-region` attribute or `appWindow.startDragging()`

5. Implement resize:
   - Resize handle in corner
   - Size presets: S(100px), M(150px), L(200px), XL(300px)
   - Persist size to localStorage
   - Call Tauri `setSize()` API

6. Handle window focus prevention:
   - Tauri v2 has `focus: false` config
   - Additional: `setIgnoreCursorEvents(true)` on transparent areas (if supported)
   - Fallback: accept that clicking mascot activates the window briefly

7. Video caching:
   - Remote videos from assets.masko.ai need local caching
   - Use Tauri FS plugin or Rust-side download + cache in app data dir
   - Create Tauri command: `cache_video(url) -> local_path`

## Todo
- [ ] Configure overlay window in tauri.conf.json
- [ ] Create overlay HTML entry point
- [ ] Create MascotVideo component with WebM playback
- [ ] Implement drag support (startDragging)
- [ ] Implement resize handle + size presets
- [ ] Implement video caching (Rust-side download)
- [ ] Handle focus prevention
- [ ] Test WebM VP9 alpha transparency on Windows 11
- [ ] Test video loop/transition playback

## Success Criteria
- Transparent window floats above all apps
- WebM video plays with alpha transparency (see-through background)
- Mascot is draggable to any screen position
- Resizable with smooth video scaling
- Does not appear in taskbar

## Risk Assessment
- **WebM alpha in WebView2** — Should work (Chromium supports VP9 alpha). Need to verify on Windows 10 builds.
- **Focus stealing** — Tauri windows may steal focus on click. May need Win32 `WS_EX_NOACTIVATE` via plugin.
- **Video performance** — Multiple transparent videos may impact GPU. Monitor performance.
- **Click-through** — Transparent areas won't pass mouse events to apps behind. This is a known Tauri limitation.

## Security Considerations
- Video URLs from untrusted mascot configs should be validated (HTTPS only)
- Local cache directory should not be world-writable

## Next Steps
→ Phase 06: Animation State Machine
