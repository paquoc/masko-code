import Foundation

@Observable
final class NotificationStore {
    private(set) var notifications: [AppNotification] = []
    private static let filename = "notifications.json"
    private var persistTimer: Timer?
    private var isDirty = false

    private(set) var unreadCount: Int = 0

    init() {
        notifications = LocalStorage.load([AppNotification].self, from: Self.filename) ?? []
        recalculateUnreadCount()
    }

    /// Debounced persist — batches rapid writes
    private func schedulePersist() {
        isDirty = true
        guard persistTimer == nil else { return }
        persistTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: false) { [weak self] _ in
            self?.persistTimer = nil
            self?.persistNow()
        }
    }

    private func persistNow() {
        guard isDirty else { return }
        isDirty = false
        LocalStorage.save(notifications, to: Self.filename)
    }

    private func recalculateUnreadCount() {
        unreadCount = notifications.filter { !$0.isRead }.count
    }

    var recent: [AppNotification] {
        Array(notifications.prefix(10))
    }

    func append(_ notification: AppNotification) {
        notifications.insert(notification, at: 0)
        // Cap at 500 to avoid unbounded growth
        if notifications.count > 500 {
            notifications.removeLast(notifications.count - 500)
        }
        schedulePersist()
        recalculateUnreadCount()
    }

    func markAsRead(_ id: UUID) {
        if let index = notifications.firstIndex(where: { $0.id == id }) {
            notifications[index].isRead = true
            notifications[index].readAt = Date()
            schedulePersist()
            recalculateUnreadCount()
        }
    }

    func markAllAsRead() {
        var changed = false
        for i in notifications.indices where !notifications[i].isRead {
            notifications[i].isRead = true
            notifications[i].readAt = Date()
            changed = true
        }
        if changed { schedulePersist() }
        recalculateUnreadCount()
    }

    func clearAll() {
        notifications.removeAll()
        unreadCount = 0
        persistTimer?.invalidate()
        persistTimer = nil
        isDirty = false
        LocalStorage.save(notifications, to: Self.filename)
    }
}
