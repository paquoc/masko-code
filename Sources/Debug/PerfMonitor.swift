#if DEBUG
import Foundation
import os

/// Lightweight performance monitor for detecting hangs, excessive re-renders,
/// and memory issues. Only compiled in DEBUG builds — zero cost in release.
///
/// Usage:
///   PerfMonitor.shared.start()          // Call once at app launch
///   PerfMonitor.shared.track(.setInput)  // Increment event counter
///   PerfMonitor.shared.stop()            // Teardown
///
/// Reads live stats via `PerfMonitor.shared.snapshot()`
@MainActor
final class PerfMonitor {
    static let shared = PerfMonitor()

    // MARK: - Event Types

    enum Event: String, CaseIterable {
        case setInput = "setInput"
        case evaluateAndFire = "evaluateAndFire"
        case setFrame = "setFrame"
        case syncPermissionPanel = "syncPermissionPanel"
        case viewBodyStateMachine = "viewBody.StateMachineView"
        case viewBodyStatsHUD = "viewBody.StatsHUD"
        case viewBodyDebugHUD = "viewBody.DebugHUD"
        case viewBodyPermissionStack = "viewBody.PermissionStack"
        case viewBodyStatsOverlay = "viewBody.StatsOverlay"
    }

    // MARK: - Snapshot (read-only stats for display)

    struct Snapshot {
        let countsPerSecond: [Event: Int]
        let mainThreadStallMs: Double   // longest stall in current window
        let memoryMB: Double            // RSS in MB
        let livingAVPlayers: Int
    }

    // MARK: - Private state

    private var counters: [Event: Int] = [:]
    private var previousCounters: [Event: Int] = [:]
    private var ratesPerSecond: [Event: Int] = [:]

    private var stallDetectionTimer: DispatchSourceTimer?
    private var lastMainThreadPing: CFAbsoluteTime = 0
    private var worstStallMs: Double = 0

    private var reportTimer: Timer?
    private var isRunning = false

    private(set) var livingAVPlayers: Int = 0

    // os_signpost for Instruments integration
    nonisolated static let signpostLog = OSLog(subsystem: "com.masko.desktop", category: "Perf")

    private init() {
        for event in Event.allCases { counters[event] = 0 }
    }

    // MARK: - Lifecycle

    func start() {
        guard !isRunning else { return }
        isRunning = true

        for event in Event.allCases {
            counters[event] = 0
            previousCounters[event] = 0
            ratesPerSecond[event] = 0
        }

        startStallDetection()
        startReportTimer()

        print("[PerfMonitor] Started")
    }

    func stop() {
        isRunning = false
        stallDetectionTimer?.cancel()
        stallDetectionTimer = nil
        reportTimer?.invalidate()
        reportTimer = nil
        print("[PerfMonitor] Stopped")
    }

    // MARK: - Event Tracking

    nonisolated func track(_ event: Event) {
        // Fire-and-forget onto main actor — counter increment is cheap
        Task { @MainActor in
            self.counters[event, default: 0] += 1
        }
    }

    /// Track a block's duration and log if it exceeds a threshold.
    /// Returns the duration in milliseconds.
    @discardableResult
    nonisolated func measure(_ event: Event, threshold: Double = 16, _ block: () -> Void) -> Double {
        let start = CFAbsoluteTimeGetCurrent()
        block()
        let elapsed = (CFAbsoluteTimeGetCurrent() - start) * 1000
        if elapsed > threshold {
            os_signpost(.event, log: PerfMonitor.signpostLog, name: "slow_op",
                        "%{public}s took %.1fms", event.rawValue, elapsed)
            print("[PerfMonitor] SLOW: \(event.rawValue) took \(String(format: "%.1f", elapsed))ms (threshold: \(Int(threshold))ms)")
        }
        Task { @MainActor in
            self.counters[event, default: 0] += 1
        }
        return elapsed
    }

    // MARK: - AVPlayer Tracking

    func avPlayerCreated() { livingAVPlayers += 1 }
    func avPlayerDestroyed() { livingAVPlayers = max(0, livingAVPlayers - 1) }

    // MARK: - Snapshot

    func snapshot() -> Snapshot {
        Snapshot(
            countsPerSecond: ratesPerSecond,
            mainThreadStallMs: worstStallMs,
            memoryMB: currentMemoryMB(),
            livingAVPlayers: livingAVPlayers
        )
    }

    // MARK: - Main Thread Stall Detection

    /// Runs a timer on a background queue that pings the main thread every 200ms.
    /// If the main thread doesn't respond within 250ms, we record a stall.
    private func startStallDetection() {
        let queue = DispatchQueue(label: "ai.masko.perfmonitor.stall", qos: .userInteractive)
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(200))

        timer.setEventHandler { [weak self] in
            let pingTime = CFAbsoluteTimeGetCurrent()

            DispatchQueue.main.async {
                let responseTime = CFAbsoluteTimeGetCurrent()
                let stallMs = (responseTime - pingTime) * 1000

                Task { @MainActor in
                    guard let self, self.isRunning else { return }
                    if stallMs > self.worstStallMs {
                        self.worstStallMs = stallMs
                    }
                    if stallMs > 250 {
                        os_signpost(.event, log: PerfMonitor.signpostLog, name: "main_thread_stall",
                                    "Stall: %.0fms", stallMs)
                        print("[PerfMonitor] STALL: main thread blocked for \(String(format: "%.0f", stallMs))ms")
                    }
                }
            }
        }
        timer.resume()
        stallDetectionTimer = timer
    }

    // MARK: - Periodic Report

    /// Every second, compute rates and optionally log warnings.
    private func startReportTimer() {
        reportTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isRunning else { return }
                self.computeRates()
            }
        }
    }

    private func computeRates() {
        for event in Event.allCases {
            let current = counters[event, default: 0]
            let previous = previousCounters[event, default: 0]
            let rate = current - previous
            ratesPerSecond[event] = rate
            previousCounters[event] = current

            // Warn on hot paths
            switch event {
            case .setInput where rate > 10:
                print("[PerfMonitor] WARNING: \(event.rawValue) at \(rate)/sec (target: <10)")
            case .setFrame where rate > 5:
                print("[PerfMonitor] WARNING: \(event.rawValue) at \(rate)/sec (target: <5)")
            case .viewBodyStateMachine, .viewBodyStatsHUD, .viewBodyDebugHUD,
                 .viewBodyPermissionStack, .viewBodyStatsOverlay:
                if rate > 5 {
                    print("[PerfMonitor] WARNING: \(event.rawValue) at \(rate)/sec (target: <5)")
                }
            default: break
            }
        }

        // Reset worst stall for next window
        let stall = worstStallMs
        if stall > 100 {
            print("[PerfMonitor] Worst stall this second: \(String(format: "%.0f", stall))ms")
        }
        worstStallMs = 0

        // Memory check
        let mem = currentMemoryMB()
        if mem > 500 {
            print("[PerfMonitor] WARNING: Memory at \(String(format: "%.0f", mem))MB (target: <500MB)")
        }

        // AVPlayer check
        if livingAVPlayers > 2 {
            print("[PerfMonitor] WARNING: \(livingAVPlayers) living AVPlayers (target: <=2)")
        }
    }

    // MARK: - Memory

    private func currentMemoryMB() -> Double {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        guard result == KERN_SUCCESS else { return 0 }
        return Double(info.resident_size) / 1_048_576
    }
}
#endif
