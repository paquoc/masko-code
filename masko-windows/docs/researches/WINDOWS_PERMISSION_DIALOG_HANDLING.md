# Windows Tauri Permission Dialog Handling

## Architecture Overview

The Windows Tauri v2 port handles PermissionRequest dialogs through a distributed architecture:

```
Claude Code (on localhost:49152)
         ↓ HTTP POST hook events
    Tauri Server (port 45832)
         ↓ TCP connection holding (PermissionRequest)
    SolidJS Frontend (React-like state)
         ↓ User interaction
    Send HTTP response → Close TCP connection
         ↓
Claude Code resumes tool execution
```

## Key Components

### 1. Axum HTTP Server (`src-tauri/src/server.rs`)

**Responsibilities:**
- Accept HTTP POST events from Claude Code hooks
- Hold TCP connections open for PermissionRequest events
- Send HTTP responses when user makes decision
- Monitor connection state for cleanup

**For PermissionRequest handling:**
```rust
// Pseudo-code structure
POST /hook/PermissionRequest {
    // Parse event, extract tool info
    let permission = PendingPermission {
        id: UUID,
        event: AgentEvent,
        toolName: "Bash", // from event
        toolUseId: Some("tool_use_xyz"), // correlated from previous PreToolUse
    };

    // Send to frontend via IPC
    app.emit("permission-request", permission);

    // Hold TCP connection open - wait for frontend decision
    connection.await_frontend_response(); // blocks until UI responds

    // Send HTTP response & close
    send_http_response(decision);
}
```

### 2. SolidJS Store (`src/stores/pendingPermissionStore.ts`)

**Equivalent to macOS `PendingPermissionStore.swift`:**

```typescript
// Store state
pending: PendingPermission[] = [];
collapsed: Set<UUID> = new Set();

// Add permission
function add(event: AgentEvent, transport: ResponseTransport) {
    const permission = new PendingPermission(...);
    pending.push(permission);
    // Notify UI to show permission bubble
}

// Resolve (user clicked Allow/Deny)
function resolve(id: UUID, decision: "allow" | "deny") {
    const perm = pending.find(p => p.id === id);
    perm.transport.sendDecision(decision);
    pending.remove(id); // Remove from UI immediately
}

// Silent remove (answered from terminal, connection died)
function silentRemove(id: UUID) {
    pending.remove(id);
}

// Correlate toolUseId with PreToolUse
function cachePreToolUse(toolName: string, toolUseId: string) {
    preToolUseCache[toolName] = toolUseId;
}

// Dismiss by toolUseId when PostToolUse arrives
function dismissByToolUseId(toolUseId: string) {
    const perm = pending.find(p =>
        p.event.toolUseId === toolUseId ||
        p.resolvedToolUseId === toolUseId
    );
    silentRemove(perm.id);
}
```

### 3. ResponseTransport Interface

**For Tauri, implement via IPC to backend:**

```typescript
class ResponseTransport {
    sendDecision(decision: "allow" | "deny"): void {
        // Signal Tauri backend to send HTTP response
        invoke("send_permission_decision", { decision });
    }

    sendAllowWithUpdatedInput(input: any): void {
        // For AskUserQuestion with answers
        invoke("send_allow_with_input", { input });
    }

    sendAllowWithUpdatedPermissions(perms: any[]): void {
        // For "always allow" rules
        invoke("send_allow_with_permissions", { permissions: perms });
    }

    cancel(): void {
        // Close TCP connection (shouldn't happen on Windows)
    }

    onRemoteClose(handler: () => void): void {
        // Monitor connection state from backend
        listen("connection-closed", handler);
    }
}
```

## Race Condition Mitigation

The Windows Tauri port mitigates the Claude Code PermissionRequest race condition through:

### 1. Socket State Monitoring (Backend)

**In `server.rs`:**
```rust
// Track which TCP connections are alive
let mut connections: HashMap<UUID, TcpStream> = HashMap::new();

// Monitor for closure
tokio::spawn({
    let id = permission.id.clone();
    let mut conn = connections[&id].clone();

    async move {
        // If Claude Code closes connection (user answered from terminal),
        // notify frontend to dismiss the permission
        match conn.readable().await {
            Ok(()) => {
                // Connection closed - user answered from terminal
                app.emit("permission-closed", id);
            }
            Err(_) => {
                // Connection failed - remove from pending
                app.emit("permission-closed", id);
            }
        }
    }
});
```

