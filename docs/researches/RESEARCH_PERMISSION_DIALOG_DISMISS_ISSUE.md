# Research Report: Claude Code PermissionRequest Hook Dialog Dismiss Issue

**Date:** March 28, 2026
**Scope:** Investigation of known issues with permission dialogs not dismissing after hook responds with "allow"
**Status:** CONFIRMED - Critical race condition identified in Claude Code desktop app

---

## Executive Summary

A **critical race condition** exists in Claude Code's PermissionRequest hook implementation where permission dialogs fail to dismiss if the hook response takes longer than ~1-2 seconds to return. The dialog is added to the UI state *before* the hook is awaited, creating a timing-dependent behavior where fast hooks avoid showing the dialog while slower hooks still display it despite returning `{"behavior": "allow"}`.

This is a **known issue** with multiple GitHub reports and affects automation workflows that rely on PermissionRequest hooks for unattended permission handling.

---

## Finding 1: Critical Race Condition in Dialog Rendering

### Issue
**GitHub:** [#12176 - PermissionRequest Hook Race Condition - Dialog Shows Despite Hook Returning "allow"](https://github.com/anthropics/claude-code/issues/12176)

### Root Cause
In Claude Code's `cli.js` (lines ~2689-2723), the permission handling logic has a fundamental ordering problem:

```javascript
case "ask": {
  let H = !1;

  // PROBLEM: Dialog is added to UI state BEFORE hook is awaited
  A((U) => [...U, {
    assistantMessage: I,
    tool: B,
    // ... dialog config
  }]); // Dialog created HERE

  // Hook executes ASYNCHRONOUSLY in parallel (not awaited)
  (async () => {
    for await (let U of HIA([NZ0(B.name, Y, G, Z, ...)])) {
      if (U.permissionRequestResult &&
          U.permissionRequestResult.behavior === "allow") {
        H = !0;
        // Hook tries to remove dialog AFTER it's rendered
        A((q) => q.filter((w) => w.toolUseID !== Y));
        W({behavior: "allow", ...});
        return;
      }
    }
  })();

  return; // Returns immediately without waiting for hook!
}
```

### Timing-Dependent Behavior
- **Hook completes in < 1.5 seconds:** Usually completes before UI renders → dialog never shown (race won)
- **Hook takes > 2 seconds:** UI renders dialog before hook completes → dialog shown despite approval (race lost)
- **Non-deterministic:** Behavior depends on system load and hook performance

### Impact
- PermissionRequest hooks cannot reliably automate permission approvals
- CI/CD pipelines fail unpredictably due to intermittent dialog appearance
- Forces users to use broad wildcard allow rules instead of intelligent hook-based decisions
- Affects Masko-code on both Windows and macOS since it relies on this hook system

---

## Finding 2: Multiple Related Permission Dialog Issues

### Issue #19298 - Hook Cannot Deny Permissions
**GitHub:** [#19298 - PermissionRequest hook cannot deny permissions](https://github.com/anthropics/claude-code/issues/19298)

The PermissionRequest hook executes but cannot actually prevent the permission dialog from appearing. Even when a hook returns `{"behavior": "deny"}`, the interactive permission prompt still shows to the user.

### Issue #37516 - Allow Rules Have No Effect
**GitHub:** [#37516 - Edit permission rules in allow list have no effect — permission dialog always shown](https://github.com/anthropics/claude-code/issues/37516)

Permission allow rules configured in `~/.claude/settings.json` do not suppress the permission dialog. The "Allow Claude to Edit?" dialog is shown regardless of configured allow rules.

### Issue #29212 - Hook Fires Unnecessarily
**GitHub:** [#29212 - PermissionRequest hook fires for every tool check, not just when actually blocked](https://github.com/anthropics/claude-code/issues/29212)

The PermissionRequest hook executes on every tool permission check, even when the tool is already auto-allowed and no user interaction is required. This makes the hook unsuitable for triggering notifications that should only appear when Claude is actually blocked.

### Issue #29026 - Desktop App Ignores Permissions
**GitHub:** [#29026 - Desktop app ignores settings.json permissions.allow and defaultMode: bypassPermissions](https://github.com/anthropics/claude-code/issues/29026)

Settings in `~/.claude/settings.json` (including `permissions.allow` rules and `defaultMode: "bypassPermissions"`) have no effect in the Claude Code desktop app on macOS. Every tool call still prompts for manual approval despite configured permissions.

### Issue #11380 - Continuous Permission Prompts
**GitHub:** [#11380 - Claude continually asks for permission, even after selecting yes, always allow](https://github.com/anthropics/claude-code/issues/11380)

Users report that Claude continuously asks for permission even after selecting "yes, always allow." Selecting the same option repeatedly results in the same permission prompt appearing again, despite trying both local and global permissions settings.

---

## Finding 3: Masko-Code Architecture & Permission Handling

### macOS Implementation (Swift)
The masko-code macOS version properly handles permission dismissal through:

1. **Transport monitoring** (`HookConnectionTransport.swift`):
   - Wraps NWConnection from Claude Code hook script
   - Monitors connection state for `cancelled` and `failed` states
   - Monitors TCP receive for clean socket closure
   - Calls `onRemoteClose` handler when connection closes

2. **State cleanup** (`PendingPermissionStore.swift`):
   - `resolve()` method sends HTTP response and immediately removes permission from UI state
   - `silentRemove()` removes permissions when agent answers from terminal
   - `dismissByToolUseId()` removes specific tool permissions on `postToolUse` events
   - Auto-dismiss on stale connections (1-second liveness checks)

3. **Event-driven dismissal** (`AppStore.swift`):
   - Listens for `postToolUse` and `postToolUseFailure` events
   - Calls `dismissByToolUseId()` to remove only the completed tool's permission
   - Correlates `toolUseId` from preceding `PreToolUse` events (which carry the ID that `PermissionRequest` lacks)

### Windows Implementation (Tauri v2 - Ported from Swift)
The Windows port maintains the same architecture:
- `src-tauri/src/server.rs`: Axum HTTP server on port 45832
- SolidJS stores mirror the Swift Observable pattern
- Same `dismissByToolUseId()` logic to remove specific tools on completion

### Key Design Pattern: toolUseId Correlation
Masko solves a protocol deficiency where Claude Code's `PermissionRequest` hook events don't include `toolUseId`:
- Cache `toolUseId` from preceding `PreToolUse` events
- Correlate with `PermissionRequest` by session ID and tool name
- On `postToolUse`, match against both `event.toolUseId` and `resolvedToolUseId`

This ensures only the completed tool's permission is removed, not all pending permissions for the agent.

---

## Finding 4: macOS-Specific Permission Handling

### Masko-Code macOS Architecture
The macOS native implementation in Swift has several advantages for permission handling:

1. **Direct socket control**: Uses Network.framework (`NWConnection`) for raw TCP connections from hook scripts
2. **Precise state cleanup**: Can monitor individual connection states without relying on Claude Code's UI state
3. **Liveness checks**: 1-second timer validates connection health and auto-dismisses stale permissions
4. **Event correlation**: Matches tool completion events to specific permissions via `toolUseId`

### No macOS-Specific Workarounds Found
Research of the masko-code repository shows:
- No macOS-specific bypass for the race condition
- No special handling to work around the dialog not dismissing
- Uses the standard architecture that depends on Claude Code properly dismissing dialogs after hook response

The macOS implementation does NOT work around the race condition—it handles permissions correctly on Masko's side, but still depends on Claude Code respecting the hook response.

---

## Finding 5: Known Limitations & Feature Requests

### Feature Request #19628 - Hook for When Permission Prompt is Answered
**GitHub:** [#19628 - Feature request: Hook for when permission prompt is answered](https://github.com/anthropics/claude-code/issues/19628)

Users request a new hook event that fires immediately when the user responds to a permission prompt. This would allow Masko to:
- Show permission answer notifications
- Dismiss notification dialogs at the exact moment of user action
- Track resolution timing more accurately

This is not yet implemented in Claude Code.

### Feature Request #18461 - PermissionRequest Hook for Notifications
**GitHub:** [#18461 - Feature Request: Add PermissionRequest Hook for Notifications](https://github.com/anthropics/claude-code/issues/18461)

Requests that PermissionRequest hooks be allowed to return notification configuration, enabling Masko-like permission UI in third-party apps without full desktop app replacement.

---

## Finding 6: Proposed Fix in Claude Code

The race condition can be fixed by **executing the hook BEFORE adding the dialog** to UI state:

```javascript
case "ask": {
  // Execute hook FIRST
  for await (let U of HIA([NZ0(B.name, Y, G, Z, E.toolPermissionContext.mode, Z.abortController.signal)])) {
    if (U.permissionRequestResult && U.permissionRequestResult.behavior === "allow") {
      // Hook approved - execute without showing dialog
      W({
        behavior: "allow",
        updatedInput: U.permissionRequestResult.updatedInput || G,
        userModified: !1,
        decisionReason: {type: "hook", hookName: "PermissionRequest"}
      });
      return;
    }
  }

  // Hook didn't approve or timed out - NOW show dialog
  A((U) => [...U, {
    assistantMessage: I,
    tool: B,
    // ... rest of dialog config
  }]);

  return;
}
```

This ensures:
1. Hook response time never affects dialog visibility
2. Fast hooks prevent dialog appearance (intended behavior)
3. Slow/failing hooks fall back to showing the dialog
4. No race condition between async hook execution and sync UI state updates

---

## Testing Implications for Masko-Code

The race condition means Masko-code developers should:

1. **Assume dialogs may appear** even after returning `{"behavior": "allow"}` if the hook takes > 2 seconds
2. **Monitor socket state**, not just HTTP response status, to determine if the dialog was dismissed
3. **Implement timeout handling** for hooks that don't respond within ~1.5 seconds
4. **Test with variable latency** to catch timing-dependent failures
5. **Track correlation** of PermissionRequest → PostToolUse to confirm actual dismissal

### Current Masko-Code Approach
Masko handles this gracefully by:
- Tracking both `event.toolUseId` and `resolvedToolUseId`
- Using `postToolUse` events to trigger UI removal (Claude Code's final source of truth)
- Monitoring TCP connection liveness in parallel with HTTP responses
- Auto-dismissing stale permissions after 1 second of no activity

This means Masko's permission UI should dismiss correctly even if Claude Code's dialog appears, because it responds to actual event stream completion rather than hook response timing.

---

## Summary Table: Permission Dialog Issues

| Issue | Status | Impact | Workaround |
|-------|--------|--------|-----------|
| Race condition (hook takes > 2s) | Confirmed | Dialog appears despite approval | Use fast hooks or rely on `postToolUse` events |
| Hook cannot deny | Confirmed | Dialog always appears if hook allows | None—always show dialog UI as fallback |
| Allow rules ignored | Confirmed | Desktop app doesn't respect `permissions.allow` | Configure at hook level instead |
| Hook fires unnecessarily | Confirmed | Notification spam for auto-allowed tools | Filter in hook script based on tool state |
| Settings ignored | Confirmed | Desktop app uses different config than CLI | Use hooks or manual approval UI |
| Permission prompts loop | Confirmed | "Always allow" selection doesn't persist | File separate bug—different root cause |

---

## Unresolved Questions

1. **Has Anthropic committed to fixing the race condition?** Issue #12176 does not show a confirmed fix in progress or timeline.

2. **Will Claude Code execute PermissionRequest hooks BEFORE showing dialogs?** Proposed fix is clear but adoption date unknown.

3. **Are there performance benchmarks** for hook execution time in real-world scenarios (network delays, script execution, etc.)?

4. **Does the Windows/macOS Native App versions** have different permission handling than the terminal CLI?

5. **Will Claude Code implement a "Hook for hook completion" event** as requested in #19628 to notify Masko when user answers?

---

## Sources

- [GitHub Issue #12176 - PermissionRequest Hook Race Condition](https://github.com/anthropics/claude-code/issues/12176)
- [GitHub Issue #19298 - PermissionRequest hook cannot deny permissions](https://github.com/anthropics/claude-code/issues/19298)
- [GitHub Issue #37516 - Edit permission rules have no effect](https://github.com/anthropics/claude-code/issues/37516)
- [GitHub Issue #29212 - PermissionRequest hook fires unnecessarily](https://github.com/anthropics/claude-code/issues/29212)
- [GitHub Issue #29026 - Desktop app ignores settings.json permissions](https://github.com/anthropics/claude-code/issues/29026)
- [GitHub Issue #11380 - Claude continually asks for permission](https://github.com/anthropics/claude-code/issues/11380)
- [GitHub Issue #19628 - Hook for when permission prompt is answered](https://github.com/anthropics/claude-code/issues/19628)
- [GitHub Issue #18461 - PermissionRequest Hook for Notifications](https://github.com/anthropics/claude-code/issues/18461)
- [Masko-Code Repository](https://github.com/paquoc/masko-code) - `/Sources/Stores/PendingPermissionStore.swift`, `/Sources/Adapters/ClaudeCode/HookConnectionTransport.swift`, `/Sources/Stores/AppStore.swift`
- [Claude Code Documentation - Configure permissions](https://code.claude.com/docs/en/permissions)

