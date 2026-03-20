import SwiftUI

enum StatsOverlayVisibility {
    static func shouldShow(
        activeSessions: Int,
        activeSubagents: Int,
        compactCount: Int,
        pendingPermissions: Int,
        runningSessions: Int
    ) -> Bool {
        activeSessions > 0 ||
            activeSubagents > 0 ||
            compactCount > 0 ||
            pendingPermissions > 0 ||
            runningSessions > 0
    }
}

/// Compact stats pill displayed above the mascot overlay
struct StatsOverlayView: View {
    @Environment(SessionStore.self) var sessionStore
    @Environment(PendingPermissionStore.self) var pendingPermissionStore

    var body: some View {
        #if DEBUG
        let _ = Self._printChanges()
        let _ = PerfMonitor.shared.track(.viewBodyStatsOverlay)
        #endif
        let activeSessions = sessionStore.activeSessions.count
        let activeSubagents = sessionStore.totalActiveSubagents
        let compactCount = sessionStore.totalCompactCount
        let pendingPermissions = pendingPermissionStore.count
        let runningSessions = sessionStore.runningSessions.count

        if StatsOverlayVisibility.shouldShow(
            activeSessions: activeSessions,
            activeSubagents: activeSubagents,
            compactCount: compactCount,
            pendingPermissions: pendingPermissions,
            runningSessions: runningSessions
        ) {
            HStack(spacing: 8) {
                // Active sessions
                HStack(spacing: 3) {
                    Circle()
                        .fill(activeSessions == 0 ? .gray : .green)
                        .frame(width: 6, height: 6)
                    Text("\(activeSessions)")
                }

                // Subagents (only if > 0)
                if activeSubagents > 0 {
                    HStack(spacing: 3) {
                        Image(systemName: "arrow.branch")
                            .font(.system(size: 7))
                            .foregroundStyle(.cyan)
                        Text("\(activeSubagents)")
                            .foregroundStyle(.cyan)
                    }
                }

                // Compacts (only if > 0)
                if compactCount > 0 {
                    HStack(spacing: 3) {
                        Image(systemName: "arrow.triangle.2.circlepath")
                            .font(.system(size: 7))
                            .foregroundStyle(.purple)
                        Text("\(compactCount)")
                            .foregroundStyle(.purple)
                    }
                }

                // Pending permissions (only if > 0)
                if pendingPermissions > 0 {
                    HStack(spacing: 3) {
                        Image(systemName: "hand.raised.fill")
                            .font(.system(size: 7))
                            .foregroundStyle(.orange)
                        Text("\(pendingPermissions)")
                            .foregroundStyle(.orange)
                    }
                }

                // Running sessions (only if > 0)
                if runningSessions > 0 {
                    HStack(spacing: 3) {
                        Image(systemName: "bolt.fill")
                            .font(.system(size: 7))
                            .foregroundStyle(.green)
                        Text("\(runningSessions)")
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
        } else {
            EmptyView()
        }
    }
}
