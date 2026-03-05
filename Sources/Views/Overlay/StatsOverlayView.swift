import SwiftUI

/// Compact stats pill displayed above the mascot overlay
struct StatsOverlayView: View {
    @Environment(SessionStore.self) var sessionStore
    @Environment(PendingPermissionStore.self) var pendingPermissionStore

    var body: some View {
        #if DEBUG
        let _ = Self._printChanges()
        let _ = PerfMonitor.shared.track(.viewBodyStatsOverlay)
        #endif
        HStack(spacing: 8) {
            // Active sessions
            HStack(spacing: 3) {
                Circle()
                    .fill(sessionStore.activeSessions.isEmpty ? .gray : .green)
                    .frame(width: 6, height: 6)
                Text("\(sessionStore.activeSessions.count)")
            }

            // Subagents (only if > 0)
            if sessionStore.totalActiveSubagents > 0 {
                HStack(spacing: 3) {
                    Image(systemName: "arrow.branch")
                        .font(.system(size: 7))
                        .foregroundStyle(.cyan)
                    Text("\(sessionStore.totalActiveSubagents)")
                        .foregroundStyle(.cyan)
                }
            }

            // Compacts (only if > 0)
            if sessionStore.totalCompactCount > 0 {
                HStack(spacing: 3) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 7))
                        .foregroundStyle(.purple)
                    Text("\(sessionStore.totalCompactCount)")
                        .foregroundStyle(.purple)
                }
            }

            // Pending permissions (only if > 0)
            if pendingPermissionStore.count > 0 {
                HStack(spacing: 3) {
                    Image(systemName: "hand.raised.fill")
                        .font(.system(size: 7))
                        .foregroundStyle(.orange)
                    Text("\(pendingPermissionStore.count)")
                        .foregroundStyle(.orange)
                }
            }

            // Running sessions (only if > 0)
            if !sessionStore.runningSessions.isEmpty {
                HStack(spacing: 3) {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 7))
                        .foregroundStyle(.green)
                    Text("\(sessionStore.runningSessions.count)")
                        .foregroundStyle(.green)
                }
            }
        }
        .font(.system(size: 9, weight: .medium, design: .monospaced))
        .foregroundStyle(.white)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.black.opacity(0.6))
        .clipShape(Capsule())
        .contentShape(Capsule())
        .onTapGesture {
            let active = sessionStore.activeSessions
            if active.count == 1, let session = active.first {
                IDETerminalFocus.focusSession(session)
            } else if active.count > 1 {
                AppDelegate.showDashboard()
            }
        }
    }
}
