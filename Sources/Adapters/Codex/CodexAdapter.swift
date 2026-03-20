import Foundation

/// Codex adapter - tails local Codex session logs and routes mapped events into the shared pipeline.
final class CodexAdapter: AgentAdapter {
    let source: AgentSource = .codex
    let monitor = CodexSessionMonitor()

    var isRunning: Bool { monitor.isRunning }

    var onEvent: ((AgentEvent) -> Void)?
    var onPermissionRequest: ((AgentEvent, ResponseTransport) -> Void)?
    var onInput: ((String, ConditionValue) -> Void)?

    func isAvailable() -> Bool {
        let paths = ["/usr/local/bin/codex", "/opt/homebrew/bin/codex"]
        for path in paths where FileManager.default.isExecutableFile(atPath: path) {
            return true
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        process.arguments = ["codex"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()
        if process.terminationStatus == 0 {
            return true
        }
        return FileManager.default.fileExists(atPath: CodexSessionMonitor.defaultSessionsRoot.path)
    }

    func isRegistered() -> Bool {
        true
    }

    func install() throws {
        // Codex log ingestion requires no hook/plugin install.
    }

    func uninstall() {
        // Nothing to uninstall for log ingestion.
    }

    func start() throws {
        monitor.onEventReceived = { [weak self] event in
            self?.route(event)
        }
        monitor.start()
    }

    func stop() {
        monitor.stop()
    }

    private func route(_ event: AgentEvent) {
        guard !shouldSuppress(event) else { return }

        if event.eventType == .permissionRequest {
            onPermissionRequest?(event, TerminalFallbackTransport(event: event))
            return
        }

        onEvent?(event)
    }

    private func shouldSuppress(_ event: AgentEvent) -> Bool {
        guard let eventType = event.eventType else { return false }

        // Codex "question turns" use stop/task-complete markers while still waiting on user input.
        if eventType == .stop, event.isLikelyCodexQuestionPrompt {
            return true
        }
        if eventType == .taskCompleted, AgentEvent.looksLikeQuestionPrompt(event.taskSubject) {
            return true
        }

        // request_user_input completions should not auto-dismiss mirrored AskUserQuestion cards.
        if eventType == .postToolUse || eventType == .postToolUseFailure {
            let toolName = (event.toolName ?? "").lowercased()
            if toolName == "request_user_input" || toolName == "askuserquestion" {
                return true
            }
        }

        return false
    }
}
