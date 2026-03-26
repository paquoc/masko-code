# Phase 10: Dashboard Window

## Context
- Parent: [plan.md](plan.md)
- Dependencies: Phase 01, Phase 02, Phase 03
- Reference: `Sources/Views/` (all dashboard views)

## Overview
- **Date:** 2026-03-26
- **Priority:** Medium
- **Status:** Pending
- **Review:** Not started
- **Description:** Main dashboard window with session list, notification feed, mascot management, settings, and onboarding.

## Key Insights
- macOS version: WindowGroup + SwiftUI views
- Tauri: main window with SolidJS routing (or tab-based navigation)
- Dashboard is the "main" window — shown on launch, reopened from tray
- No dock/taskbar presence when closed (app lives in system tray)
- Tab structure: Sessions | Notifications | Mascots | Settings

## Requirements
- Main window (800x600, decorated, resizable)
- Session list with active/ended status, tool names, event counts
- Notification feed with priority colors and categories
- Mascot gallery (bundled + community downloads)
- Settings: hotkey config, auto-update, hook status, IDE extensions
- Onboarding flow for first launch
- Activity feed (recent events)

## Related Code Files

### Create:
- `src/components/dashboard/SessionList.tsx`
- `src/components/dashboard/NotificationCenter.tsx`
- `src/components/dashboard/MascotGallery.tsx`
- `src/components/dashboard/MascotDetail.tsx`
- `src/components/dashboard/SettingsPanel.tsx`
- `src/components/dashboard/OnboardingFlow.tsx`
- `src/components/dashboard/ActivityFeed.tsx`
- `src/components/dashboard/ApprovalHistory.tsx`
- `src/components/shared/AgentSourceBadge.tsx`
- `src/pages/Dashboard.tsx` — Main dashboard page with tab navigation

### Reference:
- `Sources/Views/Sessions/SessionListView.swift`
- `Sources/Views/Notifications/NotificationCenterView.swift`
- `Sources/Views/Masko/MaskoDashboardView.swift`
- `Sources/Views/Settings/SettingsView.swift`
- `Sources/Views/Onboarding/OnboardingView.swift`
- `Sources/Views/ActivityFeed/ActivityFeedView.swift`
- `Sources/Views/Approvals/ApprovalRequestView.swift`

## Implementation Steps

1. Create main dashboard layout with sidebar navigation:
   - Sessions (active count badge)
   - Notifications (unread count badge)
   - Mascots
   - Activity Feed
   - Approval History
   - Settings

2. Session list:
   - Active sessions: project name, status (working/idle/alert), event count, subagent count
   - Click to focus terminal (via Tauri command → Win32 window focus)
   - Session source badge (Claude Code / Codex)

3. Notification center:
   - Priority levels with color coding (urgent/high/normal/low)
   - Categories: permission, session lifecycle, tool failed, task completed
   - Mark as read, clear all

4. Mascot gallery:
   - Bundled mascots (clippy, masko, otto, etc.)
   - Community mascots from masko.ai
   - Select active mascot → updates overlay
   - Delete custom mascots

5. Settings panel:
   - Server status (port, running indicator)
   - Hook installation status + install/uninstall buttons
   - Hotkey configuration (shortcut recorder)
   - Auto-update toggle
   - IDE extension status
   - About section

6. Onboarding:
   - Step 1: Welcome
   - Step 2: Install hooks
   - Step 3: Pick mascot
   - Step 4: Done

7. Style with brand colors: orange primary (#f95d02), dark text (#23113c), Fredoka headings, Rubik body

## Todo
- [ ] Create dashboard layout with sidebar navigation
- [ ] Implement session list with live updates
- [ ] Implement notification center
- [ ] Implement mascot gallery
- [ ] Implement settings panel
- [ ] Implement onboarding flow
- [ ] Implement activity feed
- [ ] Implement approval history
- [ ] Style with brand colors and typography
- [ ] Window lifecycle: hide to tray on close, reopen from tray

## Success Criteria
- Dashboard shows live session data
- Notifications display with correct priority colors
- Mascot selection changes overlay animation
- Settings controls work (hooks, hotkeys, updates)

## Risk Assessment
- **Terminal focus on Windows** — Win32 `SetForegroundWindow` has restrictions. May need `AllowSetForegroundWindow` or attach to target thread's input.
- **Complexity** — Dashboard has many views. Prioritize sessions + mascots first, add rest incrementally.

## Security Considerations
- Settings write to local files only (no remote)
- Hook install/uninstall modifies user's Claude config — show confirmation

## Next Steps
→ Phase 11: Auto-Update & Packaging
