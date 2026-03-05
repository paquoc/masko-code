import AppKit
import ApplicationServices
import Carbon.HIToolbox

// MARK: - Thread-safe state shared between main actor and CGEvent callback

/// Holds values read/written from the CGEvent callback thread.
/// All access is via atomic-safe types (Bool, Int64, UInt64).
final class HotkeySharedState: @unchecked Sendable {
    /// Whether pending permissions exist — controls Cmd+1-9 interception.
    var hasPendingPermissions = false

    /// Number of active sessions — controls double-tap Cmd interception (only when >= 2).
    var activeSessionCount: Int32 = 0

    /// Whether the session switcher overlay is currently showing.
    var sessionSwitcherActive = false

    /// Whether the Cmd key is currently held.
    var cmdHeld = false

    // Double-tap Cmd detection state
    /// Mach absolute time of last Cmd release (for double-tap detection).
    var lastCmdReleaseTime: UInt64 = 0
    /// True if Cmd was pressed and released without any other key (solitary press).
    var cmdWasSolitary = false

    /// The configured shortcut key code (default: 46 = M).
    var keyCode: Int64 = 46

    /// The configured shortcut modifier flags raw value.
    var modifiersRaw: UInt64 = CGEventFlags.maskCommand.rawValue

    /// Reference to the event tap for re-enabling on timeout.
    var eventTap: CFMachPort?
}

// MARK: - Global Hotkey Manager

/// Manages system-wide keyboard shortcuts via a CGEvent tap.
/// Requires Accessibility permission (System Settings → Privacy → Accessibility).
@Observable
final class GlobalHotkeyManager {
    // MARK: - Observable state

    /// True while the Cmd modifier is physically held down — drives badge visibility.
    var isCmdHeld = false

    /// Currently selected button index within the topmost card (0-based via ⌘1-9). nil = none.
    var selectedButtonIndex: Int?

    /// Incremented on ⌘Enter — views observe this via .onChange to trigger the selected action.
    var confirmTrigger: Int = 0

    /// True when the CGEvent tap is active (Accessibility permission granted).
    private(set) var isActive = false

    // MARK: - Callbacks (set by AppStore / MaskoDesktopApp)

    /// Called when the focus-toggle shortcut is pressed.
    var onToggleFocus: (() -> Void)?

    /// Called when ⌘N selects the Nth permission (0-indexed).
    var onSelectPermission: ((Int) -> Void)?

    /// Called when ⌘Enter confirms the selected permission.
    var onConfirmPermission: (() -> Void)?

    /// Called when ⌘Esc dismisses (skips/denies) the topmost permission.
    var onDismissPermission: (() -> Void)?

    /// Called when ⌘L collapses (later) the topmost non-collapsed permission.
    var onCollapsePermission: (() -> Void)?

    /// Called when double-tap Cmd opens the session switcher.
    var onSessionSwitcherOpen: (() -> Void)?

    /// Called when arrow key cycles to next session (while switcher active).
    var onSessionSwitcherNext: (() -> Void)?

    /// Called when arrow key cycles to previous session (while switcher active).
    var onSessionSwitcherPrev: (() -> Void)?

    /// Called when Enter or double-tap Cmd confirms selection (while switcher active).
    var onSessionSwitcherConfirm: (() -> Void)?

    /// Called when Esc cancels the switcher.
    var onSessionSwitcherCancel: (() -> Void)?

    /// Called when Cmd+N selects Nth session in the switcher (0-indexed).
    var onSessionSwitcherSelect: ((Int) -> Void)?

    // MARK: - Private

    let shared = HotkeySharedState()
    private var runLoopSource: CFRunLoopSource?
    private var previousApp: NSRunningApplication?

    // MARK: - Pending permissions (bridged to shared state)

    var hasPendingPermissions: Bool {
        get { shared.hasPendingPermissions }
        set { shared.hasPendingPermissions = newValue }
    }

