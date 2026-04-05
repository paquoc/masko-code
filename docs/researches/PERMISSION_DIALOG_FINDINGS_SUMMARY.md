# Permission Dialog Issue - Key Findings Summary

## The Problem

**Claude Code has a critical race condition** where permission dialogs don't dismiss after PermissionRequest hooks return `"allow"` if the hook response takes longer than ~1-2 seconds.

### Root Cause

In Claude Code's `cli.js`:
1. Dialog is added to UI state **immediately**
2. Hook executes **asynchronously in parallel** (not awaited)
3. Function returns **without waiting** for hook completion
4. Hook later tries to remove the dialog, but it may have already rendered

### Timing

- **Hooks that respond in < 1.5 seconds**: Dialog never shows (race won)
- **Hooks that respond in > 2 seconds**: Dialog shows despite approval (race lost)
- **Non-deterministic behavior** depends on system performance

---

## Impact on Masko-Code

1. **PermissionRequest hooks cannot reliably automate permission approvals**
   - This is a Claude Code limitation, not a Masko-Code bug
   - Affects both macOS and Windows versions

2. **Masko-Code correctly handles this** by:
   - Monitoring socket state (not just HTTP response)
   - Using `postToolUse` events (Claude Code's actual source of truth)
   - Auto-dismissing stale permissions after 1 second
   - Correlating `toolUseId` across events to remove specific permissions

3. **Your permission UI should work correctly** because:
   - You respond to actual event stream completion
   - You don't rely on hook response timing
   - You monitor connection liveness independently

---

## Known Related Issues

| Issue | Status | Root Cause |
|-------|--------|-----------|
| Hook race condition | CONFIRMED #12176 | Dialog added before hook awaited |
| Hook cannot deny | CONFIRMED #19298 | Dialog shows regardless of hook response |
| Allow rules ignored | CONFIRMED #37516 | Desktop app doesn't respect `permissions.allow` |
| Hook fires unnecessarily | CONFIRMED #29212 | Hook executes even for auto-allowed tools |
| Desktop settings ignored | CONFIRMED #29026 | Desktop app uses different config path |

---

## Recommended Action

**For Masko-Code development:**

1. ✅ Keep current architecture (socket monitoring + event-driven dismissal)
2. ✅ Continue correlating toolUseId from PreToolUse events
3. ✅ Rely on postToolUse/postToolUseFailure for UI removal (not hook response)
4. ⚠️ Document that permission dialogs may appear in Claude Code despite hook approval
5. 📋 Consider adding timeout handling if hook takes > 3 seconds

**What NOT to do:**

- ❌ Don't assume hook response timing correlates with dialog dismissal
- ❌ Don't optimize for fast hook response times
- ❌ Don't expect PermissionRequest hooks to suppress dialogs 100% of the time

---

## Testing Considerations

Test scenarios for Windows Tauri port:

1. Hook that responds in < 500ms (should prevent dialog)
2. Hook that responds in 2-3 seconds (may show dialog despite approval)
3. Hook that times out (should show dialog as fallback)
4. Multiple pending permissions (queue handling with above scenarios)
5. Connection loss during hook execution (liveness check auto-dismiss)

---

## Workarounds Not Applicable to Masko

Some GitHub issues suggest workarounds that **don't help Masko**:
- Using `--dangerously-skip-permissions` flag (bypasses hooks entirely)
- Configuring `permissions.allow` rules in `settings.json` (desktop app ignores them)
- Relying on hook to suppress dialogs (race condition prevents reliable suppression)

**The real solution** is Anthropic fixing Claude Code's hook execution order (proposed in #12176).

---

## Documentation

Full research report: `/docs/RESEARCH_PERMISSION_DIALOG_DISMISS_ISSUE.md`

