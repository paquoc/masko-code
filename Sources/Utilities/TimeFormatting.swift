import Foundation

@Observable
final class ViewClock {
    static let shared = ViewClock()

    private(set) var tick: UInt = 0
    private var timer: Timer?

    private init() {
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.tick &+= 1
        }
    }

    deinit {
        timer?.invalidate()
    }
}

private let dateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "MMM d"
    return f
}()

func relativeTimeString(from date: Date) -> String {
    let seconds = -date.timeIntervalSinceNow

    if seconds < 60 {
        return "just now"
    }
    if seconds < 3600 {
        return "\(Int(seconds / 60))m"
    }
    if seconds < 86400 {
        return "\(Int(seconds / 3600))h"
    }
    if seconds < 172800 {
        return "yesterday"
    }

    return dateFormatter.string(from: date)
}
