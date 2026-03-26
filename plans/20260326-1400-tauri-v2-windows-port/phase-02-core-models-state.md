# Phase 02: Core Models & State

## Context
- Parent: [plan.md](plan.md)
- Dependencies: Phase 01
- Reference: `Sources/Models/`, `Sources/Stores/`

## Overview
- **Date:** 2026-03-26
- **Priority:** Critical
- **Status:** Pending
- **Review:** Not started
- **Description:** Port all data models and state stores from Swift to TypeScript. These are the foundation for all features.

## Key Insights
- Swift `@Observable` maps to SolidJS `createStore`/`createSignal`
- All JSON coding keys already use snake_case — TypeScript interfaces match directly
- `ConditionValue` union type (bool|number) maps to TypeScript discriminated union
- `MaskoAnimationConfig` is the most important model — drives the entire animation system

## Requirements
- All models from Swift codebase ported to TypeScript interfaces
- All stores ported with reactive state using SolidJS primitives
- Event flow matches Swift: EventBus → EventProcessor → stores → UI

## Architecture

```
Event Flow (same as Swift):
┌──────────┐     IPC event      ┌───────────────┐     process     ┌──────────┐
│ Rust HTTP │ ──────────────────►│ EventProcessor │ ──────────────►│  Stores  │
│  Server   │                   │  (TypeScript)  │               │(SolidJS) │
└──────────┘                   └───────────────┘               └──────────┘
                                                                     │
                                                                     ▼
                                                                 UI Components
```

## Related Code Files

### Create:
- `src/models/agent-event.ts` — AgentEvent interface + HookEventType enum
- `src/models/mascot-config.ts` — MaskoAnimationConfig, Node, Edge, Condition, Videos
- `src/models/session.ts` — AgentSession interface
- `src/models/notification.ts` — AppNotification interface
- `src/models/permission.ts` — PendingPermission, PermissionSuggestion
- `src/models/types.ts` — ConditionValue, AgentSource, ActiveCard enums
- `src/stores/session-store.ts` — Session tracking
- `src/stores/event-store.ts` — Recent event history
- `src/stores/notification-store.ts` — Notification feed
- `src/stores/permission-store.ts` — Pending permission queue
- `src/stores/mascot-store.ts` — Saved mascot management
- `src/stores/app-store.ts` — Central coordinator
- `src/services/event-processor.ts` — Event routing logic
- `src/services/ipc.ts` — Tauri IPC command wrappers

### Reference (Swift):
- `Sources/Models/AgentEvent.swift` — Field mapping
- `Sources/Models/HookEventType.swift` — Event type enum
- `Sources/Models/MaskoCollection.swift` — Animation config schema
- `Sources/Stores/AppStore.swift` — Wiring pattern
- `Sources/Stores/SessionStore.swift` — Session tracking logic
- `Sources/Stores/PendingPermissionStore.swift` — Permission queue logic
- `Sources/Services/EventProcessor.swift` — Event → notification mapping

## Implementation Steps

1. Create `src/models/types.ts`:
   ```typescript
   export type ConditionValue = { type: 'bool'; value: boolean } | { type: 'number'; value: number };
   export enum AgentSource { ClaudeCode = 'claudeCode', Codex = 'codex', Copilot = 'copilot' }
   export enum ActiveCard { None, Toast, Permission, ExpandedPermission, SessionSwitcher }
   ```

2. Port `AgentEvent` interface — use exact same JSON keys (snake_case):
   ```typescript
   export interface AgentEvent {
     id: string;
     hook_event_name: string;
     session_id?: string;
     tool_name?: string;
     tool_input?: Record<string, any>;
     message?: string;
     // ... all fields from Swift model
     received_at: string;
   }
   ```

3. Port `HookEventType` enum with all 19 event types

4. Port `MaskoAnimationConfig` — nodes, edges, conditions, videos (hevc + webm)

5. Create SolidJS stores:
   - `createStore<AgentSession[]>` for sessions
   - `createStore<PendingPermission[]>` for permissions
   - `createStore<AppNotification[]>` for notifications
   - `createSignal<string>` for overlay state machine inputs

6. Port EventProcessor — maps events to notifications, updates session store

7. Create IPC wrapper — `invoke('get_server_status')`, event listeners

## Todo
- [ ] Create all model interfaces in src/models/
- [ ] Port HookEventType enum with display names and colors
- [ ] Port MaskoAnimationConfig with full schema
- [ ] Create SolidJS reactive stores
- [ ] Port EventProcessor logic
- [ ] Create Tauri IPC wrappers
- [ ] Unit test model serialization with sample JSON

## Success Criteria
- Sample mascot JSON (clippy.json) parses correctly into TypeScript models
- Sample hook event JSON decodes into AgentEvent
- Stores update reactively when events arrive

## Risk Assessment
- **AnyCodable** — Swift's type-erased wrapper. TypeScript handles this naturally with `any` or `unknown`
- **Date handling** — Swift uses `Date()` at decode time. Use `new Date()` on event arrival

## Security Considerations
- Sanitize HTML in notification messages (XSS prevention)
- Validate incoming JSON structure before processing

## Next Steps
→ Phase 03: Rust HTTP Server
