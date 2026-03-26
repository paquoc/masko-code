use serde_json::Value;
use std::fs;
use std::path::PathBuf;

const SCRIPT_VERSION: &str = "# version: 1";

/// All Claude Code event types to subscribe to
const HOOK_EVENTS: &[&str] = &[
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "Stop",
    "StopFailure",
    "Notification",
    "SessionStart",
    "SessionEnd",
    "TaskCompleted",
    "PermissionRequest",
    "UserPromptSubmit",
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
    "PostCompact",
    "ConfigChange",
    "TeammateIdle",
    "WorktreeCreate",
    "WorktreeRemove",
];

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn claude_settings_path() -> PathBuf {
    home_dir().join(".claude").join("settings.json")
}

fn hook_script_path() -> PathBuf {
    home_dir()
        .join(".masko-desktop")
        .join("hooks")
        .join("hook-sender.sh")
}

fn hook_command() -> String {
    // Use ~ shorthand — Claude Code expands it in both bash and cmd contexts
    "~/.masko-desktop/hooks/hook-sender.sh".to_string()
}

/// Generate the bash hook script content (works via Git Bash on Windows)
fn generate_script(port: u16) -> String {
    format!(
        r#"#!/bin/bash
{SCRIPT_VERSION}
# hook-sender.sh — Forwards Claude Code hook events to masko-desktop (Windows)
# Exit instantly if the desktop app server isn't reachable
curl -s --connect-timeout 0.3 "http://localhost:{port}/health" >/dev/null 2>&1 || exit 0

INPUT=$(cat 2>/dev/null || echo '{{}}')
EVENT_NAME=$(echo "$INPUT" | grep -o '"hook_event_name":"[^"]*"' | head -1 | cut -d'"' -f4)

# Walk up process tree to find terminal PID (Windows: use WMIC/PowerShell)
TERM_PID=""
SHELL_PID=""
if command -v powershell.exe >/dev/null 2>&1; then
  # Quick PowerShell one-liner to walk process tree
  PIDS=$(powershell.exe -NoProfile -Command "
    \$cur = $$$;
    \$terminals = 'Code','Cursor','Windsurf','WindowsTerminal','Claude','pycharm64','idea64','webstorm64','goland64','rider64';
    while (\$cur -and \$cur -ne 0) {{
      \$p = Get-CimInstance Win32_Process -Filter \"ProcessId=\$cur\" -EA 0;
      if (-not \$p) {{ break }};
      \$par = \$p.ParentProcessId;
      \$pp = Get-CimInstance Win32_Process -Filter \"ProcessId=\$par\" -EA 0;
      if (-not \$pp) {{ break }};
      \$name = [IO.Path]::GetFileNameWithoutExtension(\$pp.Name);
      if (\$terminals -contains \$name) {{ Write-Output \"\$par \$cur\"; break }};
      \$cur = \$par;
    }}
  " 2>/dev/null | tr -d '\r')
  if [ -n "$PIDS" ]; then
    TERM_PID=$(echo "$PIDS" | cut -d' ' -f1)
    SHELL_PID=$(echo "$PIDS" | cut -d' ' -f2)
  fi
fi

# Inject terminal_pid and shell_pid into JSON payload
if [ -n "$TERM_PID" ]; then
  INJECT="\"terminal_pid\":$TERM_PID"
  [ -n "$SHELL_PID" ] && INJECT="$INJECT,\"shell_pid\":$SHELL_PID"
  INPUT=$(echo "$INPUT" | sed "s/}}$/,$INJECT}}/")
fi

if [ "$EVENT_NAME" = "PermissionRequest" ]; then
    # Blocking: wait for user decision
    TMPFILE=$(mktemp /tmp/masko-hook.XXXXXX 2>/dev/null || mktemp)
    curl -s -w "\n%{{http_code}}" -X POST \
      -H "Content-Type: application/json" -d "$INPUT" \
      "http://localhost:{port}/hook" \
      --connect-timeout 2 >"$TMPFILE" 2>/dev/null &
    CURL_PID=$!
    trap 'kill $CURL_PID 2>/dev/null; rm -f "$TMPFILE"; exit 0' TERM HUP INT
    wait $CURL_PID
    RESPONSE=$(cat "$TMPFILE")
    rm -f "$TMPFILE"
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    [ -n "$BODY" ] && echo "$BODY"
    [ "$HTTP_CODE" = "403" ] && exit 2
    exit 0
else
    # Fire-and-forget for all other events
    curl -s -X POST -H "Content-Type: application/json" -d "$INPUT" \
      "http://localhost:{port}/hook" \
      --connect-timeout 1 --max-time 2 2>/dev/null || true
    exit 0
fi
"#,
        SCRIPT_VERSION = SCRIPT_VERSION,
        port = port,
    )
}

/// Ensure the hook script exists and is up to date
pub fn ensure_script_exists(port: u16) -> Result<(), String> {
    let script_path = hook_script_path();

    // Check if existing script is up to date
    if script_path.exists() {
        if let Ok(contents) = fs::read_to_string(&script_path) {
            if contents.contains(SCRIPT_VERSION)
                && contents.contains(&format!("localhost:{port}"))
            {
                return Ok(());
            }
        }
    }

    // Create directory
    if let Some(parent) = script_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create hooks dir: {e}"))?;
    }

    // Write script
    let script = generate_script(port);
    fs::write(&script_path, script)
        .map_err(|e| format!("Failed to write hook script: {e}"))?;

    println!(
        "[masko] Hook script written to {}",
        script_path.to_string_lossy()
    );
    Ok(())
}

/// Check if hooks are registered in ~/.claude/settings.json
pub fn is_registered() -> bool {
    let path = claude_settings_path();
    let data = match fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return false,
    };
    let json: Value = match serde_json::from_str(&data) {
        Ok(v) => v,
        Err(_) => return false,
    };

    let hooks = match json.get("hooks") {
        Some(h) => h,
        None => return false,
    };

    let cmd = hook_command();

    for event in HOOK_EVENTS {
        if let Some(entries) = hooks.get(*event).and_then(|v| v.as_array()) {
            for entry in entries {
                if let Some(inner_hooks) = entry.get("hooks").and_then(|v| v.as_array()) {
                    if inner_hooks.iter().any(|h| {
                        h.get("command").and_then(|c| c.as_str()) == Some(&cmd)
                    }) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// Remove legacy hooks (PowerShell .ps1 entries) from settings.json
fn remove_legacy_hooks(settings: &mut Value) {
    if let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        for event in HOOK_EVENTS {
            if let Some(entries) = hooks.get_mut(*event).and_then(|e| e.as_array_mut()) {
                entries.retain(|entry| {
                    !entry
                        .get("hooks")
                        .and_then(|h| h.as_array())
                        .map(|hooks| {
                            hooks.iter().any(|h| {
                                h.get("command")
                                    .and_then(|c| c.as_str())
                                    .map(|c| c.contains("hook-sender.ps1") || c.contains("REMOVED"))
                                    .unwrap_or(false)
                            })
                        })
                        .unwrap_or(false)
                });
            }
        }
    }
}

/// Register hooks in ~/.claude/settings.json
pub fn install(port: u16) -> Result<(), String> {
    ensure_script_exists(port)?;

    let path = claude_settings_path();
    let mut settings: Value = if let Ok(data) = fs::read_to_string(&path) {
        let mut s: Value = serde_json::from_str(&data).unwrap_or(Value::Object(Default::default()));
        remove_legacy_hooks(&mut s);
        s
    } else {
        Value::Object(Default::default())
    };

    let cmd = hook_command();
    let hook_entry = serde_json::json!({
        "matcher": "",
        "hooks": [{"type": "command", "command": cmd}]
    });

    let hooks = settings
        .as_object_mut()
        .ok_or("settings is not an object")?
        .entry("hooks")
        .or_insert(Value::Object(Default::default()));

    let hooks_obj = hooks
        .as_object_mut()
        .ok_or("hooks is not an object")?;

    for event in HOOK_EVENTS {
        let entries = hooks_obj
            .entry(*event)
            .or_insert(Value::Array(vec![]));

        let arr = entries.as_array_mut().ok_or("event entries is not an array")?;

        let already_registered = arr.iter().any(|entry| {
            entry
                .get("hooks")
                .and_then(|h| h.as_array())
                .map(|hooks| {
                    hooks
                        .iter()
                        .any(|h| h.get("command").and_then(|c| c.as_str()) == Some(&cmd))
                })
                .unwrap_or(false)
        });

        if !already_registered {
            arr.push(hook_entry.clone());
        }
    }

    write_settings(&path, &settings)?;
    println!("[masko] Hooks installed in {}", path.to_string_lossy());
    Ok(())
}

/// Remove hooks from ~/.claude/settings.json
pub fn uninstall() -> Result<(), String> {
    let path = claude_settings_path();

    let data = fs::read_to_string(&path).map_err(|e| format!("Failed to read settings: {e}"))?;
    let mut settings: Value =
        serde_json::from_str(&data).map_err(|e| format!("Invalid JSON: {e}"))?;

    let cmd = hook_command();

    if let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        for event in HOOK_EVENTS {
            if let Some(entries) = hooks.get_mut(*event).and_then(|e| e.as_array_mut()) {
                entries.retain(|entry| {
                    !entry
                        .get("hooks")
                        .and_then(|h| h.as_array())
                        .map(|hooks| {
                            hooks
                                .iter()
                                .any(|h| h.get("command").and_then(|c| c.as_str()) == Some(&cmd))
                        })
                        .unwrap_or(false)
                });
            }
        }

        let empty_keys: Vec<String> = hooks
            .iter()
            .filter(|(_, v)| v.as_array().map(|a| a.is_empty()).unwrap_or(false))
            .map(|(k, _)| k.clone())
            .collect();
        for key in empty_keys {
            hooks.remove(&key);
        }

        if hooks.is_empty() {
            settings.as_object_mut().unwrap().remove("hooks");
        }
    }

    write_settings(&path, &settings)?;
    println!("[masko] Hooks uninstalled from {}", path.to_string_lossy());
    Ok(())
}

fn write_settings(path: &PathBuf, settings: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create .claude dir: {e}"))?;
    }

    let data = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;
    fs::write(path, data).map_err(|e| format!("Failed to write settings: {e}"))?;
    Ok(())
}
