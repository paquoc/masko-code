import SwiftUI

struct NotificationCenterView: View {
    @Environment(AppStore.self) var appStore
    @Environment(ViewClock.self) var clock
    @State private var showClearAllConfirmation = false

    var body: some View {
        let _ = clock.tick
        let isEmpty = appStore.notificationStore.notifications.isEmpty
        let hasUnread = appStore.notificationStore.unreadCount > 0

        VStack(spacing: 0) {
            HStack {
                Text("Notifications")
                    .font(Constants.heading(size: 22, weight: .semibold))
                    .foregroundColor(Constants.textPrimary)
                Spacer()
                Button("Mark All Read") {
                    appStore.notificationStore.markAllAsRead()
                }
                .buttonStyle(.plain)
                .font(Constants.body(size: 13, weight: .medium))
                .foregroundColor(hasUnread ? Constants.orangePrimary : Constants.textMuted)
                .disabled(!hasUnread)

                Button("Clear All") {
                    showClearAllConfirmation = true
                }
                .buttonStyle(.plain)
                .font(Constants.body(size: 13, weight: .medium))
                .foregroundColor(isEmpty ? Constants.textMuted : Constants.destructiveRed)
                .disabled(isEmpty)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            Divider().overlay(Constants.border)

            if isEmpty {
                VStack(spacing: 12) {
                    Spacer()
                    Image(systemName: "bell")
                        .font(.system(size: 36))
                        .foregroundColor(Constants.textMuted)
                    Text("No Notifications")
                        .font(Constants.heading(size: 22, weight: .semibold))
                        .foregroundColor(Constants.textPrimary)
                    Text("Notifications from Claude Code and Codex will appear here")
                        .font(Constants.body(size: 14))
                        .foregroundColor(Constants.textMuted)
                    Spacer()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Constants.lightBackground)
            } else {
                List(appStore.notificationStore.notifications) { notification in
                    NotificationRow(notification: notification)
                        .onTapGesture {
                            appStore.notificationStore.markAsRead(notification.id)
                        }
                }
                .listStyle(.inset)
                .scrollContentBackground(.hidden)
                .background(Constants.lightBackground)
            }
        }
        .background(Constants.lightBackground)
        .alert("Clear All Notifications", isPresented: $showClearAllConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Clear All", role: .destructive) {
                appStore.notificationStore.clearAll()
            }
        } message: {
            Text("This will permanently delete all notifications. This action cannot be undone.")
        }
    }
}

struct NotificationRow: View {
    let notification: AppNotification
    var compact: Bool = false

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(notification.isRead ? Color.clear : Constants.orangePrimary)
                .frame(width: 8, height: 8)

            VStack(alignment: .leading, spacing: 2) {
                Text(notification.title)
                    .font(notification.isRead
                        ? Constants.body(size: compact ? 11 : 14)
                        : Constants.heading(size: compact ? 11 : 14, weight: .semibold))
                    .foregroundColor(Constants.textPrimary)

                if let body = notification.body {
                    Text(body)
                        .font(Constants.body(size: compact ? 10 : 13))
                        .foregroundColor(Constants.textMuted)
                        .lineLimit(compact ? 1 : 2)
                }

                if !compact {
                    HStack {
                        Text(notification.category.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                            .font(Constants.body(size: 11, weight: .medium))
                            .foregroundColor(Color(red: 180/255, green: 90/255, blue: 0))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(Constants.chip, in: Capsule())

                        Spacer()

                        Text(relativeTimeString(from: notification.createdAt))
                            .font(Constants.body(size: 11))
                            .foregroundColor(Constants.textMuted)
                    }
                }
            }
        }
        .padding(.vertical, compact ? 2 : 4)
        .opacity(notification.isRead ? 0.7 : 1)
    }
}
