#if DEBUG
import SwiftUI

/// Live performance stats overlay — shown in DebugHUD when PerfMonitor is running.
struct PerfOverlayView: View {
    @State private var snapshot = PerfMonitor.Snapshot(
        countsPerSecond: [:], mainThreadStallMs: 0, memoryMB: 0, livingAVPlayers: 0
    )
    private let refreshTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("PERF MONITOR")
                .fontWeight(.bold)
                .foregroundStyle(.cyan)

            // Stall
            let stallColor: Color = snapshot.mainThreadStallMs > 250 ? .red :
                                    snapshot.mainThreadStallMs > 100 ? .orange : .green
            Text("Stall: \(Int(snapshot.mainThreadStallMs))ms")
                .foregroundStyle(stallColor)

            // Memory
            let memColor: Color = snapshot.memoryMB > 500 ? .red :
                                  snapshot.memoryMB > 300 ? .orange : .green
            Text("RSS: \(Int(snapshot.memoryMB))MB")
                .foregroundStyle(memColor)

            // AVPlayers
            let playerColor: Color = snapshot.livingAVPlayers > 2 ? .red : .green
            Text("AVPlayers: \(snapshot.livingAVPlayers)")
                .foregroundStyle(playerColor)

            Divider().background(.white.opacity(0.3))

            // Event rates
            ForEach(PerfMonitor.Event.allCases, id: \.rawValue) { event in
                let rate = snapshot.countsPerSecond[event] ?? 0
                if rate > 0 {
                    let color: Color = rate > 10 ? .red : rate > 5 ? .orange : .green
                    Text("\(event.rawValue): \(rate)/s")
                        .foregroundStyle(color)
                }
            }
        }
        .font(.system(size: 11, design: .monospaced))
        .padding(4)
        .background(Color.black.opacity(0.7))
        .cornerRadius(4)
        .onReceive(refreshTimer) { _ in
            snapshot = PerfMonitor.shared.snapshot()
        }
    }
}
#endif
