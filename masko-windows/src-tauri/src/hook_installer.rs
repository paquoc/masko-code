use serde_json::Value;
use std::fs;
use std::path::PathBuf;

const SCRIPT_VERSION: &str = "# version: 16";

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
/// Matches macOS v15 logic: hardcoded port, health check before stdin, no scanning
fn generate_script(port: u16) -> String {
    format!(
        r#"#!/bin/bash
{SCRIPT_VERSION}
# hook-sender.sh — Forwards Claude Code hook events to masko-desktop (Windows)
# Log ALL hook invocations before any other logic
INPUT=$(cat 2>/dev/null || echo '{{}}')
EVENT_NAME=$(echo "$INPUT" | grep -o '"hook_event_name":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] event=$EVENT_NAME input=$INPUT" >> /tmp/masko-hook.txt

DROPDIR="$HOME/.masko-desktop/hook-drops"

if [ "$EVENT_NAME" = "PermissionRequest" ]; then
    # PermissionRequest needs HTTP — must return a response to Claude Code.
    # Health-check first (retry 5 times, 1s timeout each)
    HEALTH_OK=0
    for _i in 1 2 3 4 5; do
        HC_RESULT=$(curl -s -o /dev/null -w "%{{http_code}}" --connect-timeout 1 "http://localhost:{port}/health" 2>&1)
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] health check port={port} result=$HC_RESULT" >> /tmp/masko-hook.txt
        if [ "$HC_RESULT" = "200" ]; then
            HEALTH_OK=1
            break
        fi
        sleep 0.2
    done
    if [ "$HEALTH_OK" != "1" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] health check failed after 5 tries, aborting PermissionRequest" >> /tmp/masko-hook.txt
        exit 0
    fi

    # Blocking: wait for user decision. Run curl in background so we can
    # trap SIGTERM/SIGHUP and kill it — when Claude Code resolves a permission
    # from the terminal, it kills this script, and we must ensure curl dies too
    # (otherwise the TCP connection stays open and the desktop bubble sticks).
    TMPFILE=$(mktemp /tmp/masko-hook.XXXXXX 2>/dev/null || mktemp)
    INFILE=$(mktemp /tmp/masko-in.XXXXXX 2>/dev/null || mktemp)
    printf '%s' "$INPUT" > "$INFILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] sending PermissionRequest to http://localhost:{port}/hook" >> /tmp/masko-hook.txt
    curl -s -w "\n%{{http_code}}" -X POST \
      -H "Content-Type: application/json" \
      --data-binary "@$INFILE" \
      "http://localhost:{port}/hook" \
      --connect-timeout 2 >"$TMPFILE" 2>/dev/null &
    CURL_PID=$!
    trap 'kill $CURL_PID 2>/dev/null; rm -f "$TMPFILE" "$INFILE"; exit 0' TERM HUP INT
    wait $CURL_PID
    RESPONSE=$(cat "$TMPFILE")
    rm -f "$TMPFILE" "$INFILE"
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] PermissionRequest response http_code=$HTTP_CODE" >> /tmp/masko-hook.txt
    BODY=$(echo "$RESPONSE" | sed '$d')
    [ -n "$BODY" ] && echo "$BODY"
    # Always exit 0 so Claude Code reads JSON stdout (exit 2 ignores stdout)
    exit 0
else
    # All other events: write to drop file (file watcher picks them up).
    # Atomic write: tmp file + mv to prevent reading partial data.
    mkdir -p "$DROPDIR" 2>/dev/null
    DROPFILE="$DROPDIR/$(date +%s%N)-$EVENT_NAME.json"
    echo "$INPUT" > "$DROPFILE.tmp" && mv "$DROPFILE.tmp" "$DROPFILE"
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

    mlog!(
        "Hook script written to {}",
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
    mlog!("Hooks installed in {}", path.to_string_lossy());
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
    mlog!("Hooks uninstalled from {}", path.to_string_lossy());
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
