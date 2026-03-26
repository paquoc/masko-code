# Scout Report: Masko Code Codebase Architecture

## Project Overview
macOS Swift desktop app — floating mascot overlay reacting to AI agent events (Claude Code, Codex, Copilot). Menu bar app with overlay panel, system tray, local HTTP server.

## Architecture Layers

### 1. App Layer (`Sources/App/`)
- `MaskoDesktopApp.swift` — Entry point. SwiftUI App with WindowGroup + MenuBarExtra + Settings. Wires AppStore → OverlayManager. Handles `masko://install/` URL scheme.
- `ContentView.swift` — Main dashboard window.

### 2. Adapters (`Sources/Adapters/`)
- `AgentAdapter.swift` — Protocol: `isAvailable()`, `isRegistered()`, `install()`, `start()`, `stop()`, callbacks for events/permissions/inputs.
- `ClaudeCodeAdapter.swift` — Owns LocalServer, HookInstaller. HTTP-based event ingestion.
- `CodexAdapter.swift` — Log-file-based event ingestion (monitors Codex log files).
- `CopilotAdapter.swift` — Copilot integration.
- `HookConnectionTransport.swift` — ResponseTransport impl for Claude Code (holds NWConnection open for permission response).
- `TerminalFallbackTransport.swift` — Codex fallback transport (types into terminal).

### 3. Models (`Sources/Models/`)
- `AgentEvent.swift` — Core event model. Fields: hookEventName, sessionId, toolName, toolInput, message, permissionSuggestions, terminalPid, etc.
- `HookEventType.swift` — 19 event types: SessionStart/End, PreToolUse, PostToolUse, PermissionRequest, Stop, SubagentStart/Stop, Notification, PreCompact, PostCompact, etc.
- `MaskoCollection.swift` — Animation config model: nodes, edges, conditions, videos (hevc+webm URLs), inputs (boolean/number/trigger).
- `ResponseTransport.swift` — Protocol for responding to permission requests.
- `AgentSource.swift` — Enum: claudeCode, codex, copilot.
- `AnyCodable.swift` — Type-erased Codable wrapper.
- `AppNotification.swift` — Notification model with categories and priorities.
- `ApprovalRecord.swift` — History of approval decisions.

### 4. Services (`Sources/Services/`)
- `LocalServer.swift` — NWListener TCP server on port 45832. Routes: GET /health, POST /hook, POST /input, POST /install. Permission requests hold connection open.
- `HookInstaller.swift` — Installs bash hook script to `~/.masko-desktop/hooks/hook-sender.sh`. Registers hooks in `~/.claude/settings.json`.
- `EventProcessor.swift` — Routes AgentEvents → EventStore + SessionStore + NotificationStore.
- `OverlayStateMachine.swift` — JSON-driven animation graph engine. Inputs → condition evaluation → node transitions → video playback. Supports "Any State" edges with priority.
- `GlobalHotkeyManager.swift` — CGEvent tap for system-wide shortcuts. Cmd+M (toggle focus), Cmd+1-9 (select), Cmd+Enter (confirm), Cmd+Esc (dismiss), double-tap Cmd (session switcher).
- `MaskoEventBus.swift` — Registers adapters, routes events to callbacks.
- `NotificationService.swift` — macOS UNUserNotificationCenter.
- `VideoCache.swift` — Downloads and caches remote videos locally.
- `ExtensionInstaller.swift` — Installs VS Code/JetBrains extensions for terminal focus.
- `CodexEventMapper.swift` — Maps Codex log entries to AgentEvents.
- `CodexSessionMonitor.swift` — Watches Codex log files for events.

### 5. Stores (`Sources/Stores/`)
- `AppStore.swift` — Central coordinator. Owns all stores + adapters. Wires event flow + hotkey callbacks.
- `SessionStore.swift` — Tracks active/ended sessions. AgentSession model: id, projectDir, status, phase, eventCount, subagentCount, terminalPid.
- `PendingPermissionStore.swift` — Queue of pending permission requests with collapse/expand. PermissionSuggestion model for "always allow" rules.
- `NotificationStore.swift` — Notification feed.
- `EventStore.swift` — Recent event history.
- `MascotStore.swift` — Manages saved mascots, bundled defaults, community downloads.
- `SessionSwitcherStore.swift` — Session picker overlay state.
- `SessionFinishedStore.swift` — "Task completed" toast state.
- `ApprovalHistoryStore.swift` — Persisted approval decisions.
- `PermissionInteractionState.swift` — UI state for permission card interactions.

