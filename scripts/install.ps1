# install.ps1 — One-line installer for Masko Code on Windows
# Usage: irm https://abeee.vn/install.ps1 | iex
#   or:  irm https://raw.githubusercontent.com/paquoc/masko-code/main/scripts/install.ps1 | iex

$ErrorActionPreference = "Stop"
$REPO = "paquoc/masko-code"
$APP_NAME = "Masko"
$HOOK_PORT = 45832
$HOOK_SCRIPT_VERSION = "# version: 1"

Write-Host ""
Write-Host "  $APP_NAME Code Installer" -ForegroundColor Cyan
Write-Host "  ========================" -ForegroundColor Cyan
Write-Host ""

# --- 1. Detect architecture ---
$arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
Write-Host "[1/4] Detected architecture: $arch" -ForegroundColor Yellow

# --- 2. Download latest release ---
Write-Host "[2/4] Downloading latest release..." -ForegroundColor Yellow

$releaseUrl = "https://api.github.com/repos/$REPO/releases/latest"
try {
    $release = Invoke-RestMethod -Uri $releaseUrl -Headers @{ "User-Agent" = "MaskoInstaller" }
} catch {
    Write-Host "  ERROR: Failed to fetch latest release from GitHub." -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    exit 1
}

$asset = $release.assets | Where-Object { $_.name -match "\.exe$" -and $_.name -match "(?i)setup|install" } | Select-Object -First 1
if (-not $asset) {
    # Fallback: any .exe asset
    $asset = $release.assets | Where-Object { $_.name -match "\.exe$" } | Select-Object -First 1
}
if (-not $asset) {
    Write-Host "  ERROR: No .exe installer found in the latest release." -ForegroundColor Red
    Write-Host "  Please download manually: https://github.com/$REPO/releases/latest" -ForegroundColor Red
    exit 1
}

$installerPath = Join-Path $env:TEMP $asset.name
Write-Host "  Downloading $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $installerPath -UseBasicParsing

# --- 3. Run NSIS installer ---
Write-Host "[3/4] Running installer..." -ForegroundColor Yellow
Write-Host "  Running $($asset.name) — follow the install wizard if prompted."

$proc = Start-Process -FilePath $installerPath -ArgumentList "/S" -PassThru -Wait
if ($proc.ExitCode -ne 0) {
    Write-Host "  Installer exited with code $($proc.ExitCode), trying interactive mode..." -ForegroundColor Yellow
    Start-Process -FilePath $installerPath -Wait
}

# Clean up installer
Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue

# --- 4. Configure Claude Code hooks ---
Write-Host "[4/4] Configuring Claude Code hooks..." -ForegroundColor Yellow

$homeDir = $env:USERPROFILE
$claudeSettingsPath = Join-Path $homeDir ".claude" "settings.json"
$hookScriptDir = Join-Path $homeDir ".masko-desktop" "hooks"
$hookScriptPath = Join-Path $hookScriptDir "hook-sender.sh"

# 4a. Write the hook script (bash, runs via Git Bash)
if (-not (Test-Path $hookScriptDir)) {
    New-Item -ItemType Directory -Path $hookScriptDir -Force | Out-Null
}

$hookScript = @"
#!/bin/bash
$HOOK_SCRIPT_VERSION
# hook-sender.sh — Forwards Claude Code hook events to masko-desktop (Windows)
# Exit instantly if the desktop app server isn't reachable
curl -s --connect-timeout 0.3 "http://localhost:$HOOK_PORT/health" >/dev/null 2>&1 || exit 0

INPUT=`$(cat 2>/dev/null || echo '{}')
EVENT_NAME=`$(echo "`$INPUT" | grep -o '"hook_event_name":"[^"]*"' | head -1 | cut -d'"' -f4)

# Walk up process tree to find terminal PID (Windows: use PowerShell)
TERM_PID=""
SHELL_PID=""
if command -v powershell.exe >/dev/null 2>&1; then
  PIDS=`$(powershell.exe -NoProfile -Command "
    `\`$cur = `$`$`$;
    `\`$terminals = 'Code','Cursor','Windsurf','WindowsTerminal','Claude','pycharm64','idea64','webstorm64','goland64','rider64';
    while (`\`$cur -and `\`$cur -ne 0) {
      `\`$p = Get-CimInstance Win32_Process -Filter \`"ProcessId=`\`$cur\`" -EA 0;
      if (-not `\`$p) { break };
      `\`$par = `\`$p.ParentProcessId;
      `\`$pp = Get-CimInstance Win32_Process -Filter \`"ProcessId=`\`$par\`" -EA 0;
      if (-not `\`$pp) { break };
      `\`$name = [IO.Path]::GetFileNameWithoutExtension(`\`$pp.Name);
      if (`\`$terminals -contains `\`$name) { Write-Output \`"`\`$par `\`$cur\`"; break };
      `\`$cur = `\`$par;
    }
  " 2>/dev/null | tr -d '\r')
  if [ -n "`$PIDS" ]; then
    TERM_PID=`$(echo "`$PIDS" | cut -d' ' -f1)
    SHELL_PID=`$(echo "`$PIDS" | cut -d' ' -f2)
  fi