    var activeSessionCount: Int {
        get { Int(shared.activeSessionCount) }
        set { shared.activeSessionCount = Int32(newValue) }
    }

    /// Whether the session switcher overlay is currently showing — used to suppress permission badges.
    var isSessionSwitcherActive: Bool {
        get { shared.sessionSwitcherActive }
        set { shared.sessionSwitcherActive = newValue }
    }

    // MARK: - Configurable shortcut (stored in UserDefaults)

    /// The key code for the focus-toggle shortcut.
    /// Default: auto-detect M key position (46 on QWERTY, 41 on AZERTY).
    var hotkeyKeyCode: Int64 {
        get {
            let saved = UserDefaults.standard.integer(forKey: "hotkey_keyCode")
            return saved > 0 ? Int64(saved) : Self.detectKeyCodeForM()
        }
        set {
            UserDefaults.standard.set(Int(newValue), forKey: "hotkey_keyCode")
            shared.keyCode = newValue
        }
    }

    /// The required modifier flags for the focus-toggle shortcut.
    /// Default: Cmd (⌘M).
    var hotkeyModifiers: CGEventFlags {
        get {
            let raw = UserDefaults.standard.integer(forKey: "hotkey_modifiers")
            if raw > 0 {
                return CGEventFlags(rawValue: UInt64(raw))
            }
            return .maskCommand
        }
        set {
            UserDefaults.standard.set(Int(newValue.rawValue), forKey: "hotkey_modifiers")
            shared.modifiersRaw = newValue.rawValue
        }
    }

    /// Human-readable label for the current shortcut (e.g. "⌘⇧M").
    var shortcutLabel: String {
        var parts: [String] = []
        let mods = hotkeyModifiers
        if mods.contains(.maskControl) { parts.append("⌃") }
        if mods.contains(.maskAlternate) { parts.append("⌥") }
        if mods.contains(.maskShift) { parts.append("⇧") }
        if mods.contains(.maskCommand) { parts.append("⌘") }
        parts.append(keyCodeToString(hotkeyKeyCode))
        return parts.joined()
    }

    /// Detect the key code for "M" based on the current keyboard layout.
    /// Returns 46 on QWERTY, 41 on AZERTY, etc.
    private static func detectKeyCodeForM() -> Int64 {
        // Use TIS (Text Input Source) API to detect current keyboard layout
        guard let source = TISCopyCurrentKeyboardInputSource()?.takeRetainedValue(),
              let layoutDataRef = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else {
            debugLog("detectKeyCodeForM: no TIS layout data, fallback to 46")
            return 46
        }
        let layoutData = unsafeBitCast(layoutDataRef, to: CFData.self) as Data
        let layoutPtr = layoutData.withUnsafeBytes { $0.bindMemory(to: UCKeyboardLayout.self).baseAddress! }

        // Try common key codes for M across layouts
        for keyCode: UInt16 in [46, 41, 40, 38] {
            var deadKeyState: UInt32 = 0
            var length = 0
            var chars = [UniChar](repeating: 0, count: 4)
            let status = UCKeyTranslate(
                layoutPtr,
                keyCode,
                UInt16(kUCKeyActionDown),
                0, // no modifiers
                UInt32(LMGetKbdType()),
                UInt32(kUCKeyTranslateNoDeadKeysBit),
                &deadKeyState,
                4,
                &length,
                &chars
            )
            if status == noErr && length > 0 {
                let str = String(utf16CodeUnits: chars, count: length).lowercased()
                debugLog("detectKeyCodeForM: keyCode=\(keyCode) → '\(str)'")
                if str == "m" { return Int64(keyCode) }
            }
        }
        debugLog("detectKeyCodeForM: no match, falling back to 46")
        return 46
    }

    // MARK: - Lifecycle

