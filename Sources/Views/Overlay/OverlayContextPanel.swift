import AppKit
import SwiftUI

// MARK: - Context Menu Panel

/// A branded floating panel that replaces the native NSMenu on right-click.
/// Styled to match the app's design system (Fredoka/Rubik fonts, orange accents, rounded corners).
@MainActor
final class ContextMenuPanel: NSPanel {
    var onDismiss: (() -> Void)?
    private var localMouseMonitor: Any?
    private var globalMouseMonitor: Any?

    init() {
        super.init(
            contentRect: .zero,
            styleMask: [.nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        titlebarAppearsTransparent = true
        titleVisibility = .hidden
        isFloatingPanel = true
        level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.maximumWindow)) + 1)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        isMovableByWindowBackground = false
        hidesOnDeactivate = false
        animationBehavior = .utilityWindow
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    }

    func showAt(point: NSPoint, mascotFrame: NSRect? = nil, with content: some View) {
        let hostingController = TransparentHostingController(rootView: content)
        contentView = hostingController.view
        contentViewController = hostingController

        // Size to fit content
        let fittingSize = hostingController.view.fittingSize
        let panelSize = NSSize(width: max(fittingSize.width, 180), height: fittingSize.height)

        // Position at click point, menu drops down from cursor
        let screen = NSScreen.main?.visibleFrame ?? .zero
        var origin = NSPoint(x: point.x, y: point.y - panelSize.height)
        origin.x = max(screen.minX, min(origin.x, screen.maxX - panelSize.width))
        origin.y = max(screen.minY, min(origin.y, screen.maxY - panelSize.height))

        setFrame(NSRect(origin: origin, size: panelSize), display: true)
        orderFrontRegardless()
        SkyLightOperator.shared.delegateWindow(self)

        // Dismiss on click outside
        globalMouseMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            self?.dismiss()
        }
        localMouseMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
            guard let self else { return event }
            // Convert event location to screen coords first, then to panel coords
            let screenPoint = event.window?.convertPoint(toScreen: event.locationInWindow) ?? event.locationInWindow
            let locationInPanel = self.convertPoint(fromScreen: screenPoint)
            if !self.contentView!.frame.contains(locationInPanel) {
                self.dismiss()
            }
            return event
        }
    }

    func dismiss() {
        if let m = globalMouseMonitor { NSEvent.removeMonitor(m); globalMouseMonitor = nil }
        if let m = localMouseMonitor { NSEvent.removeMonitor(m); localMouseMonitor = nil }
        onDismiss?()
        onDismiss = nil
        orderOut(nil)
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

// MARK: - Context Menu Content View

struct OverlayContextMenuContent: View {
    let onSnooze: (Int) -> Void     // 0 = indefinite
    let onResize: (OverlaySize) -> Void
    let onDialogScale: (Double) -> Void
    let onDialogPreview: (Bool) -> Void
    let onOpacity: (Double) -> Void
    let onClose: () -> Void
    let onDisable: () -> Void
    let dismiss: () -> Void

    @State private var expandedSection: Section?
    @State private var hoveredItem: String?
    @State private var customMinutes: String = ""
    @State private var showCustomInput = false

    @AppStorage("overlay_size") private var currentSizePixels: Int = OverlaySize.medium.rawValue
    @AppStorage("overlay_resize_mode") private var resizeMode = false
    @AppStorage("overlay_opacity") private var currentOpacity: Double = 1.0
    @AppStorage("permission_panel_scale") private var currentDialogScale: Double = 1.0

    private enum Section { case snooze, size, dialogScale, transparency }

    var body: some View {
        VStack(spacing: 0) {
            if expandedSection == .snooze {
                // Snooze sub-items
                menuHeader("Snooze") { expandedSection = nil }
                divider
                snoozeItem("15 minutes", minutes: 15)
                snoozeItem("30 minutes", minutes: 30)
                snoozeItem("1 hour", minutes: 60)
                snoozeItem("2 hours", minutes: 120)
                snoozeItem("Until I wake it", minutes: 0)
                divider
                customSnoozeRow
            } else if expandedSection == .size {
                // Size sub-items
                menuHeader("Size") { expandedSection = nil }
                divider
                sizeItem("Small", size: .small)
                sizeItem("Medium", size: .medium)
                sizeItem("Large", size: .large)
                sizeItem("Extra Large", size: .extraLarge)
                divider
                actionItem("Resize...", icon: "arrow.up.left.and.arrow.down.right") {
                    resizeMode = true
                    dismiss()
                }
            } else if expandedSection == .dialogScale {
                // Dialog scale slider
                menuHeader("Dialog Size") {
                    expandedSection = nil
                    onDialogPreview(false)
                }
                divider
                dialogScaleSlider
                    .onAppear { onDialogPreview(true) }
            } else if expandedSection == .transparency {
                // Transparency slider
                menuHeader("Transparency") { expandedSection = nil }
                divider
                opacitySlider
            } else {
                // Main menu
                expandableItem("Snooze", icon: "moon.zzz.fill") { expandedSection = .snooze }
                expandableItem("Size", icon: "arrow.up.left.and.arrow.down.right") { expandedSection = .size }
                expandableItem("Dialog Size", icon: "text.bubble") { expandedSection = .dialogScale }
                expandableItem("Transparency", icon: "circle.lefthalf.filled") { expandedSection = .transparency }
                divider
                openDashboardItem
                disableItem
                closeItem
            }
        }
        .padding(6)
        .background(Constants.surfaceWhite)
        .clipShape(RoundedRectangle(cornerRadius: Constants.cornerRadiusSmall))
        .overlay(
            RoundedRectangle(cornerRadius: Constants.cornerRadiusSmall)
                .stroke(Constants.border, lineWidth: 1)
        )
        .shadow(color: Constants.cardHoverShadowColor, radius: Constants.cardHoverShadowRadius, x: 0, y: Constants.cardHoverShadowY)
        .frame(width: 200)
        .animation(.easeInOut(duration: 0.15), value: expandedSection)
        .onDisappear { onDialogPreview(false) }
    }

    // MARK: - Menu Items

    private func menuHeader(_ title: String, onBack: @escaping () -> Void) -> some View {
        Button(action: onBack) {
            HStack(spacing: 6) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Constants.textMuted)
                Text(title)
                    .font(Constants.heading(size: 13, weight: .medium))
                    .foregroundStyle(Constants.textPrimary)
                Spacer()
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func expandableItem(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 12))
                    .foregroundStyle(Constants.textMuted)
                    .frame(width: 16)
                Text(title)
                    .font(Constants.heading(size: 13, weight: .medium))
                    .foregroundStyle(Constants.textPrimary)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Constants.textMuted)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(hoveredItem == title ? Constants.orangePrimarySubtle : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hoveredItem = $0 ? title : nil }
    }

    private func actionItem(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 12))
                    .foregroundStyle(Constants.textMuted)
                    .frame(width: 16)
                Text(title)
                    .font(Constants.body(size: 13, weight: .medium))
                    .foregroundStyle(Constants.textPrimary)
                Spacer()
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(hoveredItem == title ? Constants.orangePrimarySubtle : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hoveredItem = $0 ? title : nil }
    }

    private func snoozeItem(_ title: String, minutes: Int) -> some View {
        Button {
            onSnooze(minutes)
            dismiss()
        } label: {
            HStack(spacing: 8) {
                Text(title)
                    .font(Constants.body(size: 13, weight: .medium))
                    .foregroundStyle(Constants.textPrimary)
                Spacer()
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(hoveredItem == "snooze-\(minutes)" ? Constants.orangePrimarySubtle : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hoveredItem = $0 ? "snooze-\(minutes)" : nil }
    }

    private var customSnoozeRow: some View {
        HStack(spacing: 6) {
            TextField("Min", text: $customMinutes)
                .textFieldStyle(.plain)
                .font(Constants.body(size: 13, weight: .medium))
                .foregroundStyle(Constants.textPrimary)
                .frame(width: 50)
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
                .background(Constants.border.opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .onSubmit {
                    if let mins = Int(customMinutes), mins > 0 {
                        onSnooze(mins)
                        dismiss()
                    }
                }

            Text("min")
                .font(Constants.body(size: 12, weight: .medium))
                .foregroundStyle(Constants.textMuted)

            Spacer()

            Button {
                if let mins = Int(customMinutes), mins > 0 {
                    onSnooze(mins)
                    dismiss()
                }
            } label: {
                Text("Go")
                    .font(Constants.heading(size: 11, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Int(customMinutes) ?? 0 > 0 ? Constants.orangePrimary : Color.gray.opacity(0.5))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)
            .disabled((Int(customMinutes) ?? 0) <= 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
    }

    private func sizeItem(_ title: String, size: OverlaySize) -> some View {
        let isActive = currentSizePixels == size.rawValue
        return Button {
            onResize(size)
            dismiss()
        } label: {
            HStack(spacing: 8) {
                Text(title)
                    .font(Constants.body(size: 13, weight: isActive ? .semibold : .medium))
                    .foregroundStyle(isActive ? Constants.orangePrimary : Constants.textPrimary)
                Spacer()
                if isActive {
                    Image(systemName: "checkmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Constants.orangePrimary)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(hoveredItem == "size-\(title)" ? Constants.orangePrimarySubtle : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hoveredItem = $0 ? "size-\(title)" : nil }
    }

    private var dialogScaleSlider: some View {
        VStack(spacing: 6) {
            GeometryReader { geo in
                let trackHeight: CGFloat = 6
                let thumbSize: CGFloat = 18
                let usableWidth = geo.size.width - thumbSize
                // Map 0.8–2.5 scale to 0–1 fraction
                let fraction = (currentDialogScale - 0.8) / 1.7
                let thumbX = thumbSize / 2 + usableWidth * fraction

                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Constants.textMuted.opacity(0.15))
                        .frame(height: trackHeight)

                    Capsule()
                        .fill(Constants.orangePrimary)
                        .frame(width: thumbX, height: trackHeight)

                    Circle()
                        .fill(Color.white)
                        .overlay(Circle().stroke(Constants.orangePrimary, lineWidth: 2))
                        .frame(width: thumbSize, height: thumbSize)
                        .offset(x: thumbX - thumbSize / 2)
                }
                .frame(height: geo.size.height)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { drag in
                            let raw = (drag.location.x - thumbSize / 2) / usableWidth
                            let clamped = min(max(raw, 0), 1)
                            let stepped = (clamped * 17).rounded() / 17 // ~6% steps
                            currentDialogScale = 0.8 + stepped * 1.7
                            onDialogScale(currentDialogScale)
                        }
                )
            }
            .frame(height: 22)

            Text("\(Int(currentDialogScale * 100))%")
                .font(Constants.body(size: 11, weight: .medium))
                .foregroundStyle(Constants.textMuted)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
    }

    private var opacitySlider: some View {
        VStack(spacing: 6) {
            GeometryReader { geo in
                let trackHeight: CGFloat = 6
                let thumbSize: CGFloat = 18
                let usableWidth = geo.size.width - thumbSize
                let fraction = (currentOpacity - 0.1) / 0.9
                let thumbX = thumbSize / 2 + usableWidth * fraction

                ZStack(alignment: .leading) {
                    // Track background
                    Capsule()
                        .fill(Constants.textMuted.opacity(0.15))
                        .frame(height: trackHeight)

                    // Filled track
                    Capsule()
                        .fill(Constants.orangePrimary)
                        .frame(width: thumbX, height: trackHeight)

                    // Thumb
                    Circle()
                        .fill(Color.white)
                        .overlay(Circle().stroke(Constants.orangePrimary, lineWidth: 2))
                        .frame(width: thumbSize, height: thumbSize)
                        .offset(x: thumbX - thumbSize / 2)
                }
                .frame(height: geo.size.height)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { drag in
                            let raw = (drag.location.x - thumbSize / 2) / usableWidth
                            let clamped = min(max(raw, 0), 1)
                            let stepped = (clamped * 18).rounded() / 18 // ~5% steps
                            currentOpacity = 0.1 + stepped * 0.9
                            onOpacity(currentOpacity)
                        }
                )
            }
            .frame(height: 22)

            Text("\(Int(currentOpacity * 100))%")
                .font(Constants.body(size: 11, weight: .medium))
                .foregroundStyle(Constants.textMuted)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
    }

    private var disableItem: some View {
        Button {
            onDisable()
            dismiss()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "eye.slash")
                    .font(.system(size: 12))
                    .foregroundStyle(Constants.textMuted)
                    .frame(width: 16)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Disable Mascot")
                        .font(Constants.heading(size: 13, weight: .medium))
                        .foregroundStyle(Constants.textPrimary)
                    Text("Notifications will continue")
                        .font(Constants.body(size: 10))
                        .foregroundStyle(Constants.textMuted)
                }
                Spacer()
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(hoveredItem == "disable" ? Constants.orangePrimarySubtle : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hoveredItem = $0 ? "disable" : nil }
    }

    private var openDashboardItem: some View {
        Button {
            AppDelegate.showDashboard()
            dismiss()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "square.grid.2x2")
                    .font(.system(size: 12))
                    .foregroundStyle(Constants.textMuted)
                    .frame(width: 16)
                Text("Open Dashboard")
                    .font(Constants.heading(size: 13, weight: .medium))
                    .foregroundStyle(Constants.textPrimary)
                Spacer()
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(hoveredItem == "dashboard" ? Constants.orangePrimarySubtle : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hoveredItem = $0 ? "dashboard" : nil }
    }

    private var closeItem: some View {
        Button {
            onClose()
            dismiss()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "xmark")
                    .font(.system(size: 12))
                    .foregroundStyle(Color(.sRGB, red: 220/255, green: 38/255, blue: 38/255))
                    .frame(width: 16)
                Text("Close")
                    .font(Constants.heading(size: 13, weight: .medium))
                    .foregroundStyle(Color(.sRGB, red: 220/255, green: 38/255, blue: 38/255))
                Spacer()
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(hoveredItem == "close" ? Color(.sRGB, red: 220/255, green: 38/255, blue: 38/255).opacity(0.08) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hoveredItem = $0 ? "close" : nil }
    }

    private var divider: some View {
        Rectangle()
            .fill(Constants.border)
            .frame(height: 1)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
    }
}

// MARK: - Standalone Stats Context Menu (notification-only mode)

struct StandaloneContextMenuContent: View {
    let onEnableMascot: () -> Void
    let onOpenDashboard: () -> Void
    let onClose: () -> Void
    let dismiss: () -> Void
    @State private var hoveredItem: String?

    private var divider: some View {
        Rectangle()
            .fill(Constants.border)
            .frame(height: 1)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Open Dashboard
            Button {
                onOpenDashboard()
                dismiss()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "square.grid.2x2")
                        .font(.system(size: 12))
                        .foregroundStyle(Constants.textMuted)
                        .frame(width: 16)
                    Text("Open Dashboard")
                        .font(Constants.heading(size: 13, weight: .medium))
                        .foregroundStyle(Constants.textPrimary)
                    Spacer()
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(hoveredItem == "dashboard" ? Constants.orangePrimarySubtle : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hoveredItem = $0 ? "dashboard" : nil }

            // Enable Mascot
            Button {
                onEnableMascot()
                dismiss()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "wand.and.stars")
                        .font(.system(size: 12))
                        .foregroundStyle(Constants.orangePrimary)
                        .frame(width: 16)
                    Text("Enable Mascot")
                        .font(Constants.heading(size: 13, weight: .medium))
                        .foregroundStyle(Constants.textPrimary)
                    Spacer()
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(hoveredItem == "enable" ? Constants.orangePrimarySubtle : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hoveredItem = $0 ? "enable" : nil }

            // Close
            Button {
                onClose()
                dismiss()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "xmark")
                        .font(.system(size: 12))
                        .foregroundStyle(Color(.sRGB, red: 220/255, green: 38/255, blue: 38/255))
                        .frame(width: 16)
                    Text("Close")
                        .font(Constants.heading(size: 13, weight: .medium))
                        .foregroundStyle(Color(.sRGB, red: 220/255, green: 38/255, blue: 38/255))
                    Spacer()
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(hoveredItem == "close" ? Color(.sRGB, red: 220/255, green: 38/255, blue: 38/255).opacity(0.08) : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hoveredItem = $0 ? "close" : nil }
        }
        .padding(6)
        .background(Constants.surfaceWhite)
        .clipShape(RoundedRectangle(cornerRadius: Constants.cornerRadiusSmall))
        .overlay(
            RoundedRectangle(cornerRadius: Constants.cornerRadiusSmall)
                .stroke(Constants.border, lineWidth: 1)
        )
        .shadow(color: Constants.cardHoverShadowColor, radius: Constants.cardHoverShadowRadius, x: 0, y: Constants.cardHoverShadowY)
        .frame(width: 200)
    }
}

// MARK: - Right-Click Gesture (NSView-based)

/// Invisible NSView that intercepts right-click and reports the screen-space click position.
struct RightClickDetector: NSViewRepresentable {
    let onRightClick: (NSPoint) -> Void

    func makeNSView(context: Context) -> RightClickNSView {
        let view = RightClickNSView()
        view.onRightClick = onRightClick
        return view
    }

    func updateNSView(_ nsView: RightClickNSView, context: Context) {
        nsView.onRightClick = onRightClick
    }

    final class RightClickNSView: NSView {
        var onRightClick: ((NSPoint) -> Void)?

        override func rightMouseDown(with event: NSEvent) {
            let screenPoint = event.locationInWindow
            if let window {
                let converted = window.convertPoint(toScreen: screenPoint)
                onRightClick?(converted)
            }
        }

        // Allow right-click even though panel is non-activating
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
        override var acceptsFirstResponder: Bool { true }
    }
}