fi

# Inject terminal_pid and shell_pid into JSON payload
if [ -n "`$TERM_PID" ]; then
  INJECT="\"terminal_pid\":`$TERM_PID"
  [ -n "`$SHELL_PID" ] && INJECT="`$INJECT,\"shell_pid\":`$SHELL_PID"
  INPUT=`$(echo "`$INPUT" | sed "s/}`$/,`$INJECT}/")
fi

if [ "`$EVENT_NAME" = "PermissionRequest" ]; then
    # Blocking: wait for user decision
    TMPFILE=`$(mktemp /tmp/masko-hook.XXXXXX 2>/dev/null || mktemp)
    curl -s -w "\n%{http_code}" -X POST \
      -H "Content-Type: application/json" -d "`$INPUT" \
      "http://localhost:$HOOK_PORT/hook" \
      --connect-timeout 2 >"`$TMPFILE" 2>/dev/null &
    CURL_PID=`$!
    trap 'kill `$CURL_PID 2>/dev/null; rm -f "`$TMPFILE"; exit 0' TERM HUP INT
    wait `$CURL_PID
    RESPONSE=`$(cat "`$TMPFILE")
    rm -f "`$TMPFILE"
    HTTP_CODE=`$(echo "`$RESPONSE" | tail -1)
    BODY=`$(echo "`$RESPONSE" | sed '`$d')
    [ -n "`$BODY" ] && echo "`$BODY"
    [ "`$HTTP_CODE" = "403" ] && exit 2
    exit 0
else
    # Fire-and-forget for all other events
    curl -s -X POST -H "Content-Type: application/json" -d "`$INPUT" \
      "http://localhost:$HOOK_PORT/hook" \
      --connect-timeout 1 --max-time 2 2>/dev/null || true
    exit 0
fi
"@

Set-Content -Path $hookScriptPath -Value $hookScript -Encoding UTF8 -NoNewline
Write-Host "  Hook script written to $hookScriptPath"

# 4b. Register hooks in ~/.claude/settings.json
$hookEvents = @(
    "PreToolUse", "PostToolUse", "PostToolUseFailure",
    "Stop", "StopFailure", "Notification",
    "SessionStart", "SessionEnd", "TaskCompleted",
    "PermissionRequest", "UserPromptSubmit",
    "SubagentStart", "SubagentStop",
    "PreCompact", "PostCompact", "ConfigChange",
    "TeammateIdle", "WorktreeCreate", "WorktreeRemove"
)

$hookCommand = "~/.masko-desktop/hooks/hook-sender.sh"

$claudeDir = Split-Path $claudeSettingsPath -Parent
if (-not (Test-Path $claudeDir)) {
    New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
}

# Read existing settings or create new
if (Test-Path $claudeSettingsPath) {
    $settingsText = Get-Content -Path $claudeSettingsPath -Raw
    try {
        $settings = $settingsText | ConvertFrom-Json
    } catch {
        Write-Host "  WARNING: Could not parse existing settings.json, creating backup." -ForegroundColor Yellow
        Copy-Item -Path $claudeSettingsPath -Destination "$claudeSettingsPath.bak"
        $settings = [PSCustomObject]@{}
    }
} else {
    $settings = [PSCustomObject]@{}
}

# Ensure hooks object exists
if (-not $settings.PSObject.Properties["hooks"]) {
    $settings | Add-Member -MemberType NoteProperty -Name "hooks" -Value ([PSCustomObject]@{})
}

$hookEntry = [PSCustomObject]@{
    matcher = ""
    hooks = @(
        [PSCustomObject]@{
            type = "command"
            command = $hookCommand
        }
    )
}

$modified = $false
foreach ($event in $hookEvents) {
    if (-not $settings.hooks.PSObject.Properties[$event]) {
        $settings.hooks | Add-Member -MemberType NoteProperty -Name $event -Value @()
    }

    $entries = @($settings.hooks.$event)

    # Check if already registered
    $alreadyRegistered = $false
    foreach ($entry in $entries) {
        if ($entry.hooks) {
            foreach ($h in $entry.hooks) {
                if ($h.command -eq $hookCommand) {
                    $alreadyRegistered = $true
                    break
                }
            }
        }
        if ($alreadyRegistered) { break }
    }

    if (-not $alreadyRegistered) {
        $entries += $hookEntry
        $settings.hooks.$event = $entries
        $modified = $true
    }
}

if ($modified) {
    $settings | ConvertTo-Json -Depth 10 | Set-Content -Path $claudeSettingsPath -Encoding UTF8
    Write-Host "  Hooks registered in $claudeSettingsPath"
} else {
    Write-Host "  Hooks already registered, skipping."
}

# --- Done ---
Write-Host ""
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Cyan
Write-Host "    1. Launch $APP_NAME from the Start Menu"
Write-Host "    2. Open Claude Code or Codex in any terminal"
Write-Host "    3. Your mascot will come alive!"
Write-Host ""
