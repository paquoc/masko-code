<p align="center">
  <img src="Sources/Resources/Images/app-icon.png" width="128" />
</p>

<h1 align="center">Masko Code</h1>

<p align="center">
  A living mascot that floats above your windows, reacts to Claude Code and Codex, and lets you handle everything without leaving your flow.
</p>

<p align="center">
  <a href="https://github.com/paquoc/masko-code/releases/latest"><img src="https://img.shields.io/github/v/release/paquoc/masko-code?style=flat-square&color=f95d02" alt="Release" /></a>
  <img src="https://img.shields.io/badge/macOS-14.0%2B-black?style=flat-square&logo=apple" alt="macOS 14+" />
  <img src="https://img.shields.io/badge/Windows-11%2B-0078D4?style=flat-square&logo=windows" alt="Windows 11+" />
  <img src="https://img.shields.io/badge/Universal-arm64%20%2B%20x86__64-black?style=flat-square" alt="Universal Binary" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" />
</p>

<p align="center">
  <a href="https://github.com/paquoc/masko-code/releases/latest"><strong>Download</strong></a> · <a href="https://masko.ai/claude-code"><strong>Website</strong></a> · <a href="https://masko.ai"><strong>Custom Mascots</strong></a>
</p>

---

<!-- Add a screenshot or GIF here: ![Screenshot](docs/screenshot.png) -->

## Features

| | Feature | Description |
|---|---|---|
| 🎭 | **Animated overlay** | A mascot that floats above all windows and reacts to Claude Code + Codex state — click or hover to interact |
| 🔐 | **Permission handling** | Approve, deny, or defer tool use requests from a speech bubble — select with `⌘1-9`, permissions stack in a queue |
| 💬 | **Question answering** | Answer Claude's questions directly from the overlay |
| 📋 | **Plan review** | Review and approve plans without opening your terminal |
| 📊 | **Session tracking** | Monitor active sessions, subagents, and status at a glance |
| 🔔 | **Notification dashboard** | Priority levels, resolution tracking, color-coded activity feed |
| 🖥️ | **Find the right terminal** | Jump to the correct terminal tab — supports 13 terminals and IDEs including iTerm2, Ghostty, VS Code, Cursor, and more |
| 🔀 | **Session switcher** | Double-tap `⌘` to switch between assistant sessions |
| 😴 | **Snooze** | Right-click to hide the mascot for 15 min, 1 hour, or indefinitely |
| ↔️ | **Resizable** | Drag to resize or pick a preset (S / M / L / XL) from the context menu |
| 🔄 | **Auto-updates** | Built-in Sparkle updates — always on the latest version |

## How It Works

```
┌─────────────┐     hook events     ┌─────────────┐
│ Claude/Codex │ ──────────────────▶ │    Masko     │
│  (terminal)  │                     │  (menu bar)  │
└─────────────┘                     └─────────────┘
        │                                   │
        │  streams events from hooks/logs,  │  updates mascot animation,
        │  sessions, notifications          │  shows permission prompts,
        │                                   │  tracks sessions
        ▼                                   ▼
   ~/.claude/settings.json          local HTTP :49152
```

