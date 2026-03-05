import SwiftUI
import AVKit
import AppKit

/// NSView subclass that auto-sizes AVPlayerLayer on layout changes
class PlayerContainerView: NSView {
    var playerLayer: AVPlayerLayer?

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer?.sublayers?.forEach { $0.frame = bounds }
        CATransaction.commit()
    }
}

/// Loops an HEVC video with transparent background
struct MascotVideoView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> NSView {
        let container = PlayerContainerView()
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor.clear.cgColor
        container.layer?.isOpaque = false

        let player = AVPlayer(url: url)
        player.isMuted = true
        #if DEBUG
        PerfMonitor.shared.avPlayerCreated()
        #endif

        let playerLayer = AVPlayerLayer(player: player)
        playerLayer.videoGravity = .resizeAspect
        playerLayer.backgroundColor = .clear
        playerLayer.isOpaque = false

        container.playerLayer = playerLayer
        if let layer = container.layer {
            layer.addSublayer(playerLayer)
        }

        // Loop — store observer token for cleanup
        let observer = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: player.currentItem,
            queue: .main
        ) { _ in
            player.seek(to: .zero)
            player.play()
        }

        player.play()

        context.coordinator.player = player
        context.coordinator.playerLayer = playerLayer
        context.coordinator.loopObserver = observer

        return container
    }

    func updateNSView(_ nsView: NSView, context: Context) {}

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.cleanup()
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    class Coordinator {
        var player: AVPlayer?
        var playerLayer: AVPlayerLayer?
        var loopObserver: NSObjectProtocol?

        func cleanup() {
            if let obs = loopObserver {
                NotificationCenter.default.removeObserver(obs)
                loopObserver = nil
            }
            player?.pause()
            player?.replaceCurrentItem(with: nil)
            playerLayer?.removeFromSuperlayer()
            playerLayer?.player = nil
            #if DEBUG
            if player != nil {
                Task { @MainActor in PerfMonitor.shared.avPlayerDestroyed() }
            }
            #endif
            player = nil
            playerLayer = nil
        }

        deinit {
            cleanup()
        }
    }
}