### 2. PostToolUse Event Handling (Frontend)

**In `eventProcessor.ts`:**
```typescript
// When PostToolUse arrives, remove the specific tool's permission
onEvent(event: AgentEvent) {
    if (event.eventType === "postToolUse" && event.toolUseId) {
        pendingPermissionStore.dismissByToolUseId(event.toolUseId);
    }
}
```

### 3. Liveness Checks (Frontend)

**In `pendingPermissionStore.ts`:**
```typescript
// Periodic check for stale permissions
setInterval(() => {
    for (const perm of pending) {
        if (!perm.transport.isAlive) {
            silentRemove(perm.id);
        }
    }
}, 1000); // Check every 1 second
```

## Key Differences from macOS

| Aspect | macOS (Swift) | Windows (Tauri) |
|--------|---------------|-----------------|
| TCP handling | Network.framework | Tokio async |
| Frontend framework | SwiftUI | SolidJS |
| IPC mechanism | Direct Cocoa API | Tauri invoke |
| Connection monitoring | `NWConnection.stateUpdateHandler` | Tokio stream events |
| Permission removal trigger | HTTP response close | HTTP response close |
| Fallback removal | Liveness check + event-driven | Liveness check + event-driven |

## Important Notes for Developers

### 1. toolUseId Correlation is Critical

Claude Code sends events like this:
```
1. PreToolUse { toolName: "Bash", toolUseId: "tool_123" } ← Has the ID
2. PermissionRequest { toolName: "Bash" }                  ← Missing ID!
3. PostToolUse { toolUseId: "tool_123" }                  ← Has the ID again
```

**You must:**
- Cache `toolUseId` from PreToolUse
- Correlate by sessionId + agentId + toolName
- Use the correlated ID to remove specific permissions on PostToolUse

### 2. Don't Trust Hook Response Timing

The Claude Code race condition means:
- Hook response ≠ Dialog dismissal
- Dialog may appear 1-2 seconds later
- Always wait for PostToolUse to remove from UI

### 3. Connection Closure is Not Guaranteed

If user answers from terminal:
- CLI sets `defaultMode: "bypassPermissions"`
- Hook returns immediately without UI
- PermissionRequest never fires
- Liveness check detects stale connection

### 4. Timeout Handling

Add timeout for slow hooks:
```typescript
const PERMISSION_TIMEOUT = 60 * 1000; // 60 seconds

function add(event: AgentEvent, transport: ResponseTransport) {
    setTimeout(() => {
        if (pending.contains(permission.id)) {
            // No PostToolUse received - permission stale
            silentRemove(permission.id);
            console.warn(`Permission expired: ${event.toolName}`);
        }
    }, PERMISSION_TIMEOUT);
}
```

## Testing Checklist for Windows Port

### Unit Tests
- [ ] `cachePreToolUse()` correctly stores and retrieves toolUseId
- [ ] `dismissByToolUseId()` removes correct permission when multiple pending
- [ ] `silentRemove()` cleans up interactionState and collapsed set
- [ ] Duplicate detection works (same sessionId + toolUseId)
- [ ] Transport cancellation closes connection properly

### Integration Tests
- [ ] Hook fires → Permission bubble appears
- [ ] User clicks Allow → HTTP response sent → connection closes
- [ ] User clicks Deny → HTTP 403 response sent → connection closes
- [ ] PostToolUse event → Permission removed from UI
- [ ] Connection closes (terminal answer) → Permission auto-dismissed
- [ ] Timeout after 60s with no PostToolUse → Permission dismissed

### Race Condition Tests
- [ ] Fast hook (< 500ms) → No Claude Code dialog appears
- [ ] Slow hook (2-3s) → Claude Code dialog may appear → Still dismisses on PostToolUse
- [ ] Multiple pending permissions → Correct ones dismissed on PostToolUse
- [ ] Connection loss during response → Graceful cleanup

## References

- **Swift Implementation:** `/Sources/Stores/PendingPermissionStore.swift`
- **Hook Transport:** `/Sources/Adapters/ClaudeCode/HookConnectionTransport.swift`
- **Event Processing:** `/Sources/Stores/AppStore.swift` (lines 110-150)
- **Race Condition Issue:** https://github.com/anthropics/claude-code/issues/12176
- **Full Research:** `RESEARCH_PERMISSION_DIALOG_DISMISS_ISSUE.md`

