# Claude Code PermissionRequest Hook Research Report

**Date:** 2026-04-03  
**Scope:** Exit code handling, denial feedback mechanisms, and hookSpecificOutput format

---

## Executive Summary

Claude Code's PermissionRequest hooks support three mechanisms for passing deny responses:

1. **Exit code 2** - Treated as blocking error, stderr displayed to user (not ideal)
2. **JSON with `decision.behavior: "deny"`** - Recommended method with message field
3. **Message field** - Passes deny reason to Claude, not stdout on exit code 2

**Key Finding:** Exit code 2 behaves differently than PreToolUse hooks. For PermissionRequest, the recommended approach is **always use exit code 0 + JSON output**, not exit code 2.

---

## Question 1: Does Exit Code 2 Read stdout?

**Answer: NO. Exit code 2 is a blocking error that displays stderr, not stdout.**

### Behavior Details

| Exit Code | Behavior | stdout | stderr |
|-----------|----------|--------|--------|
| **0** | Success - parse JSON from stdout | ✓ Parsed as JSON | Ignored |
| **2** | Blocking error - ignore JSON | ✗ Ignored | ✓ Displayed to user |
| **Other** | Non-blocking error | ✗ Ignored | Ignored |

### Important Distinction

For **PreToolUse hooks**, exit code 2 shows stderr to the user while still parsing JSON from stdout. However, for **PermissionRequest hooks**, exit code 2 is a hard block that:
- Ignores any JSON output on stdout
- Shows stderr message to user
- Does NOT pass the message to Claude (user sees it, Claude doesn't)

### Practical Impact

If your PermissionRequest hook exits with code 2 and writes to stdout:
```bash
echo '{"hookSpecificOutput": {"decision": {"behavior": "deny"}}}' 
exit 2
```

Result: The JSON is **completely ignored**. Only stderr matters.

---

## Question 2: Passing "Reason" or "Feedback" When Denying

**Answer: YES. Use JSON output with `decision.message` field (requires exit code 0).**

### The Correct Format

```bash
#!/bin/bash
# Read hook input from stdin
INPUT=$(cat)

# Deny with reason
cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "Database writes are not allowed in this environment"
    }
  }
}
EOF
exit 0  # MUST be exit 0 for JSON to be parsed
```

### Field Mapping

- **`decision.message`** - Passed to Claude so it understands why denial occurred
- **Only for deny behavior** - `message` field is only meaningful with `"behavior": "deny"`
- **To user display** - The message is shown in Claude Code's UI as the denial reason

### What Doesn't Work

Based on GitHub issue #19298, these formats are **all ignored**:

```json
// WRONG - missing nested structure
{"permissionDecision": "deny"}

// WRONG - incomplete nesting  
{"decision": "deny"}

// WRONG - no hookSpecificOutput wrapper
{"deny": true}

// WRONG - exit code 2 (JSON ignored entirely)
// exit 2 followed by JSON
```

### Historical Context: permissionDecisionReason Field

Earlier documentation mentioned `permissionDecisionReason` (note: different from `message`). This field is used in **PreToolUse hooks** to pass blocking reasons to Claude:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Cannot delete system files"
  }
}
```

**For PermissionRequest hooks**, use `decision.message` instead, not `permissionDecisionReason`.

---

## Question 3: hookSpecificOutput Format for PermissionRequest

**Answer: Structured JSON with specific nested format shown below.**

### Complete Reference Format

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow|deny|block",
      "updatedInput": { },
      "updatedPermissions": [ ],
      "message": "",
      "interrupt": false
    }
  }
}
```

### Field Reference Table

| Field | Type | Applies To | Description |
|-------|------|-----------|-------------|
| `behavior` | string | Both allow/deny | Required. Values: `"allow"`, `"deny"`, `"block"` (block is alias for deny) |
| `updatedInput` | object | Allow only | Modifies tool input before execution. Replaces entire input object |
| `updatedPermissions` | array | Allow only | Permission rule updates (add/remove rules, change mode) |
| `message` | string | Deny only | Explains why permission was denied. Shown to Claude |
| `interrupt` | boolean | Deny only | If `true`, halts Claude execution entirely (stops subsequent commands) |

### Input Schema (What Hook Receives)

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/dir",
  "permission_mode": "default",
  "hook_event_name": "PermissionRequest",
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf node_modules",
    "description": "Remove node_modules directory"
  },
  "permission_suggestions": [
    {
      "type": "addRules",
      "rules": [{ "toolName": "Bash", "ruleContent": "rm -rf node_modules" }],
      "behavior": "allow",
      "destination": "localSettings"
    }
  ]
}
```

### Common Use Cases with Complete Examples

#### 1. Simple Allow (Auto-Approve)
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow"
    }
  }
}
```

#### 2. Deny with Reason
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "Destructive operations not allowed in production"
    }
  }
}
```

#### 3. Allow with Modified Input
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "updatedInput": {
        "command": "npm run lint"
      }
    }
  }
}
```