### 6. Views (`Sources/Views/`)
- **Overlay/** — OverlayManager (NSPanel lifecycle), OverlayMascotView, PermissionPromptView, ExpandedPermissionView, SessionSwitcherView, StatsOverlayView, SessionFinishedToast, ResizeHandleView.
- **MenuBar/** — MenuBarView (system tray menu).
- **Masko/** — MaskoDashboardView, MascotDetailView.
- **Sessions/** — SessionListView.
- **Notifications/** — NotificationCenterView.
- **Approvals/** — ApprovalRequestView.
- **Settings/** — SettingsView.
- **Onboarding/** — OnboardingView.
- **Shared/** — MascotVideoView (AVPlayer+HEVC alpha), AgentSourceBadge.
- **ActivityFeed/** — ActivityFeedView.

### 7. Utilities (`Sources/Utilities/`)
- `Constants.swift` — Server port, brand colors, typography, layout constants.
- `IDETerminalFocus.swift` — Focus terminal by PID (AppleScript for iTerm2/Terminal, NSRunningApplication for others).
- `SkyLightOperator.swift` — Private SkyLight framework for window ordering.
- `BrandStyles.swift` — Shared UI styles.
- `LocalStorage.swift` — UserDefaults wrapper.
- `TimeFormatting.swift` — Date formatting helpers.
- `CodexInteractiveBridge.swift` — Bridge for Codex interactive mode.

### 8. Resources (`Sources/Resources/`)
- `Defaults/` — Bundled mascot configs: clippy.json, cupidon.json, masko.json, nugget.json, otto.json, rusty.json, madame-patate.json.
- `Fonts/` — Fredoka (4 weights) + Rubik (3 weights) TTF files.
- `Images/` — app-icon.png, logo.png.
- `Extensions/` — masko-terminal-focus.vsix, masko-terminal-focus-jetbrains.zip.

## Key Technical Details

### Video Format
- HEVC (.mov) with alpha channel for macOS (AVPlayer)
- WebM (.webm) with VP9 alpha as fallback — already in mascot config JSON
- Videos hosted on assets.masko.ai CDN

### HTTP Server Protocol
- Port 45832 (was 49152, migrated)
- Routes: `/health` (GET), `/hook` (POST), `/input` (POST), `/install` (POST)
- PermissionRequest events hold connection open — response body is the user's decision JSON

### Hook Script (bash)
- Located at `~/.masko-desktop/hooks/hook-sender.sh`
- Walks process tree to find terminal PID
- PermissionRequest: blocking curl (waits for user decision)
- Other events: fire-and-forget curl

### State Machine
- JSON config: nodes (states), edges (transitions), conditions (input comparisons)
- Inputs: agent:: prefixed (isWorking, isIdle, isAlert, isCompacting, sessionCount), UI triggers (clicked, mouseOver, loopCount, nodeTime)
- Any State edges: source="*", priority-sorted, override normal transitions

## macOS-Specific APIs to Replace
1. `NSPanel` (non-activating overlay) → Tauri window with `alwaysOnTop`, non-focusable
2. `NWListener` (TCP server) → Rust HTTP server (axum/hyper)
3. `CGEvent tap` (global hotkeys) → tauri-plugin-global-shortcut + Win32 hooks
4. `AVPlayer` + HEVC alpha → HTML5 `<video>` with WebM VP9 alpha
5. `MenuBarExtra` (system tray) → Tauri tray-icon
6. `Sparkle` (auto-update) → tauri-plugin-updater
7. `UNUserNotificationCenter` → Windows toast notifications
8. `AppleScript`/`NSRunningApplication` (terminal focus) → Win32 window management
9. `UserDefaults` → Tauri app data / localStorage
10. `SkyLight` framework → Not needed (Win32 handles window ordering)