    /// Log to a file for debugging (stdout is lost when backgrounded)
    static func debugLog(_ msg: String) {
        #if DEBUG
        let path = NSHomeDirectory() + "/.masko-desktop/hotkey-debug.log"
        let line = "\(Date()): \(msg)\n"
        if let handle = FileHandle(forWritingAtPath: path) {
            handle.seekToEndOfFile()
            handle.write(line.data(using: .utf8)!)
            handle.closeFile()
        } else {
            try? line.write(toFile: path, atomically: true, encoding: .utf8)
        }
        #endif
    }

    func start() {
        guard shared.eventTap == nil else { return }

        // Sync UserDefaults → shared state
        shared.keyCode = hotkeyKeyCode
        shared.modifiersRaw = hotkeyModifiers.rawValue

        let eventMask: CGEventMask = (
            (1 << CGEventType.keyDown.rawValue) |
            (1 << CGEventType.flagsChanged.rawValue)
        )

        let refcon = Unmanaged.passUnretained(self).toOpaque()

        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: eventMask,
            callback: globalHotkeyCallback,
            userInfo: refcon
        ) else {
            let trusted = AXIsProcessTrusted()
            Self.debugLog("CGEvent tap FAILED — AXIsProcessTrusted=\(trusted)")
            print("[masko-desktop] CGEvent tap failed — AXIsProcessTrusted=\(trusted)")
            isActive = false
            requestAccessibilityPermission()
            return
        }

        shared.eventTap = tap
        runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        isActive = true

        Self.debugLog("Started! shortcut=\(shortcutLabel), keyCode=\(shared.keyCode), mods=\(shared.modifiersRaw)")
        print("[masko-desktop] Global hotkey manager started (shortcut: \(shortcutLabel))")
    }

    func stop() {
        if let tap = shared.eventTap {
            CGEvent.tapEnable(tap: tap, enable: false)
            CFMachPortInvalidate(tap)
        }
        if let source = runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
        }
        shared.eventTap = nil
        runLoopSource = nil
        isActive = false
        print("[masko-desktop] Global hotkey manager stopped")
    }

    /// Prompt the macOS Accessibility permission dialog.
    func requestAccessibilityPermission() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary
        let trusted = AXIsProcessTrustedWithOptions(options)
        if trusted && shared.eventTap == nil {
            start()
        }
    }

    // MARK: - Focus toggle

    func toggleFocus() {
        // For a menu bar app, toggle the dashboard window (not NSApp activation)
        // Check for any visible non-panel window (isKeyWindow may be false for menu bar apps)
        if let dashboardWindow = NSApp.windows.first(where: { $0.isVisible && $0.canBecomeKey && !($0 is NSPanel) }) {
            // Dashboard is visible — hide it and return to previous app
            dashboardWindow.close()
            NSApp.setActivationPolicy(.accessory)
            if let app = previousApp {
                app.activate(options: [])
            }
            previousApp = nil
            Self.debugLog("toggleFocus: closed dashboard")
        } else {
            // Dashboard is hidden — remember current app and show dashboard
            if let frontmost = NSWorkspace.shared.frontmostApplication,
               frontmost.bundleIdentifier != Bundle.main.bundleIdentifier {
                previousApp = frontmost
            }
            AppDelegate.showDashboard()
            Self.debugLog("toggleFocus: opened dashboard")
        }
    }

    // MARK: - Shortcut recording

    /// Update the focus-toggle shortcut. Called from the Settings shortcut recorder.
    func setShortcut(keyCode: Int64, modifiers: CGEventFlags) {
        hotkeyKeyCode = keyCode
        hotkeyModifiers = modifiers
    }
}

// MARK: - Mach time helper

/// Convert mach_absolute_time delta to milliseconds.
private func machTimeToMs(_ delta: UInt64) -> UInt64 {
    var info = mach_timebase_info_data_t()
    mach_timebase_info(&info)
    let nanos = delta * UInt64(info.numer) / UInt64(info.denom)
    return nanos / 1_000_000
}

// MARK: - CGEvent callback (C-compatible, runs on Mach port thread)

