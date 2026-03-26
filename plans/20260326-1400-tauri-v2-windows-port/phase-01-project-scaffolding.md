# Phase 01: Project Scaffolding

## Context
- Parent: [plan.md](plan.md)
- Dependencies: None (first phase)
- Docs: [Tauri v2 Prerequisites](https://v2.tauri.app/start/prerequisites/)

## Overview
- **Date:** 2026-03-26
- **Priority:** Critical
- **Status:** Pending
- **Review:** Not started
- **Description:** Initialize Tauri v2 project with SolidJS frontend, configure build tooling, set up project structure.

## Key Insights
- Tauri v2 uses `tauri.conf.json` for window config, capabilities for permissions
- SolidJS + Vite is the recommended lightweight frontend setup
- Windows requires MSVC Rust toolchain + WebView2 runtime

## Requirements
- Tauri v2 project compiles and runs on Windows 11
- SolidJS frontend renders in WebView2
- Tailwind CSS configured for styling
- Project structure mirrors Swift app's architecture layers

## Architecture

```
masko-windows/
├── src/                          # SolidJS frontend
│   ├── app.tsx                   # Main entry
│   ├── models/                   # TypeScript interfaces
│   ├── stores/                   # SolidJS stores (reactive state)
│   ├── services/                 # IPC wrappers, event processing
│   ├── components/               # UI components
│   │   ├── overlay/              # Mascot overlay, permission bubbles
│   │   ├── dashboard/            # Session list, notifications
│   │   ├── tray/                 # Tray menu content
│   │   └── shared/               # Common components
│   ├── assets/                   # Fonts, images, bundled mascot configs
│   └── styles/                   # Tailwind config, global CSS
├── src-tauri/
│   ├── src/
│   │   ├── main.rs               # Tauri entry point
│   │   ├── lib.rs                # Plugin registration
│   │   ├── server.rs             # Axum HTTP server
│   │   ├── hook_installer.rs     # Hook script management
│   │   ├── commands.rs           # Tauri IPC commands
│   │   └── hotkeys.rs            # Global shortcut management
│   ├── tauri.conf.json           # Tauri config
│   ├── capabilities/
│   │   └── main.json             # Window permissions
│   └── Cargo.toml                # Rust dependencies
├── package.json
├── vite.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

## Related Code Files
- **Create:** All files in `masko-windows/` directory
- **Reference:** `Sources/App/MaskoDesktopApp.swift` (architecture reference)
- **Reference:** `Sources/Utilities/Constants.swift` (brand colors, ports)

## Implementation Steps

1. Create project directory `masko-windows/` at repo root
2. Run `npm create tauri-app@latest` with SolidJS template, or manually scaffold
3. Configure `Cargo.toml` with dependencies:
   ```toml
   [dependencies]
   tauri = { version = "2", features = ["tray-icon"] }
   tauri-plugin-global-shortcut = "2"
   tauri-plugin-updater = "2"
   tauri-plugin-notification = "2"
   axum = "0.8"
   tokio = { version = "1", features = ["full"] }
   serde = { version = "1", features = ["derive"] }
   serde_json = "1"
   uuid = { version = "1", features = ["v4"] }
   window-vibrancy = "0.5"
   ```
4. Configure `tauri.conf.json`:
   - Main window: dashboard (800x600, decorated, not always-on-top)
   - Overlay window: mascot (200x200, frameless, transparent, always-on-top, skip-taskbar)
   - App identifier: `ai.masko.desktop`
5. Set up capabilities: window management, webview creation, notification, global-shortcut
6. Install frontend deps: `solid-js`, `@tauri-apps/api`, `tailwindcss`, `vite`
7. Configure Tailwind with brand colors from Constants.swift
8. Copy bundled assets: fonts (Fredoka, Rubik), images (app-icon, logo), mascot JSON configs
9. Create empty module files for the directory structure above
10. Verify `npm run tauri dev` launches successfully

## Todo
- [ ] Create masko-windows/ directory
- [ ] Initialize Tauri v2 + SolidJS project
- [ ] Configure Cargo.toml with all Rust dependencies
- [ ] Set up tauri.conf.json with overlay + dashboard windows
- [ ] Configure capabilities and permissions
- [ ] Set up Tailwind CSS with brand colors
- [ ] Copy bundled assets (fonts, images, mascot configs)
- [ ] Verify dev server launches

## Success Criteria
- `npm run tauri dev` opens a window on Windows 11
- SolidJS renders "Hello Masko" in WebView2
- Tailwind CSS classes work correctly
- Rust backend compiles without errors

## Risk Assessment
- **WebView2 version**: Older Windows 10 may need manual WebView2 install
- **MSVC toolchain**: Must be installed for Rust compilation on Windows

## Security Considerations
- Capabilities file restricts which APIs each window can access
- No unnecessary permissions granted

## Next Steps
→ Phase 02: Core Models & State
