import Foundation

/// Diagnoses and repairs the connection between Masko Code and Claude Code/Codex.
@Observable
@MainActor
final class ConnectionDoctor {

    struct Check: Identifiable {
        enum Status { case ok, warning, error }
        let id: String
        let name: String
        var status: Status
        var message: String
        var canAutoFix: Bool
    }

    private(set) var checks: [Check] = []
    private(set) var isRunning = false
    private(set) var isRepairing = false

    private let localServer: LocalServer
    private let eventStore: EventStore
    private let sessionStore: SessionStore

    init(localServer: LocalServer, eventStore: EventStore, sessionStore: SessionStore) {
        self.localServer = localServer
        self.eventStore = eventStore
        self.sessionStore = sessionStore
    }

    // MARK: - Diagnostics

    func runDiagnostics() async {
        isRunning = true
        checks = []

        // 1. Server running
        checks.append(checkServerRunning())

        // 2. Hooks installed in settings.json
        checks.append(checkHooksInstalled())

        // 3. Hook script exists
        checks.append(checkHookScriptExists())

        // 4. Port match between script and server
        checks.append(checkPortMatch())

        // 5. Script version
        checks.append(checkScriptVersion())

        // 6. End-to-end health check
        checks.append(await checkHealthEndpoint())

        // 7. Claude Code process running
        checks.append(checkClaudeCodeProcess())

        // 8. End-to-end hook delivery test
        checks.append(await checkHookDelivery())

        // 9. Last event received
        checks.append(checkLastEvent())

        isRunning = false
    }

    // MARK: - Individual Checks

    private func checkServerRunning() -> Check {
        if localServer.isRunning {
            return Check(
                id: "server_running",
                name: "Local Server",
                status: .ok,
                message: "Running on port \(localServer.port)",
                canAutoFix: true
            )
        }
        return Check(
            id: "server_running",
            name: "Local Server",
            status: .error,
            message: "Server is offline",
            canAutoFix: true
        )
    }