private func globalHotkeyCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    refcon: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    guard let refcon else { return Unmanaged.passUnretained(event) }
    let manager = Unmanaged<GlobalHotkeyManager>.fromOpaque(refcon).takeUnretainedValue()
    let state = manager.shared

    // Handle tap being disabled by the system (timeout protection)
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        GlobalHotkeyManager.debugLog("TAP DISABLED: \(type == .tapDisabledByTimeout ? "timeout" : "userInput") — re-enabling")
        if let tap = state.eventTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passUnretained(event)
    }

    let flags = event.flags
    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)

    // Debug: log Cmd-related events
    if type == .flagsChanged || (type == .keyDown && flags.contains(.maskCommand)) {
        GlobalHotkeyManager.debugLog("event: type=\(type.rawValue) keyCode=\(keyCode) flags=\(flags.rawValue)")
    }

    // --- flagsChanged: track Cmd hold state + double-tap Cmd detection ---
    if type == .flagsChanged {
        let cmdDown = flags.contains(.maskCommand)
        let wasCmdDown = state.cmdHeld
        state.cmdHeld = cmdDown

        if cmdDown && !wasCmdDown {
            // Cmd just pressed — start tracking solitary press
            state.cmdWasSolitary = true
        }

        if !cmdDown && wasCmdDown {
            // Cmd just released
            if state.cmdWasSolitary {
                let now = mach_absolute_time()
                let elapsed = state.lastCmdReleaseTime > 0 ? machTimeToMs(now - state.lastCmdReleaseTime) : UInt64.max

                if state.sessionSwitcherActive {
                    // Double-tap while switcher open → confirm
                    if elapsed < 400 {
                        state.lastCmdReleaseTime = 0
                        DispatchQueue.main.async { manager.onSessionSwitcherConfirm?() }
                    } else {
                        state.lastCmdReleaseTime = now
                    }
                } else if elapsed < 400 && state.activeSessionCount >= 2 {
                    // Double-tap Cmd detected → open session switcher
                    GlobalHotkeyManager.debugLog("Double-tap Cmd detected — opening session switcher")
                    state.lastCmdReleaseTime = 0 // reset to prevent triple-tap
                    DispatchQueue.main.async { manager.onSessionSwitcherOpen?() }
                } else {
                    state.lastCmdReleaseTime = now
                }
            } else {
                // Cmd was used as modifier — reset double-tap tracking
                state.lastCmdReleaseTime = 0
            }
        }

        DispatchQueue.main.async {
            manager.isCmdHeld = cmdDown
            if !cmdDown { manager.selectedButtonIndex = nil }
        }
        return Unmanaged.passUnretained(event)
    }

    // --- keyDown: check for our shortcuts ---
    guard type == .keyDown else { return Unmanaged.passUnretained(event) }

    // Any keyDown while Cmd is held → Cmd is being used as modifier, not solitary
    if state.cmdHeld {
        state.cmdWasSolitary = false
    }

    // Check focus-toggle shortcut (configurable, default ⌘M)
    let requiredMods = CGEventFlags(rawValue: state.modifiersRaw)
    let relevantFlags: CGEventFlags = [.maskCommand, .maskShift, .maskControl, .maskAlternate]
    let activeFlags = flags.intersection(relevantFlags)

    if keyCode == state.keyCode && activeFlags == requiredMods {
        GlobalHotkeyManager.debugLog("⌘M MATCHED — triggering toggleFocus")
        DispatchQueue.main.async { manager.onToggleFocus?() }
        return nil // consume
    }

    // --- Session switcher active: arrow keys, Esc ---
    if state.sessionSwitcherActive {
        // Arrow Down or Arrow Right: next session
        if keyCode == 125 || keyCode == 124 {
            DispatchQueue.main.async { manager.onSessionSwitcherNext?() }
            return nil
        }
        // Arrow Up or Arrow Left: previous session
        if keyCode == 126 || keyCode == 123 {
            DispatchQueue.main.async { manager.onSessionSwitcherPrev?() }
            return nil
        }
        // Tab: next session (Shift+Tab: previous) — only when switcher is open
        if keyCode == 48 {
            if flags.contains(.maskShift) {
                DispatchQueue.main.async { manager.onSessionSwitcherPrev?() }
            } else {
                DispatchQueue.main.async { manager.onSessionSwitcherNext?() }
            }
            return nil
        }
        // Esc: cancel
        if keyCode == 53 {
            DispatchQueue.main.async { manager.onSessionSwitcherCancel?() }
            return nil
        }
    }

    // Cmd-only shortcuts (no Shift/Ctrl/Option)
    if flags.contains(.maskCommand) &&
       !flags.contains(.maskShift) &&
       !flags.contains(.maskControl) &&
       !flags.contains(.maskAlternate) {

        // ⌘1-9: session switcher selection (takes priority when switcher is active)
        let digitKeyCodes: [Int64: Int] = [
            18: 1, 19: 2, 20: 3, 21: 4, 23: 5,
            22: 6, 26: 7, 28: 8, 25: 9,
        ]
        if let digit = digitKeyCodes[keyCode] {
            if state.sessionSwitcherActive {
                DispatchQueue.main.async { manager.onSessionSwitcherSelect?(digit - 1) }
                return nil
            }
            if state.hasPendingPermissions {
                DispatchQueue.main.async { manager.onSelectPermission?(digit - 1) }
                return nil
            }
        }

        // ⌘Enter: confirm session switcher or permission
        if keyCode == 36 {
            if state.sessionSwitcherActive {
                DispatchQueue.main.async { manager.onSessionSwitcherConfirm?() }
                return nil
            }
            if state.hasPendingPermissions {
                DispatchQueue.main.async { manager.onConfirmPermission?() }
                return nil
            }
        }

        // ⌘L: collapse (later) topmost non-collapsed permission
        if keyCode == 37, state.hasPendingPermissions {
            DispatchQueue.main.async { manager.onCollapsePermission?() }
            return nil // consume
        }

        // ⌘Esc: dismiss permission
        if keyCode == 53, state.hasPendingPermissions {
            DispatchQueue.main.async { manager.onDismissPermission?() }
            return nil
        }
    }

    return Unmanaged.passUnretained(event) // pass through
}