1. **Download the app** — Install the DMG. Lives in your menu bar, no dock clutter.
2. **Grant accessibility** — First launch installs Claude Code hooks automatically into `~/.claude/settings.json`.
3. **Pick a mascot** — Choose the default Masko or bring your own from [masko.ai](https://masko.ai).
4. **Start coding** — Open Claude Code or Codex (CLI/Desktop). Your mascot springs to life.

## Keyboard Shortcuts

All shortcuts work globally — no need to focus the app.

| Shortcut | Action |
|---|---|
| `⌘M` | Toggle dashboard (customizable in Settings) |
| `⌘1-9` | Select Nth pending permission |
| `⌘Enter` | Approve selected permission |
| `⌘Esc` | Deny / dismiss permission |
| `⌘L` | Collapse / defer topmost permission |
| `Double-tap ⌘` | Open session switcher (2+ sessions) |
| `↑ / ↓` | Navigate session switcher |
| `Tab / Shift+Tab` | Cycle sessions |
| `Enter` | Confirm session selection |
| `Esc` | Close session switcher |

The focus toggle shortcut can be rebound to any key combination in Settings.

Right-click the mascot to open the **context menu** — snooze, resize, or close the overlay.

## Custom Mascots

The default Masko fox is included. Want your own character? Create one on [masko.ai](https://masko.ai) with AI-generated animations for every state (idle, working, attention). Export and load it into the desktop app in one click.

## Supported Terminals & IDEs

Masko works with terminals that run Claude Code or Codex. Terminal focus (`⌘M`) support varies by app:

| Level | App | How |
|---|---|---|
| **Exact tab** | VS Code, VS Code Insiders, Cursor, Windsurf, Antigravity | IDE extension (auto-installed) |
| **Exact tab** | iTerm2, Terminal.app | AppleScript TTY matching |
| **App focus** | Ghostty, Kitty, WezTerm, Alacritty, Warp, Zed | Process activation |

Click a session in the dashboard or click the mascot overlay to jump to the right terminal.

## Requirements

**macOS:**
- macOS 14.0+ (Sonoma)
- Apple Silicon or Intel Mac

**Windows:**
- Windows 11 (or Windows 10 1803+)
- WebView2 runtime (pre-installed on Windows 11)

**Both platforms:**
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and/or [Codex CLI](https://github.com/openai/codex) installed

## Install

**macOS:** Download the latest `.dmg` from [**Releases**](https://github.com/paquoc/masko-code/releases/latest).

**Windows (one-liner):**
```powershell
irm https://raw.githubusercontent.com/paquoc/masko-code/main/scripts/install.ps1 | iex
```

This downloads the latest release, runs the installer, writes the hook script, and registers all Claude Code hooks in `~/.claude/settings.json` automatically.

Or download the `.exe` installer manually from [**Releases**](https://github.com/paquoc/masko-code/releases/latest).

## Build from Source

**macOS (Swift):**
```bash
git clone https://github.com/paquoc/masko-code.git
cd masko-code
swift build
swift run
```

**Windows (Tauri v2):**
```bash
git clone https://github.com/paquoc/masko-code.git
cd masko-code/masko-windows
npm install
npm run tauri dev       # development with hot-reload
npm run tauri build     # production NSIS installer → src-tauri/target/release/bundle/nsis/
```

Prerequisites: [Rust](https://rustup.rs/), [Node.js 18+](https://nodejs.org/), [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) with C++ workload.

## Local Codex Smoke Test

Boot Masko from source in one terminal:

```bash
swift run masko-code
```

Run a live Codex mascot flow in another terminal:

```bash
scripts/codex-mascot-smoke.sh --manual
```

Run the automated 3-step integration check instead:

```bash
scripts/codex-mascot-smoke.sh --auto
```

The automated mode verifies that Masko ingests:
- a Codex question turn as `AskUserQuestion`
- an escalated approval turn with a persistent `prefix_rule` suggestion
- the final completion marker without blank notifications or question-only completion events

The automated mode drives Codex through its own PTY and verifies Masko ingestion. Use `--manual` if you want to inspect the overlay yourself while the prompts are live.

## Project Structure

**macOS (Swift):**
```
Sources/
├── App/             # App entry point & lifecycle
├── Models/          # Data models (sessions, events, hooks)
├── Services/        # HTTP server, hook installer, update checker
├── Stores/          # Observable state (sessions, notifications)
├── Views/           # SwiftUI views (overlay, permission prompt, dashboard)
├── Utilities/       # Helpers
└── Resources/       # Assets, images, app icon
scripts/             # DMG packaging scripts
extensions/
├── vscode/          # VS Code/Cursor click-to-focus extension
└── jetbrains/       # JetBrains (PyCharm, IntelliJ, etc.) terminal focus plugin
```

**Windows (Tauri v2):**
```
masko-windows/
├── src/                    # SolidJS frontend
│   ├── models/             # TypeScript interfaces (ported from Swift)
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
└── plans/                  # Implementation plan & research
```

## Windows Port Status

The Windows version is built with **Tauri v2** (Rust + SolidJS + WebView2). Current progress:

| Phase | Status | Description |
|-------|--------|-------------|
| Project scaffolding | Done | Tauri v2 + SolidJS + Tailwind CSS v4 |
| Core models & state | Done | All Swift models/stores ported to TypeScript |
| HTTP server | Done | Axum on port 45832, permission connection holding |
| Hook installer | Done | Bash hook script, auto-install into `~/.claude/settings.json` |
| Overlay window | Done | Transparent always-on-top window, WebM VP9 alpha video |
| Animation state machine | Done | Full port (280 lines), condition evaluation, Any State edges |
| System tray | Done | Tray icon + context menu |
| Permission UI | Pending | Speech bubbles, approve/deny, question answering |
| Global hotkeys | Pending | Ctrl+M toggle, Ctrl+1-9 select, double-tap Ctrl |
| Dashboard | Partial | Basic layout, needs full session/notification views |
| Auto-update & packaging | Pending | NSIS installer, updater plugin |

See [plans/20260326-1400-tauri-v2-windows-port/plan.md](plans/20260326-1400-tauri-v2-windows-port/plan.md) for the full implementation plan.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get involved.

## License

[MIT License](LICENSE) — Copyright (c) 2026 Masko.

---

> **Note:** This project has no cryptocurrency or token associated with it. Any coin using the Masko or Clippy name is not affiliated with us.