    private func checkHooksInstalled() -> Check {
        let settingsPath = NSHomeDirectory() + "/.claude/settings.json"
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: settingsPath)),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let hooks = json["hooks"] as? [String: Any] else {
            return Check(
                id: "hooks_installed",
                name: "Claude Code Hooks",
                status: .error,
                message: "No hooks found in settings.json",
                canAutoFix: true
            )
        }

        let hookCommand = "~/.masko-desktop/hooks/hook-sender.sh"
        let expectedEvents = [
            "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "StopFailure",
            "Notification", "SessionStart", "SessionEnd", "TaskCompleted",
            "PermissionRequest", "UserPromptSubmit", "SubagentStart", "SubagentStop",
            "PreCompact", "PostCompact", "ConfigChange", "TeammateIdle",
            "WorktreeCreate", "WorktreeRemove",
        ]

        var missing = 0
        for event in expectedEvents {
            if let entries = hooks[event] as? [[String: Any]] {
                let hasHook = entries.contains { entry in
                    guard let innerHooks = entry["hooks"] as? [[String: Any]] else { return false }
                    return innerHooks.contains { ($0["command"] as? String) == hookCommand }
                }
                if !hasHook { missing += 1 }
            } else {
                missing += 1
            }
        }

        if missing == 0 {
            return Check(
                id: "hooks_installed",
                name: "Claude Code Hooks",
                status: .ok,
                message: "All \(expectedEvents.count) hooks registered",
                canAutoFix: true
            )
        }

        return Check(
            id: "hooks_installed",
            name: "Claude Code Hooks",
            status: missing == expectedEvents.count ? .error : .warning,
            message: "Missing \(missing) of \(expectedEvents.count) hooks",
            canAutoFix: true
        )
    }

    private func checkHookScriptExists() -> Check {
        let scriptPath = NSHomeDirectory() + "/.masko-desktop/hooks/hook-sender.sh"
        let fm = FileManager.default

        guard fm.fileExists(atPath: scriptPath) else {
            return Check(
                id: "hook_script",
                name: "Hook Script",
                status: .error,
                message: "hook-sender.sh not found",
                canAutoFix: true
            )
        }

        guard fm.isExecutableFile(atPath: scriptPath) else {
            return Check(
                id: "hook_script",
                name: "Hook Script",
                status: .warning,
                message: "hook-sender.sh exists but is not executable",
                canAutoFix: true
            )
        }

        return Check(
            id: "hook_script",
            name: "Hook Script",
            status: .ok,
            message: "hook-sender.sh exists and is executable",
            canAutoFix: true
        )
    }

    private func checkPortMatch() -> Check {
        let scriptPath = NSHomeDirectory() + "/.masko-desktop/hooks/hook-sender.sh"
        guard let content = try? String(contentsOfFile: scriptPath, encoding: .utf8) else {
            return Check(
                id: "port_match",
                name: "Port Configuration",
                status: .warning,
                message: "Cannot read hook script to verify port",
                canAutoFix: true
            )
        }

        let pattern = "http://localhost:(\\d+)/health"
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: content, range: NSRange(content.startIndex..., in: content)),
              let portRange = Range(match.range(at: 1), in: content),
              let scriptPort = UInt16(content[portRange]) else {
            return Check(
                id: "port_match",
                name: "Port Configuration",
                status: .warning,
                message: "Cannot parse port from hook script",
                canAutoFix: true
            )
        }

        let serverPort = localServer.port
        if scriptPort == serverPort {
            return Check(
                id: "port_match",
                name: "Port Configuration",
                status: .ok,
                message: "Script and server both on port \(serverPort)",
                canAutoFix: true
            )
        }

        return Check(
            id: "port_match",
            name: "Port Configuration",
            status: .error,
            message: "Port mismatch: script=\(scriptPort), server=\(serverPort)",
            canAutoFix: true
        )
    }

    private func checkScriptVersion() -> Check {
        let scriptPath = NSHomeDirectory() + "/.masko-desktop/hooks/hook-sender.sh"
        guard let content = try? String(contentsOfFile: scriptPath, encoding: .utf8) else {
            return Check(
                id: "script_version",
                name: "Script Version",
                status: .warning,
                message: "Cannot read hook script",
                canAutoFix: true
            )
        }

        let pattern = "# version: (\\d+)"
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: content, range: NSRange(content.startIndex..., in: content)),
              let versionRange = Range(match.range(at: 1), in: content),
              let version = Int(content[versionRange]) else {
            return Check(
                id: "script_version",
                name: "Script Version",
                status: .warning,
                message: "Cannot parse version from hook script",
                canAutoFix: true
            )
        }

        return Check(
            id: "script_version",
            name: "Script Version",
            status: .ok,
            message: "Version \(version)",
            canAutoFix: true
        )
    }

    private func checkHealthEndpoint() async -> Check {
        let port = localServer.port
        let url = URL(string: "http://localhost:\(port)/health")!
        var request = URLRequest(url: url)
        request.timeoutInterval = 2

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                return Check(
                    id: "health_check",
                    name: "Health Check",
                    status: .ok,
                    message: "Server responding on port \(port)",
                    canAutoFix: false
                )
            }
            return Check(
                id: "health_check",
                name: "Health Check",
                status: .error,
                message: "Server returned non-200 status",
                canAutoFix: false
            )
        } catch {
            return Check(
                id: "health_check",
                name: "Health Check",
                status: .error,
                message: "Connection refused on port \(port)",
                canAutoFix: false
            )
        }
    }

    private func checkClaudeCodeProcess() -> Check {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        process.arguments = ["-x", "claude"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()

        var found: [String] = []

        if (try? process.run()) != nil {
            process.waitUntilExit()
            if process.terminationStatus == 0 {
                found.append("claude")
            }
        }

        // Also check for codex
        let codexProcess = Process()
        codexProcess.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        codexProcess.arguments = ["-x", "codex"]
        codexProcess.standardOutput = Pipe()
        codexProcess.standardError = Pipe()

        if (try? codexProcess.run()) != nil {
            codexProcess.waitUntilExit()
            if codexProcess.terminationStatus == 0 {
                found.append("codex")
            }
        }

        if !found.isEmpty {
            return Check(
                id: "claude_process",
                name: "Claude Code Process",
                status: .ok,
                message: "Running: \(found.joined(separator: ", "))",
                canAutoFix: false
            )
        }

        return Check(
            id: "claude_process",
            name: "Claude Code Process",
            status: .warning,
            message: "No claude or codex process detected",
            canAutoFix: false
        )
    }

    /// Pipes a test event through the hook script and checks if the server receives it.
    private func checkHookDelivery() async -> Check {
        let scriptPath = NSHomeDirectory() + "/.masko-desktop/hooks/hook-sender.sh"
        guard FileManager.default.fileExists(atPath: scriptPath) else {
            return Check(
                id: "hook_delivery",
                name: "Hook Delivery",
                status: .error,
                message: "Hook script not found, cannot test",
                canAutoFix: true
            )
        }

        guard localServer.isRunning else {
            return Check(
                id: "hook_delivery",
                name: "Hook Delivery",
                status: .error,
                message: "Server offline, cannot test delivery",
                canAutoFix: true
            )
        }

        let testId = UUID().uuidString

        // Run hook script with a test event
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [scriptPath]

        let inputPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardInput = inputPipe
        process.standardOutput = Pipe()
        process.standardError = stderrPipe

        let testPayload = """
        {"hook_event_name":"Notification","message":"masko-doctor-test-\(testId)","session_id":"doctor-test"}
        """

        do {
            try process.run()
            inputPipe.fileHandleForWriting.write(testPayload.data(using: .utf8)!)
            inputPipe.fileHandleForWriting.closeFile()
            process.waitUntilExit()
        } catch {
            return Check(
                id: "hook_delivery",
                name: "Hook Delivery",
                status: .error,
                message: "Failed to run hook script: \(error.localizedDescription)",
                canAutoFix: true
            )
        }

        // Check stderr for clues
        let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
        let stderrStr = String(data: stderrData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        if process.terminationStatus != 0 {
            return Check(
                id: "hook_delivery",
                name: "Hook Delivery",
                status: .error,
                message: "Hook script exited with code \(process.terminationStatus)\(stderrStr.isEmpty ? "" : ": \(stderrStr)")",
                canAutoFix: true
            )
        }

        // Wait for the event to be processed
        try? await Task.sleep(nanoseconds: 1_000_000_000)

        // Look for our specific test event by matching the unique ID in the message
        let found = eventStore.events.contains { event in
            event.hookEventName == "Notification" &&
            (event.message?.contains("masko-doctor-test-\(testId)") ?? false)
        }

        if found {
            return Check(
                id: "hook_delivery",
                name: "Hook Delivery",
                status: .ok,
                message: "Test event delivered and received",
                canAutoFix: false
            )
        }

        return Check(
            id: "hook_delivery",
            name: "Hook Delivery",
            status: .error,
            message: "Hook script ran but event not received by server\(stderrStr.isEmpty ? "" : " (stderr: \(stderrStr))")",
            canAutoFix: false
        )
    }

    private func checkLastEvent() -> Check {
        guard let lastEvent = eventStore.events.last else {
            return Check(
                id: "last_event",
                name: "Last Event",
                status: .warning,
                message: "No events received yet",
                canAutoFix: false
            )
        }

        let age = Date().timeIntervalSince(lastEvent.receivedAt)
        let ageStr: String
        if age < 60 {
            ageStr = "\(Int(age))s ago"
        } else if age < 3600 {
            ageStr = "\(Int(age / 60))m ago"
        } else {
            ageStr = "\(Int(age / 3600))h ago"
        }

        let status: Check.Status = age < 300 ? .ok : (age < 3600 ? .warning : .error)

        return Check(
            id: "last_event",
            name: "Last Event",
            status: status,
            message: "\(lastEvent.hookEventName) - \(ageStr) (\(eventStore.events.count) total)",
            canAutoFix: false
        )
    }

    // MARK: - Repair

    func repairAll() async {
        isRepairing = true

        // 1. Restart server if not running
        if !localServer.isRunning {
            localServer.restart(port: localServer.port)
            try? await Task.sleep(nanoseconds: 500_000_000)
        }

        // 2. Force-delete hook script so ensureScriptExists() regenerates it
        //    (otherwise it skips if version + port match)
        let scriptPath = NSHomeDirectory() + "/.masko-desktop/hooks/hook-sender.sh"
        try? FileManager.default.removeItem(atPath: scriptPath)

        // 3. Reinstall hooks + regenerate script from scratch
        try? HookInstaller.install()

        // 4. Re-run diagnostics to verify
        await runDiagnostics()

        isRepairing = false
    }

    // MARK: - Report Payload

    func buildReportPayload() -> [String: Any] {
        var checkPayloads: [[String: Any]] = []
        for check in checks {
            checkPayloads.append([
                "name": check.id,
                "status": statusString(check.status),
                "message": check.message,
            ])
        }

        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
        let buildNumber = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        let osVersion = ProcessInfo.processInfo.operatingSystemVersionString

        // Last event age
        let lastEventAge: Int?
        if let lastEvent = eventStore.events.last {
            lastEventAge = Int(Date().timeIntervalSince(lastEvent.receivedAt))
        } else {
            lastEventAge = nil
        }

        // Claude Code version
        let claudeVersion = Self.getClaudeCodeVersion()

        // Check for settings overrides
        let settingsLocalExists = FileManager.default.fileExists(
            atPath: NSHomeDirectory() + "/.claude/settings.local.json"
        )

        // Hash of settings.json for debugging (not full content for privacy)
        let settingsHash: String
        if let settingsData = try? Data(contentsOf: URL(fileURLWithPath: NSHomeDirectory() + "/.claude/settings.json")) {
            settingsHash = "\(settingsData.count) bytes"
        } else {
            settingsHash = "missing"
        }

        // Check for other hook managers (non-masko hooks in settings.json)
        let otherHooks = Self.detectOtherHookManagers()

        return [
            "app_version": "\(appVersion) (\(buildNumber))",
            "os_version": osVersion,
            "checks": checkPayloads,
            "active_sessions": sessionStore.activeSessions.count,
            "total_events": eventStore.events.count,
            "last_event_age_seconds": lastEventAge as Any,
            "claude_code_version": claudeVersion as Any,
            "settings_local_exists": settingsLocalExists,
            "settings_json_size": settingsHash,
            "other_hook_managers": otherHooks,
            "claude_hook_logs": Self.getRecentClaudeHookLogs(),
            "hooks_config": Self.getHooksConfig(),
        ]
    }

    /// Send diagnostic report to masko.ai and return the short code
    func sendReport() async -> String? {
        let payload = buildReportPayload()

        let urlString = Constants.maskoBaseURL + "/api/debug-reports"
        guard let url = URL(string: urlString) else { return nil }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10

        guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return nil }
        request.httpBody = body

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let shortCode = json["short_code"] as? String {
                return shortCode
            }
            return nil
        } catch {
            print("[ConnectionDoctor] Failed to send report: \(error)")
            return nil
        }
    }

    /// Get Claude Code version via `claude --version`
    private static func getClaudeCodeVersion() -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["claude", "--version"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()

        guard (try? process.run()) != nil else { return nil }
        process.waitUntilExit()

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return output?.isEmpty == false ? output : nil
    }

    /// Detect non-masko hook commands in settings.json
    private static func detectOtherHookManagers() -> [String] {
        let settingsPath = NSHomeDirectory() + "/.claude/settings.json"
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: settingsPath)),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let hooks = json["hooks"] as? [String: Any] else { return [] }

        var others: Set<String> = []
        for (_, value) in hooks {
            guard let entries = value as? [[String: Any]] else { continue }
            for entry in entries {
                guard let innerHooks = entry["hooks"] as? [[String: Any]] else { continue }
                for hook in innerHooks {
                    if let command = hook["command"] as? String,
                       !command.contains("masko-desktop") {
                        // Extract just the script name, not full path
                        let name = (command as NSString).lastPathComponent
                        others.insert(name)
                    }
                }
            }
        }
        return Array(others).sorted()
    }

    /// Extract the "hooks" section from ~/.claude/settings.json
    private static func getHooksConfig() -> Any {
        let settingsPath = NSHomeDirectory() + "/.claude/settings.json"
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: settingsPath)),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let hooks = json["hooks"] else { return "missing" }
        return hooks
    }

    /// Extract recent hook-related lines from Claude Code debug logs (last 50 lines matching "hook")
    private static func getRecentClaudeHookLogs() -> [String] {
        let debugDir = NSHomeDirectory() + "/.claude/debug"
        let latestLink = debugDir + "/latest"
        let fm = FileManager.default

        // Resolve the "latest" symlink or find the most recent file
        let logPath: String
        if let resolved = try? fm.destinationOfSymbolicLink(atPath: latestLink) {
            logPath = resolved.hasPrefix("/") ? resolved : debugDir + "/" + resolved
        } else {
            // No symlink, find newest file
            guard let files = try? fm.contentsOfDirectory(atPath: debugDir) else { return [] }
            let sorted = files
                .filter { $0.hasSuffix(".txt") }
                .compactMap { name -> (String, Date)? in
                    let path = debugDir + "/" + name
                    guard let attrs = try? fm.attributesOfItem(atPath: path),
                          let date = attrs[.modificationDate] as? Date else { return nil }
                    return (path, date)
                }
                .sorted { $0.1 > $1.1 }
            guard let newest = sorted.first else { return [] }
            logPath = newest.0
        }

        guard let data = try? Data(contentsOf: URL(fileURLWithPath: logPath)),
              let content = String(data: data, encoding: .utf8) else { return [] }

        // Get last 50 lines containing "hook" (case-insensitive)
        let lines = content.components(separatedBy: "\n")
        let hookLines = lines.filter { $0.localizedCaseInsensitiveContains("hook") }
        return Array(hookLines.suffix(50))
    }

    private func statusString(_ status: Check.Status) -> String {
        switch status {
        case .ok: return "ok"
        case .warning: return "warning"
        case .error: return "error"
        }
    }
}
