# Masko Code → Tauri v2 Windows Port

**Created:** 2026-03-26
**Status:** Planning
**Scope:** Port macOS Swift desktop app to Windows using Tauri v2 (Rust + Web frontend)

## Tech Stack Decision

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | Tauri v2 | Rust backend + WebView2. Small binary, native feel |
| Frontend | SolidJS + TypeScript | Smallest bundle (~7KB), fine-grained reactivity, no virtual DOM overhead. Ideal for overlay perf |
| Styling | Tailwind CSS | Utility-first, small bundle with purge, matches existing brand colors |
| Animation | HTML5 `<video>` + WebM VP9 alpha | Mascot configs already include `.webm` URLs. Native browser support in WebView2 |
| State | SolidJS signals + stores | Built-in reactivity, no extra library needed |
| HTTP Server | Rust `axum` (embedded) | Async, runs alongside Tauri event loop on Tokio |
| Global Hotkeys | `tauri-plugin-global-shortcut` + custom Win32 | Plugin for simple shortcuts, Win32 raw input for double-tap detection |
| Auto-Update | `tauri-plugin-updater` | Built-in Tauri solution |

## Implementation Phases

| # | Phase | Status | Details |
|---|-------|--------|---------|
| 01 | [Project scaffolding](phase-01-project-scaffolding.md) | Pending | Tauri v2 project init, deps, config |
| 02 | [Core models & state](phase-02-core-models-state.md) | Pending | TypeScript models, stores, event types |
| 03 | [Rust HTTP server](phase-03-rust-http-server.md) | Pending | Axum server on port 45832, hook routes |
| 04 | [Hook installer (Windows)](phase-04-hook-installer.md) | Pending | PowerShell/batch hook script, settings.json registration |
| 05 | [Overlay window & mascot animation](phase-05-overlay-window.md) | Pending | Transparent always-on-top window, WebM video playback |
| 06 | [Animation state machine](phase-06-state-machine.md) | Pending | Port OverlayStateMachine logic to TypeScript |
| 07 | [Permission UI](phase-07-permission-ui.md) | Pending | Speech bubbles, approve/deny/collapse, question answering |
| 08 | [System tray](phase-08-system-tray.md) | Pending | Tray icon, context menu, show/hide |
| 09 | [Global hotkeys](phase-09-global-hotkeys.md) | Pending | Win+M toggle, Win+1-9 select, double-tap detection |
| 10 | [Dashboard window](phase-10-dashboard.md) | Pending | Session list, notifications, activity feed, settings |
| 11 | [Auto-update & packaging](phase-11-auto-update.md) | Pending | Updater plugin, MSI/NSIS installer, CI/CD |

## Key Architectural Decisions

1. **WebM over HEVC** — Mascot configs already ship both formats. WebM VP9 alpha is natively supported in WebView2/Chromium. No need for PixiJS/Canvas.
2. **Axum in Rust** — Embedded HTTP server runs on same Tokio runtime as Tauri. Handles `/hook`, `/input`, `/install`, `/health`.
3. **SolidJS** — Lightweight reactive framework. Perfect for overlay (small bundle, fast updates). No React overhead.
4. **Win32 for hotkeys** — `tauri-plugin-global-shortcut` covers basic shortcuts. Custom Rust Win32 hooks for double-tap Cmd(→Win) detection.
5. **PowerShell hook script** — Windows equivalent of bash hook-sender.sh. Curls events to localhost.

## Dependencies

- Rust 1.75+, Node.js 18+, Tauri CLI v2
- `axum` + `tokio` (HTTP server)
- `tauri-plugin-global-shortcut`, `tauri-plugin-updater`, `tauri-plugin-notification`
- `window-vibrancy` (optional acrylic effect)
- SolidJS, Tailwind CSS, Vite

## Reports

- [Scout Report](scout/scout-01-report.md) — Full codebase architecture analysis
- [Research: Tauri v2 Windows](research/researcher-01-report.md) — Transparency, hotkeys, click-through
- [Research: Frontend Stack](research/researcher-02-report.md) — Framework comparison, animation approaches

## Unresolved Questions

1. **Click-through transparency** — Tauri v2 `setIgnoreCursorEvents()` is all-or-nothing. Need Win32 `WS_EX_TRANSPARENT` workaround or accept non-click-through overlay.
2. **Terminal focus on Windows** — No AppleScript equivalent. Win32 `SetForegroundWindow` + `EnumWindows` to find terminal by PID. Limited compared to macOS.
3. **Hook script on Windows** — PowerShell vs batch. PowerShell has better JSON handling but slower startup. Batch is faster but more limited.
4. **Double-tap Win key** — Windows key is special (opens Start menu). May need to use Ctrl or Alt instead, or intercept via low-level keyboard hook.
