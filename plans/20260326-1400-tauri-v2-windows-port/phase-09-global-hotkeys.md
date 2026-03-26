# Phase 09: Global Hotkeys

## Context
- Parent: [plan.md](plan.md)
- Dependencies: Phase 01, Phase 07 (permission UI)
- Reference: `Sources/Services/GlobalHotkeyManager.swift`

## Overview
- **Date:** 2026-03-26
- **Priority:** Medium
- **Status:** Pending
- **Review:** Not started
- **Description:** System-wide keyboard shortcuts for controlling the overlay without switching apps.

## Key Insights
- macOS uses CGEvent tap (requires Accessibility permission)
- Windows: `tauri-plugin-global-shortcut` for basic shortcuts
- Double-tap detection (macOS: double-tap Cmd) needs special handling
- Win key on Windows opens Start menu — use Ctrl or Alt instead
- Key code mapping varies by keyboard layout (QWERTY/AZERTY/etc.)

## Requirements
- Configurable toggle shortcut (default: Ctrl+M or Alt+M)
- Ctrl+1-9: Select Nth permission/session
- Ctrl+Enter: Approve/Confirm
- Ctrl+Esc: Deny/Dismiss
- Ctrl+L: Collapse permission
- Double-tap Ctrl: Open session switcher (if 2+ sessions)
- Arrow keys: Navigate session switcher (when active)

## Architecture

```
Windows Global Shortcuts:
├── tauri-plugin-global-shortcut
│   ├── Ctrl+M (toggle focus)
│   ├── Ctrl+1-9 (select)
│   ├── Ctrl+Enter (confirm)
│   └── Ctrl+Esc (dismiss)
└── Custom Win32 low-level keyboard hook (Rust)
    └── Double-tap Ctrl detection
```

## Related Code Files

### Create:
- `src-tauri/src/hotkeys.rs` — Global shortcut registration + double-tap detection

### Reference:
- `Sources/Services/GlobalHotkeyManager.swift` — Full hotkey logic (555 lines)

## Implementation Steps

1. Register basic shortcuts via plugin:
   ```rust
   app.global_shortcut().on_shortcut("ctrl+m", |app, shortcut, event| {
       if event.state == ShortcutState::Pressed {
           app.emit("hotkey-toggle-focus", ()).ok();
       }
   })?;
   ```

2. Register Ctrl+N shortcuts (1-9, Enter, Esc, L, P)

3. Double-tap Ctrl detection in Rust:
   - Use Win32 `SetWindowsHookEx` with `WH_KEYBOARD_LL`
   - Track Ctrl press/release timing
   - Fire event if two Ctrl-only presses within 400ms
   - Must run on separate thread

4. Frontend listener:
   ```typescript
   import { listen } from '@tauri-apps/api/event';
   listen('hotkey-toggle-focus', () => { /* toggle dashboard */ });
   listen('hotkey-select', (e) => { /* select item e.payload.index */ });
   ```

5. Configurable shortcut:
   - Settings UI for rebinding toggle shortcut
   - Store in app config (Tauri store plugin or localStorage)
   - Re-register on change

6. **Platform note:** Replace ⌘ (Cmd) with Ctrl on Windows:
   - Ctrl+M → toggle
   - Ctrl+Enter → confirm
   - Ctrl+Esc → dismiss
   - Double-tap Ctrl → session switcher

## Todo
- [ ] Register global shortcuts via tauri-plugin-global-shortcut
- [ ] Implement Ctrl+1-9, Ctrl+Enter, Ctrl+Esc handlers
- [ ] Implement double-tap Ctrl detection (Win32 keyboard hook)
- [ ] Create frontend event listeners
- [ ] Add configurable shortcut in settings
- [ ] Handle session switcher arrow key navigation
- [ ] Test with various keyboard layouts

## Success Criteria
- Ctrl+M toggles dashboard from any app
- Ctrl+1-9 selects permissions when visible
- Double-tap Ctrl opens session switcher
- Shortcuts configurable in settings

## Risk Assessment
- **Double-tap Ctrl conflict** — Some apps use Ctrl for other purposes. May need to offer alternative (e.g., double-tap Alt).
- **Global shortcut conflicts** — Ctrl+M may conflict with other apps. Must be configurable.
- **Win32 hook overhead** — Low-level keyboard hook adds minimal latency but must be careful about thread safety.

## Security Considerations
- Keyboard hook only captures Ctrl/modifier state, not full keystrokes
- No keylogging — only specific modifier patterns detected

## Next Steps
→ Phase 10: Dashboard Window
