import Foundation

@Observable
final class ApprovalHistoryStore {
    private(set) var history: [ApprovalRecord] = []
    private static let filename = "approval_history.json"
    private var persistTimer: Timer?
    private var isDirty = false

    init() {
        history = LocalStorage.load([ApprovalRecord].self, from: Self.filename) ?? []
    }

    /// Debounced persist - batches rapid writes
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
        LocalStorage.save(history, to: Self.filename)
    }

    func append(_ record: ApprovalRecord) {
        history.insert(record, at: 0)
        if history.count > 500 {
            history.removeLast(history.count - 500)
        }
        schedulePersist()
    }
}
