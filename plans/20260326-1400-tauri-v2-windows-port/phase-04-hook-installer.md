# Phase 04: Hook Installer (Windows)

## Context
- Parent: [plan.md](plan.md)
- Dependencies: Phase 03 (server must be running)
- Reference: `Sources/Services/HookInstaller.swift`

## Overview
- **Date:** 2026-03-26
- **Priority:** Critical
- **Status:** Pending
- **Review:** Not started
- **Description:** Create Windows-compatible hook script and installer that registers hooks in `~/.claude/settings.json`.

## Key Insights
- macOS version uses bash script at `~/.masko-desktop/hooks/hook-sender.sh`
- Windows needs PowerShell script (or batch file) equivalent
- Same `~/.claude/settings.json` hook format — Claude Code is cross-platform
- Hook script must: check health endpoint, forward JSON, handle PermissionRequest blocking
- Process tree walking for terminal PID detection differs on Windows

## Requirements
- PowerShell hook script at `%USERPROFILE%\.masko-desktop\hooks\hook-sender.ps1`
- Hook entries registered in `%USERPROFILE%\.claude\settings.json`
- Script handles both fire-and-forget and blocking (PermissionRequest) modes
- Terminal PID detection via Windows process tree

## Architecture

```
Claude Code Hook System:
~/.claude/settings.json
  └─ hooks.SessionStart[].hooks[].command = "powershell -NoProfile -File ~/.masko-desktop/hooks/hook-sender.ps1"

Hook Script Execution:
Claude Code fires hook → stdin JSON → hook-sender.ps1 → curl POST to localhost:45832/hook
```

## Related Code Files

### Create:
- `src-tauri/src/hook_installer.rs` — Rust module for hook registration
- Template for `hook-sender.ps1` — PowerShell hook script (embedded in binary)

### Reference:
- `Sources/Services/HookInstaller.swift` — Hook registration logic, script template

## Implementation Steps

1. Create PowerShell hook script template:
   ```powershell
   # hook-sender.ps1 — Forwards Claude Code hook events to masko-desktop
   $ErrorActionPreference = 'SilentlyContinue'

   # Check if server is running
   try {
     $null = Invoke-WebRequest -Uri "http://localhost:$PORT/health" -TimeoutSec 1 -UseBasicParsing
   } catch { exit 0 }

   # Read JSON from stdin
   $input = [Console]::In.ReadToEnd()
   $eventName = ($input | ConvertFrom-Json).hook_event_name

   # Inject terminal PID (walk process tree)
   $curPid = $PID
   # ... Windows process tree walking via Get-CimInstance Win32_Process

   if ($eventName -eq "PermissionRequest") {
     # Blocking: wait for response
     $response = Invoke-WebRequest -Method POST -Uri "http://localhost:$PORT/hook" `
       -Body $input -ContentType "application/json" -TimeoutSec 120 -UseBasicParsing
     Write-Output $response.Content
     if ($response.StatusCode -eq 403) { exit 2 }
   } else {
     # Fire-and-forget
     Invoke-WebRequest -Method POST -Uri "http://localhost:$PORT/hook" `
       -Body $input -ContentType "application/json" -TimeoutSec 2 -UseBasicParsing | Out-Null
   }
   ```

2. Implement `hook_installer.rs`:
   - Read/write `%USERPROFILE%\.claude\settings.json`
   - Same hook event list as Swift (19 events)
   - Hook command: `powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.masko-desktop\hooks\hook-sender.ps1"`
   - Version tracking to auto-update script

3. Create Tauri commands:
   ```rust
   #[tauri::command]
   fn install_hooks() -> Result<(), String>

   #[tauri::command]
   fn uninstall_hooks() -> Result<(), String>

   #[tauri::command]
   fn is_hooks_registered() -> bool
   ```

4. Alternative: batch script for faster startup:
   - PowerShell has ~200ms startup overhead
   - Consider hybrid: batch launcher that calls PowerShell only for PermissionRequest
   - Or use curl.exe directly from batch for simple events

## Todo
- [ ] Create PowerShell hook script template
- [ ] Implement Windows process tree walking for terminal PID
- [ ] Implement hook_installer.rs (register/unregister hooks)
- [ ] Create Tauri commands for hook management
- [ ] Handle script versioning and auto-update
- [ ] Test with Claude Code on Windows
- [ ] Consider batch file alternative for perf

## Success Criteria
- Hooks registered in `~/.claude/settings.json` after install
- Claude Code events arrive at Rust HTTP server
- PermissionRequest events block until user decides
- Terminal PID correctly detected

## Risk Assessment
- **PowerShell execution policy** — Some systems restrict scripts. Use `-ExecutionPolicy Bypass` flag.
- **PowerShell startup time** — ~200ms overhead per hook invocation. May cause noticeable latency.
- **PATH issues** — `curl.exe` may not be available on all Windows versions. Use `Invoke-WebRequest` instead.

## Security Considerations
- Script runs with user permissions only
- No elevation required
- Hook command path is absolute to prevent injection

## Next Steps
→ Phase 05: Overlay Window & Mascot Animation
