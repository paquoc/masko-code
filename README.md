<p align="center">
  <img src="src/assets/images/app-icon.png" width="128" />
</p>

<h1 align="center">Masko Code</h1>

<p align="center">
  A living mascot that floats above your windows, reacts to Claude Code, and lets you handle everything without leaving your flow.
</p>

<p align="center">
  <a href="https://github.com/paquoc/masko-code/releases/latest"><img src="https://img.shields.io/github/v/release/paquoc/masko-code?style=flat-square&color=f95d02" alt="Release" /></a>
  <img src="https://img.shields.io/badge/Windows-11%2B-0078D4?style=flat-square&logo=windows" alt="Windows 11+" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" />
</p>

<p align="center">
  <a href="https://github.com/paquoc/masko-code/releases/latest"><strong>Download</strong></a>
</p>

---

## Demo

<p align="center">
  <video src="https://github.com/paquoc/masko-code/raw/main/demos/demo.mp4" controls width="720"></video>
</p>

> If the video doesn't play inline, [watch it here](demos/demo.mp4).

## Features

| | Feature | Description |
|---|---|---|
| 🎭 | **Animated overlay** | A mascot that floats above all windows and reacts to Claude Code state — click or hover to interact |
| 🔐 | **Permission handling** | Approve, deny, or defer tool use requests from a speech bubble — permissions stack in a queue |
| 🔄 | **Auto-updates** | Automatically checks, downloads, and installs updates on launch |
| 🖥️ | **System tray** | Lives in the system tray, no taskbar clutter |

## How It Works

```
┌──────────────────────────────┐   hook events   ┌────────────────┐
│           Claude             │ ──────────────▶ │     Masko      │
│  (terminal/extension/app)    │                 │  (system tray) │
└──────────────────────────────┘                 └────────────────┘
        │                                   │
        │  streams events from hooks        │  updates mascot animation,
        │                                   │  shows permission prompts,
        │                                   │  tracks sessions
        ▼                                   ▼
   ~/.claude/settings.json          local HTTP :45832
```

1. **Install the app** — Run the installer or use the one-liner below.
2. **Hooks are auto-configured** — First launch installs Claude Code hooks into `~/.claude/settings.json`.
3. **Pick a mascot** — Choose the default Masko or bring your own from [masko.ai](https://masko.ai).
4. **Start coding** — Open Claude Code. Your mascot springs to life.

## Requirements

- Windows 11 (or Windows 10 1803+)
- WebView2 runtime (pre-installed on Windows 11)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed

## Install

**One-liner (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/paquoc/masko-code/main/scripts/install.ps1 | iex
```

Or download the `.exe` installer manually from [**Releases**](https://github.com/paquoc/masko-code/releases/latest).

> Both methods install the NSIS version which includes **auto-updates** — the app updates itself on launch.

## Build from Source

```bash
git clone https://github.com/paquoc/masko-code.git
cd masko-code
npm install
npm run tauri dev       # development with hot-reload
npm run tauri build     # production NSIS installer → src-tauri/target/release/bundle/nsis/
```

Prerequisites: [Rust](https://rustup.rs/), [Node.js 18+](https://nodejs.org/), [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) with C++ workload.

## Project Structure

```
├── src/                    # SolidJS frontend
│   ├── models/             # TypeScript interfaces
│   ├── stores/             # SolidJS reactive stores
│   ├── services/           # Event processor, state machine, IPC
│   ├── components/         # UI components (overlay, dashboard)
│   └── assets/             # Fonts, images, bundled mascot configs
├── src-tauri/              # Rust backend
│   └── src/
│       ├── server.rs       # Axum HTTP server (port 45832)
│       ├── hook_installer.rs # Hook script + settings.json management
│       ├── tray.rs         # System tray
│       └── commands.rs     # Tauri IPC commands
└── scripts/                # Install & version bump scripts
```

## Custom Mascots

The default Masko fox is included. Want your own character? Create one on [masko.ai](https://masko.ai) with AI-generated animations for every state (idle, working, attention). Export and load it into the desktop app.

## License

[MIT License](LICENSE) — Copyright (c) 2026 Masko.

---

> **Note:** This project has no cryptocurrency or token associated with it. Any coin using the Masko or Clippy name is not affiliated with us.
