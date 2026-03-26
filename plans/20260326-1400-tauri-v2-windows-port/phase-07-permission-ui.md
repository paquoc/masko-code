# Phase 07: Permission UI

## Context
- Parent: [plan.md](plan.md)
- Dependencies: Phase 02, Phase 03, Phase 05
- Reference: `Sources/Views/Overlay/PermissionPromptView.swift`, `Sources/Stores/PendingPermissionStore.swift`

## Overview
- **Date:** 2026-03-26
- **Priority:** High
- **Status:** Pending
- **Review:** Not started
- **Description:** Speech bubble permission prompts that float above the mascot. Users approve/deny tool use requests, answer questions, and review plans.

## Key Insights
- Permissions are a queue — multiple can stack (most recent on top)
- Each permission holds an HTTP connection open (response sent on user decision)
- Three actions: Approve, Deny, Collapse (defer)
- Permission suggestions ("always allow X in folder") parsed from event
- AskUserQuestion shows question text + options (radio/checkbox)
- Expanded view (Cmd+P equivalent) shows full tool input/output details
- Keyboard driven: Win+1-9 select, Win+Enter confirm, Win+Esc deny

## Requirements
- Speech bubble UI positioned above mascot overlay
- Permission queue with stack display
- Approve/Deny/Collapse buttons
- Permission suggestion pills
- AskUserQuestion mode (text input or option selection)
- Expanded fullscreen permission panel
- Keyboard shortcut integration
- Response sent back to Rust server (which responds to hook script)

## Related Code Files

### Create:
- `src/components/overlay/PermissionPrompt.tsx` — Permission speech bubble
- `src/components/overlay/PermissionContent.tsx` — Tool input details
- `src/components/overlay/ExpandedPermission.tsx` — Fullscreen permission panel
- `src/components/overlay/QuestionPrompt.tsx` — AskUserQuestion UI
- `src/stores/permission-store.ts` — Permission queue management

### Reference:
- `Sources/Views/Overlay/PermissionPromptView.swift`
- `Sources/Views/Overlay/PermissionContentView.swift`
- `Sources/Views/Overlay/ExpandedPermissionView.swift`
- `Sources/Stores/PendingPermissionStore.swift`

## Implementation Steps

1. Permission store:
   ```typescript
   const [permissions, setPermissions] = createStore<PendingPermission[]>([]);
   const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set());
   ```

2. Permission prompt component:
   - Positioned above mascot overlay window
   - Shows tool name, file path or command
   - Three buttons: Approve (green), Deny (red), Later (collapse)
   - Permission suggestions as clickable pills
   - Stacks when multiple pending

3. Response flow:
   ```
   User clicks Approve → invoke('resolve_permission', { id, decision: 'allow' })
   → Rust sends HTTP response → hook script receives → Claude Code continues
   ```

4. AskUserQuestion handling:
   - Parse `tool_input.questions` array
   - Show question text + options (if provided)
   - Text input for free-form answers
   - Submit answer via same resolve_permission flow

5. Expanded permission panel:
   - Opens as separate Tauri window or large overlay
   - Shows full tool input JSON (formatted)
   - Markdown rendering for messages
   - Same approve/deny controls

6. Keyboard shortcuts (received from global hotkey system):
   - Win+1-9: Select permission suggestion N
   - Win+Enter: Approve with selected suggestion (or plain approve)
   - Win+Esc: Deny topmost permission
   - Win+L: Collapse (defer) topmost

## Todo
- [ ] Create permission store with queue management
- [ ] Create PermissionPrompt speech bubble component
- [ ] Implement approve/deny/collapse actions
- [ ] Wire resolution to Rust backend (resolve_permission command)
- [ ] Parse and display permission suggestions
- [ ] Implement AskUserQuestion mode
- [ ] Create expanded permission panel
- [ ] Integrate keyboard shortcuts
- [ ] Style with brand colors and Fredoka font

## Success Criteria
- Permission bubble appears above mascot when PermissionRequest arrives
- Clicking Approve sends response and Claude Code continues
- Multiple permissions stack correctly
- Permission suggestions display and work
- Keyboard shortcuts work for approve/deny/select

## Risk Assessment
- **Timing** — Permission must respond before Claude Code timeout (~120s). Timer display recommended.
- **Window ordering** — Permission bubble must always be above mascot, both above other windows.

## Security Considerations
- Display tool name and input clearly so user can make informed decision
- Sanitize displayed tool_input to prevent XSS

## Next Steps
→ Phase 08: System Tray
