import Foundation

/// Fallback transport for agents that cannot accept background replies from the mascot.
/// Exposes only `openTerminal` capability so UI can direct the user to answer in the terminal.
final class TerminalFallbackTransport: ResponseTransport {
    private let event: AgentEvent
    private var handlers: [() -> Void] = []
    private var cancelled = false

    var capabilities: Set<ResponseCapability> { [.openTerminal] }
    var isAlive: Bool { !cancelled }

    init(event: AgentEvent) {
        self.event = event
    }

    func sendDecision(_ decision: PermissionDecision) {
        openTerminal()
    }

    func sendAllowWithUpdatedInput(_ updatedInput: [String: Any]) {
        openTerminal()
    }

    func sendAllowWithUpdatedPermissions(_ permissions: [[String: Any]]) {
        openTerminal()
    }

    func cancel() {
        guard !cancelled else { return }
        cancelled = true
        let callbacks = handlers
        handlers.removeAll()
        callbacks.forEach { $0() }
    }

    func onRemoteClose(_ handler: @escaping () -> Void) {
        if cancelled {
            handler()
            return
        }
        handlers.append(handler)
    }

    private func openTerminal() {
        if event.terminalPid != nil || event.shellPid != nil {
            IDETerminalFocus.focus(
                terminalPid: event.terminalPid,
                shellPid: event.shellPid,
                projectDir: event.cwd
            )
            return
        }
        if CodexInteractiveBridge.focus(event: event) {
            return
        }
        IDETerminalFocus.focus(projectDir: event.cwd)
    }
}