#### 4. Allow with Permission Rules (Auto-Approve Future Similar Commands)
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "updatedPermissions": [
        {
          "type": "addRules",
          "rules": [
            { "toolName": "Bash", "ruleContent": "npm test" }
          ],
          "behavior": "allow",
          "destination": "localSettings"
        }
      ]
    }
  }
}
```

#### 5. Deny with Interrupt (Stop Claude Entirely)
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "Critical security policy violation",
      "interrupt": true
    }
  }
}
```

### Permission Update Entry Types

When using `updatedPermissions`, each entry can:

| Type | Fields | Effect |
|------|--------|--------|
| `addRules` | `rules`, `behavior`, `destination` | Adds new permission rules |
| `replaceRules` | `rules`, `behavior`, `destination` | Replaces all rules of given behavior |
| `removeRules` | `rules`, `behavior`, `destination` | Removes matching rules |
| `setMode` | `mode`, `destination` | Changes permission mode (default, acceptEdits, dontAsk, bypassPermissions, plan) |
| `addDirectories` | `directories`, `destination` | Adds working directories to safe list |
| `removeDirectories` | `directories`, `destination` | Removes working directories from safe list |

### Destination Values

- `"session"` - In-memory only (cleared when session ends)
- `"localSettings"` - Writes to `.claude/settings.local.json`
- `"projectSettings"` - Writes to `.claude/settings.json`
- `"userSettings"` - Writes to `~/.claude/settings.json`

---

## Practical Implementation Pattern

### Recommended Hook Template (Bash)

```bash
#!/bin/bash
set -e

# Read hook input
INPUT=$(cat)

# Extract relevant fields
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Decision logic
if [[ "$TOOL_NAME" == "Bash" ]]; then
  if [[ "$COMMAND" =~ ^npm\ (test|lint|build)$ ]]; then
    # Auto-approve safe commands
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" }
      }
    }'
  elif [[ "$COMMAND" =~ ^rm ]]; then
    # Deny destructive operations with reason
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "deny",
          message: "Destructive shell operations require explicit approval"
        }
      }
    }'
  else
    # Let user decide (no JSON output)
    exit 0
  fi
else
  # Let user decide for non-Bash tools
  exit 0
fi
```

### Exit Code Rules for PermissionRequest Hooks

```bash
# CORRECT: Let user decide (no decision)
exit 0  # No JSON output required

# CORRECT: Provide decision via JSON
jq -n '{"hookSpecificOutput": {...}}'
exit 0  # Must be 0 for JSON to be parsed

# INCORRECT: Using exit 2 with JSON
echo '{"hookSpecificOutput": {...}}'
exit 2  # JSON is IGNORED, only stderr matters

# INCORRECT: Sending decision via stderr
echo "Deny reason" >&2
exit 2  # Decision isn't parsed, raw message shown to user only
```

---

## Known Bugs and Limitations

### Bug #19298: Hook Cannot Actually Deny

**Status:** CLOSED as NOT_PLANNED

Some reports indicate that PermissionRequest hooks cannot reliably deny permissions, with the interactive dialog appearing regardless. Workaround: Use PreToolUse hooks instead if PermissionRequest denials aren't working.

### Race Condition #12176

Permission dialogs render in parallel with hook execution. If hook takes >1-2 seconds, dialog may appear before hook completes, ignoring the hook's decision.

**Impact:** Keep hooks fast. Avoid I/O blocking operations.

### Hook Fires Too Frequently #29212

PermissionRequest hooks fire for every tool use, not just those requiring user approval. This can cause performance overhead.

### Subagent Bypass #23983

When using Agent Teams, PermissionRequest hooks don't trigger for subagent permission requests—standard terminal prompts appear instead.

---

## Compatibility Notes

- **Claude Code Haiku version:** Current documentation accurate as of April 2026
- **Exit code 0 + JSON:** Stable, recommended approach
- **Exit code 2:** Not recommended for PermissionRequest; avoid
- **message field:** Reliable for passing deny reasons to Claude

---

## Summary Table: Exit Code Behavior

| Scenario | Exit Code | stdout Handling | stderr Handling | Recommendation |
|----------|-----------|-----------------|-----------------|-----------------|
| Deny with reason | 0 | Parse JSON with `message` field | Ignored | ✓ **USE THIS** |
| Deny hard block | 2 | Ignored | Show to user only | ✗ Avoid |
| Allow permission | 0 | Parse JSON with `behavior: "allow"` | Ignored | ✓ **USE THIS** |
| Let user decide | 0 | No output | Ignored | ✓ Correct |

---

## References

- [Claude Code Hooks Documentation](https://code.claude.com/docs/en/hooks)
- [GitHub Issue #19298: PermissionRequest Hook Cannot Deny](https://github.com/anthropics/claude-code/issues/19298)
- [GitHub Issue #12446: Missing permissionDecisionReason](https://github.com/anthropics/claude-code/issues/12446)
- [GitHub Issue #12176: Hook Race Condition](https://github.com/anthropics/claude-code/issues/12176)

---

## Unresolved Questions

1. What is the exact timing threshold for the race condition in #12176? (mentioned as ~1-2 seconds but not formally specified)
2. Are there performance implications for hooks that fire for every tool use due to #29212?
3. When exactly should `interrupt: true` be used—are there security/UX guidelines?
