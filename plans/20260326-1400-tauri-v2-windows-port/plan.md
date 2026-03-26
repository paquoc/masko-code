# Masko Code → Tauri v2 Windows Port

**Created:** 2026-03-26
**Status:** In Progress (Phases 01-08 complete)
**Scope:** Port macOS Swift desktop app to Windows using Tauri v2 (Rust + Web frontend)

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | Tauri v2 | Rust backend + WebView2. Small binary, native feel |
| Frontend | SolidJS + TypeScript | Smallest bundle (~7KB), fine-grained reactivity |
| Styling | Tailwind CSS v4 | Utility-first, brand colors via @theme |
| Animation | HTML5 `<video>` + WebM VP9 alpha | Already in mascot configs, native WebView2 support |
| State | SolidJS signals + stores | Built-in reactivity, no extra deps |
| HTTP Server | Rust `axum` (embedded) | Async on Tokio, same runtime as Tauri |
| Auto-Update | `tauri-plugin-updater` | Built-in Tauri solution |

## Implementation Phases

| # | Phase | Status | Details |
|---|-------|--------|---------|
| 01 | [Project scaffolding](phase-01-project-scaffolding.md) | **Done** | Tauri v2 + SolidJS + Tailwind, dual windows |
| 02 | [Core models & state](phase-02-core-models-state.md) | **Done** | 6 models, 5 stores, event processor, IPC |
| 03 | [Rust HTTP server](phase-03-rust-http-server.md) | **Done** | Axum on port 45832, permission connection holding |
| 04 | [Hook installer](phase-04-hook-installer.md) | **Done** | Bash hook script, auto-install, legacy cleanup |
| 05 | [Overlay window](phase-05-overlay-window.md) | **Done** | Transparent window, WebM video, drag support |
| 06 | [Animation state machine](phase-06-state-machine.md) | **Done** | Full port (280 lines), Any State edges, triggers |
| 07 | [Permission UI](phase-07-permission-ui.md) | Pending | Speech bubbles, approve/deny, question answering |
| 08 | [System tray](phase-08-system-tray.md) | **Done** | Tray icon + context menu (built in Phase 01) |
| 09 | [Global hotkeys](phase-09-global-hotkeys.md) | Pending | Ctrl+M toggle, Ctrl+1-9, double-tap Ctrl |
| 10 | [Dashboard window](phase-10-dashboard.md) | Partial | Basic layout done, needs full views |
| 11 | [Auto-update & packaging](phase-11-auto-update.md) | Pending | NSIS installer, updater plugin, CI/CD |

## Reports

- [Scout Report](scout/scout-01-report.md) — Full codebase architecture analysis
- [Research: Tauri v2 Windows](research/researcher-01-report.md) — Transparency, hotkeys, click-through
- [Research: Frontend Stack](research/researcher-02-report.md) — Framework comparison, animation approaches

## Unresolved Questions

1. **Click-through transparency** — Tauri v2 limitation. Accept non-click-through overlay for now.
2. **Terminal focus on Windows** — Win32 `SetForegroundWindow` has restrictions vs macOS AppleScript.
3. **Double-tap Win key** — Use Ctrl instead (Win key opens Start menu).
