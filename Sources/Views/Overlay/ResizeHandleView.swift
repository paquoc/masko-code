import SwiftUI
import AppKit

/// A drag handle in the bottom-right corner for resizing the mascot overlay.
/// Uses NSView mouse tracking with screen coordinates to avoid jitter during resize.
struct ResizeHandle: NSViewRepresentable {
    let currentSize: Int
    let onDrag: (Int) -> Void
    let onDragEnd: (Int) -> Void

    func makeNSView(context: Context) -> ResizeHandleNSView {
        let view = ResizeHandleNSView()
        view.currentSize = currentSize
        view.onDrag = onDrag
        view.onDragEnd = onDragEnd
        return view
    }

    func updateNSView(_ nsView: ResizeHandleNSView, context: Context) {
        nsView.currentSize = currentSize
        nsView.onDrag = onDrag
        nsView.onDragEnd = onDragEnd
    }
}

final class ResizeHandleNSView: NSView {
    var currentSize: Int = 150
    var onDrag: ((Int) -> Void)?
    var onDragEnd: ((Int) -> Void)?

    private var dragStartPoint: NSPoint = .zero
    private var dragStartSize: Int = 0

    private var trackingArea: NSTrackingArea?

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
    }

    required init?(coder: NSCoder) { fatalError() }

    // Prevent the window from dragging when clicking the handle
    override var mouseDownCanMoveWindow: Bool { false }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let existing = trackingArea { removeTrackingArea(existing) }
        let area = NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeAlways],
            owner: self
        )
        addTrackingArea(area)
        trackingArea = area
    }

    override func mouseEntered(with event: NSEvent) {
        NSCursor.openHand.push()
    }

    override func mouseExited(with event: NSEvent) {
        NSCursor.pop()
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }

        // Draw 3 diagonal grip lines — orange with white outline for visibility on any background
        let inset: CGFloat = 4
        let spacing: CGFloat = 5
        let orange = NSColor(srgbRed: 249/255, green: 93/255, blue: 2/255, alpha: 1.0)

        // White outline pass
        ctx.setStrokeColor(NSColor.white.cgColor)
        ctx.setLineWidth(4)
        ctx.setLineCap(.round)
        for i in 0..<3 {
            let offset = CGFloat(i) * spacing
            ctx.move(to: CGPoint(x: bounds.maxX - inset - offset, y: bounds.minY + inset))
            ctx.addLine(to: CGPoint(x: bounds.maxX - inset, y: bounds.minY + inset + offset))
        }
        ctx.strokePath()

        // Orange fill pass
        ctx.setStrokeColor(orange.cgColor)
        ctx.setLineWidth(2)
        ctx.setLineCap(.round)
        for i in 0..<3 {
            let offset = CGFloat(i) * spacing
            ctx.move(to: CGPoint(x: bounds.maxX - inset - offset, y: bounds.minY + inset))
            ctx.addLine(to: CGPoint(x: bounds.maxX - inset, y: bounds.minY + inset + offset))
        }
        ctx.strokePath()
    }

    override func mouseDown(with event: NSEvent) {
        dragStartPoint = NSEvent.mouseLocation
        dragStartSize = currentSize
    }

    override func mouseDragged(with event: NSEvent) {
        let current = NSEvent.mouseLocation
        let deltaX = current.x - dragStartPoint.x
        // In macOS screen coords, Y increases upward — dragging down = negative deltaY
        let deltaY = -(current.y - dragStartPoint.y)
        // Use the larger of horizontal/vertical delta for intuitive diagonal drag
        let delta = max(deltaX, deltaY)
        let newSize = max(50, min(500, dragStartSize + Int(delta)))
        currentSize = newSize
        onDrag?(newSize)
    }

    override func mouseUp(with event: NSEvent) {
        onDragEnd?(currentSize)
    }
}


