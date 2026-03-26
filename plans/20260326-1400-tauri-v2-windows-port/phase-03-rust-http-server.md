# Phase 03: Rust HTTP Server

## Context
- Parent: [plan.md](plan.md)
- Dependencies: Phase 01
- Reference: `Sources/Services/LocalServer.swift`

## Overview
- **Date:** 2026-03-26
- **Priority:** Critical
- **Status:** Pending
- **Review:** Not started
- **Description:** Implement embedded Axum HTTP server in Rust backend. Receives hook events from Claude Code/Codex and forwards them to the frontend via Tauri events.

## Key Insights
- Swift version uses NWListener (raw TCP). Axum is higher-level and easier.
- Port range: 45832-45841 with retry logic
- PermissionRequest events HOLD the HTTP connection open until user decides
- Health endpoint (`GET /health`) is critical — hook script checks it before sending
- CORS headers needed for `/install` route (browser requests from masko.ai)

## Requirements
- HTTP server listening on port 45832 (with fallback ports)
- Routes: GET /health, POST /hook, POST /input, POST /install
- PermissionRequest connections held open until frontend responds
- Events forwarded to frontend via `tauri::Emitter::emit()`
- Server starts/stops with app lifecycle

## Architecture

```
Hook Script (PowerShell)
    │ curl POST /hook
    ▼
┌─────────────────┐
│  Axum HTTP       │  Rust (src-tauri/)
│  (port 45832)    │
├─────────────────┤
│ GET /health     → 200 "ok"
│ POST /hook      → parse AgentEvent → emit to frontend
│                   (PermissionRequest: hold connection)
│ POST /input     → parse {name, value} → emit to frontend
│ POST /install   → parse MaskoConfig → emit to frontend
│ OPTIONS /install→ CORS preflight response
└─────────────────┘
    │ tauri::emit("hook-event", event)
    ▼
Frontend (SolidJS) — listens via @tauri-apps/api/event
```

## Related Code Files

### Create:
- `src-tauri/src/server.rs` — Axum server implementation
- `src-tauri/src/models.rs` — Rust structs matching AgentEvent JSON

### Modify:
- `src-tauri/src/main.rs` — Start server on app launch
- `src-tauri/src/lib.rs` — Register server as Tauri managed state

### Reference:
- `Sources/Services/LocalServer.swift` — Port fallback logic, route handling
- `Sources/Models/AgentEvent.swift` — JSON schema

## Implementation Steps

1. Define Rust structs in `models.rs`:
   ```rust
   #[derive(Debug, Serialize, Deserialize, Clone)]
   pub struct AgentEvent {
       pub hook_event_name: String,
       pub session_id: Option<String>,
       pub tool_name: Option<String>,
       pub tool_input: Option<serde_json::Value>,
       pub message: Option<String>,
       pub terminal_pid: Option<i64>,
       pub shell_pid: Option<i64>,
       // ... all fields
   }
   ```

2. Create Axum server in `server.rs`:
   ```rust
   pub async fn start_server(app_handle: tauri::AppHandle) -> Result<u16, Error> {
       let port = find_available_port(45832, 45841)?;
       let app = Router::new()
           .route("/health", get(health))
           .route("/hook", post(handle_hook))
           .route("/input", post(handle_input))
           .route("/install", post(handle_install).options(cors_preflight))
           .with_state(AppState { app_handle });
       // bind and serve
   }
   ```

3. Port fallback logic — try ports 45832 through 45841

4. PermissionRequest handling:
   - On POST /hook with `hook_event_name == "PermissionRequest"`:
   - Create a `oneshot::channel` for the response
   - Emit event to frontend with a `request_id`
   - Await the channel (with timeout ~120s)
   - Frontend calls Tauri command `resolve_permission(request_id, decision)`
   - Command sends decision through the channel
   - HTTP response sent back to hook script

5. Wire into Tauri lifecycle:
   ```rust
   .setup(|app| {
       let handle = app.handle().clone();
       tauri::async_runtime::spawn(async move {
           start_server(handle).await;
       });
       Ok(())
   })
   ```

6. Create Tauri command for permission resolution:
   ```rust
   #[tauri::command]
   async fn resolve_permission(
       state: State<'_, ServerState>,
       request_id: String,
       decision: serde_json::Value
   ) -> Result<(), String>
   ```

## Todo
- [ ] Define AgentEvent Rust struct
- [ ] Implement Axum router with all routes
- [ ] Implement port fallback logic (45832-45841)
- [ ] Implement PermissionRequest connection holding (oneshot channel)
- [ ] Emit events to frontend via tauri::emit
- [ ] Create resolve_permission Tauri command
- [ ] Wire server startup into Tauri .setup()
- [ ] Test with curl: health, hook, input endpoints

## Success Criteria
- `curl http://localhost:45832/health` returns "ok"
- `curl -X POST http://localhost:45832/hook -d '{"hook_event_name":"SessionStart"}'` emits event to frontend
- PermissionRequest holds connection until resolved
- Port fallback works when 45832 is occupied

## Risk Assessment
- **Port conflicts** — Another instance of Masko (macOS) or other app may hold the port. Fallback range handles this.
- **Connection timeout** — PermissionRequest must timeout gracefully (~120s) if user never responds

## Security Considerations
- Server only binds to localhost (127.0.0.1) — not accessible from network
- Validate JSON body structure before processing
- CORS only for /install route (masko.ai browser requests)

## Next Steps
→ Phase 04: Hook Installer
