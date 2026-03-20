import SwiftUI

struct MenuBarView: View {
    @Environment(AppStore.self) var appStore
    @Environment(OverlayManager.self) var overlayManager
    @Environment(AppUpdater.self) var appUpdater
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack(spacing: 8) {
                if let url = Bundle.module.url(forResource: "logo", withExtension: "png", subdirectory: "Images"),
                   let nsImage = NSImage(contentsOf: url) {
                    Image(nsImage: nsImage)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 24, height: 24)
                }
                Text("Masko Code")
                    .font(Constants.heading(size: 14, weight: .bold))
                    .foregroundColor(Constants.textPrimary)
                Spacer()
                Button(action: { AppDelegate.showDashboard() }) {
                    Image(systemName: "arrow.up.forward.square")
                        .foregroundColor(Constants.orangePrimary)
                }
                .buttonStyle(.plain)
            }
            .padding()

            Divider().overlay(Constants.border)

            // Server status
            HStack {
                Circle()
                    .fill(appStore.isAssistantEventIngestionActive ? Color.green : Color.red)
                    .frame(width: 8, height: 8)
                Text(appStore.assistantEventIngestionStatusText)
                    .font(Constants.body(size: 12))
                    .foregroundColor(Constants.textMuted)
                Spacer()
            }
            .padding(.horizontal)
            .padding(.vertical, 6)

            Divider().overlay(Constants.border)

            // Recent notifications
            if appStore.notificationStore.recent.isEmpty {
                Text("No recent notifications")
                    .font(Constants.body(size: 12))
                    .foregroundColor(Constants.textMuted)
                    .padding()
            } else {
                ForEach(appStore.notificationStore.recent.prefix(5)) { notification in
                    NotificationRow(notification: notification, compact: true)
                        .padding(.horizontal)
                        .padding(.vertical, 4)
                }
            }

            Divider().overlay(Constants.border)

            // Active sessions
            if !appStore.sessionStore.activeSessions.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Active Sessions")
                        .font(Constants.heading(size: 11, weight: .medium))
                        .foregroundColor(Constants.textMuted)
                    ForEach(appStore.sessionStore.activeSessions) { session in
                        Button {
                            IDETerminalFocus.focusSession(session)
                        } label: {
                            HStack {
                                Image(systemName: "terminal")
                                    .font(.caption)
                                    .foregroundColor(Constants.orangePrimary)
                                Text(session.projectName ?? "Unknown")
                                    .font(Constants.body(size: 12))
                                    .foregroundColor(Constants.textPrimary)
                                Spacer()
                                Image(systemName: "arrow.up.forward")
                                    .font(.system(size: 9))
                                    .foregroundColor(Constants.textMuted)
                                Text("\(session.eventCount)")
                                    .font(.system(size: 10))
                                    .foregroundColor(Constants.textMuted)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 8)

                Divider().overlay(Constants.border)
            }

            // Mascot overlay toggle
            HStack {
                Image(systemName: overlayManager.isOverlayEnabled ? "eye" : "eye.slash")
                    .font(.system(size: 12))
                    .foregroundColor(Constants.textMuted)
                Text("Mascot Overlay")
                    .font(Constants.body(size: 12))
                    .foregroundColor(Constants.textPrimary)
                Spacer()
                Button(action: {
                    if overlayManager.isOverlayEnabled {
                        overlayManager.disableOverlay()
                    } else {
                        overlayManager.enableOverlay()
                        overlayManager.restoreIfNeeded()
                    }
                }) {
                    Text(overlayManager.isOverlayEnabled ? "Disable" : "Enable")
                        .font(Constants.heading(size: 11, weight: .semibold))
                        .foregroundColor(overlayManager.isOverlayEnabled ? Constants.textMuted : .white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 3)
                        .background(overlayManager.isOverlayEnabled ? Constants.border : Constants.orangePrimary)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal)
            .padding(.vertical, 6)

            Divider().overlay(Constants.border)

            // Quick actions
            Button(action: {
                AppDelegate.showDashboard()
            }) {
                HStack {
                    Text("Open Masko Dashboard")
                        .font(Constants.body(size: 13))
                        .foregroundColor(Constants.textPrimary)
                    Spacer()
                }
            }
            .buttonStyle(.plain)
            .padding(.horizontal)
            .padding(.vertical, 6)

            if appUpdater.isAvailable {
                Button(action: { appUpdater.checkForUpdates() }) {
                    HStack {
                        Text("Check for Updates...")
                            .font(Constants.body(size: 13))
                            .foregroundColor(Constants.textPrimary)
                        Spacer()
                    }
                }
                .buttonStyle(.plain)
                .disabled(!appUpdater.canCheckForUpdates)
                .padding(.horizontal)
                .padding(.vertical, 6)
            }

            Button(action: {
                NSApplication.shared.terminate(nil)
            }) {
                HStack {
                    Text("Quit")
                        .font(Constants.body(size: 13))
                        .foregroundColor(Constants.textMuted)
                    Spacer()
                }
            }
            .buttonStyle(.plain)
            .padding(.horizontal)
            .padding(.vertical, 6)
        }
        .frame(width: 320)
        .background(Constants.surfaceWhite)
    }
}