// MARK: - Key code → string helper

private func keyCodeToString(_ keyCode: Int64) -> String {
    // Special keys (not affected by keyboard layout)
    let specialKeys: [Int64: String] = [
        49: "Space", 50: "`", 51: "Delete", 53: "Esc", 36: "Return", 48: "Tab",
        122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6",
        98: "F7", 100: "F8", 101: "F9", 109: "F10", 103: "F11", 111: "F12",
        123: "←", 124: "→", 125: "↓", 126: "↑",
    ]
    if let special = specialKeys[keyCode] { return special }

    // Use current keyboard layout to resolve the character
    if let source = TISCopyCurrentKeyboardInputSource()?.takeRetainedValue(),
       let layoutDataRef = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) {
        let layoutData = unsafeBitCast(layoutDataRef, to: CFData.self) as Data
        let layoutPtr = layoutData.withUnsafeBytes { $0.bindMemory(to: UCKeyboardLayout.self).baseAddress! }
        var deadKeyState: UInt32 = 0
        var length = 0
        var chars = [UniChar](repeating: 0, count: 4)
        let status = UCKeyTranslate(
            layoutPtr, UInt16(keyCode), UInt16(kUCKeyActionDown), 0,
            UInt32(LMGetKbdType()), UInt32(kUCKeyTranslateNoDeadKeysBit),
            &deadKeyState, 4, &length, &chars
        )
        if status == noErr && length > 0 {
            return String(utf16CodeUnits: chars, count: length).uppercased()
        }
    }
    return "Key\(keyCode)"
}
