import AppKit
import Foundation

/// Best-effort bridge that sends mascot decisions back to an active Codex terminal session.
/// This path is only used for Codex-originated local permission requests.
enum CodexInteractiveBridge {
    struct ProcessInfo {
        let pid: Int
        let cwd: String?
        let tty: String?
    }

    /// Writing bytes to the tty device path only prints to the terminal on macOS.
    /// Codex does not currently expose a supported background input transport here.
    static let supportsBackgroundReplies = false

    private static let codexProcessMatchers: [[String]] = [
        ["-x", "codex"],
        ["-x", "Codex"],
        ["-f", "codex_cli_rs"],
        ["-f", "Codex.app"],
        ["-f", "Codex Desktop"],
    ]

    static func submit(
        resolution: LocalPermissionResolution,
        event: ClaudeEvent,
        processInfos: [ProcessInfo]? = nil,
        writer: ((String, String) -> Bool)? = nil
    ) -> Bool {
        guard event.assistantClientKind != .claude else { return false }
        guard let input = inputText(for: resolution, event: event), !input.isEmpty else { return false }
        guard let write = writer else {
            print("[masko-desktop] Codex local reply transport unavailable; tty device writes do not inject input on macOS")
            return false
        }

        let infos = processInfos ?? runningCodexProcesses()
        guard let target = selectProcess(for: event, from: infos),
              let tty = target.tty, !tty.isEmpty else {
            return false
        }

        let success = write(tty, input)
        if success {
            print("[masko-desktop] Codex bridge wrote resolution to \(tty) (pid=\(target.pid))")
        } else {
            print("[masko-desktop] Codex bridge failed to write resolution to \(tty) (pid=\(target.pid))")
        }
        return success
    }

    static func focus(
        event: ClaudeEvent,
        processInfos: [ProcessInfo]? = nil,
        activator: ((Int) -> Bool)? = nil
    ) -> Bool {
        guard event.assistantClientKind != .claude else { return false }

        let infos = processInfos ?? runningCodexProcesses()
        guard let target = selectProcess(for: event, from: infos) else {
            return false
        }

        let activate = activator ?? defaultActivator
        let success = activate(target.pid)
        if success {
            print("[masko-desktop] Codex bridge focused pid=\(target.pid)")
        } else {
            print("[masko-desktop] Codex bridge failed to focus pid=\(target.pid)")
        }
        return success
    }

    static func inputText(for resolution: LocalPermissionResolution, event: ClaudeEvent? = nil) -> String? {
        switch resolution {
        case .decision(let decision):
            return decision == .allow ? "y\r" : "n\r"
        case .answers(let answers):
            let values = orderedAnswerValues(answers, event: event)
            guard !values.isEmpty else { return nil }
            return values.joined(separator: "\r") + "\r"
        case .feedback(let feedback):
            let trimmed = feedback.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return nil }
            // Codex approval prompts expose feedback as a distinct branch before text entry.
            return "e\r" + trimmed + "\r"
        case .permissionSuggestions(let suggestions):
            if suggestions.contains(where: { $0.type == "addRules" }) {
                return "p\r"
            }
            return "y\r"
        }
    }

    static func selectProcess(for event: ClaudeEvent, from infos: [ProcessInfo]) -> ProcessInfo? {
        guard !infos.isEmpty else { return nil }

        if let cwd = normalized(path: event.cwd) {
            let matched = infos.filter { normalized(path: $0.cwd) == cwd }
            if matched.count == 1 {
                return matched.first
            }
            if matched.count > 1 {
                // Prefer newest process when multiple Codex sessions share the same cwd.
                return matched.max(by: { $0.pid < $1.pid })
            }
        }

        let ttyInfos = infos.filter { info in
            guard let tty = info.tty else { return false }
            return !tty.isEmpty
        }

        if ttyInfos.count == 1 {
            return ttyInfos.first
        }

        // Desktop sessions are frequently launched without a reliable cwd match.
        // Prefer the newest interactive TTY process so mascot approvals still route.
        if event.assistantClientKind == .codexDesktop,
           let newestTTY = ttyInfos.max(by: { $0.pid < $1.pid }) {
            return newestTTY
        }

        // No cwd match: only safe fallback is a single visible Codex process.
        if infos.count == 1 {
            return infos.first
        }

        return nil
    }

    private static func orderedAnswerValues(_ answers: [String: String], event: ClaudeEvent?) -> [String] {
        guard let orderedKeys = orderedAnswerKeys(from: event), !orderedKeys.isEmpty else {
            return answers.keys.sorted().compactMap { answers[$0] }
        }

        var values: [String] = []
        var usedKeys = Set<String>()

        for key in orderedKeys where !usedKeys.contains(key) {
            guard let value = answers[key] else { continue }
            values.append(value)
            usedKeys.insert(key)
        }

        let remainingKeys = answers.keys
            .filter { !usedKeys.contains($0) }
            .sorted()
        values.append(contentsOf: remainingKeys.compactMap { answers[$0] })
        return values
    }

    private static func orderedAnswerKeys(from event: ClaudeEvent?) -> [String]? {
        guard let questions = event?.toolInput?["questions"]?.value as? [Any] else { return nil }

        var keys: [String] = []
        for question in questions {
            guard let dict = question as? [String: Any] ?? (question as? [String: AnyCodable])?.mapValues(\.value) else {
                continue
            }
            if let id = dict["id"] as? String, !id.isEmpty {
                keys.append(id)
            }
            if let text = dict["question"] as? String, !text.isEmpty {
                keys.append(text)
            }
        }
        return keys.isEmpty ? nil : keys
    }

    private static func runningCodexProcesses() -> [ProcessInfo] {
        let pids = Set(codexProcessMatchers.flatMap(pidsForMatcher))
        let sortedPids = pids.sorted()

        guard !sortedPids.isEmpty else { return [] }

        return sortedPids.map { pid in
            ProcessInfo(
                pid: pid,
                cwd: cwdForPid(pid),
                tty: ttyForPid(pid)
            )
        }
    }

    private static func pidsForMatcher(_ matcher: [String]) -> [Int] {
        runCommand("/usr/bin/pgrep", arguments: matcher)
            .split(separator: "\n")
            .compactMap { Int($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
    }

    private static func cwdForPid(_ pid: Int) -> String? {
        let output = runCommand("/usr/sbin/lsof", arguments: ["-a", "-p", "\(pid)", "-d", "cwd", "-Fn"])
        return output.split(separator: "\n")
            .first(where: { $0.hasPrefix("n") })
            .map { String($0.dropFirst()) }
    }

    private static func ttyForPid(_ pid: Int) -> String? {
        let output = runCommand("/usr/sbin/lsof", arguments: ["-a", "-p", "\(pid)", "-Fn"])
        return output.split(separator: "\n")
            .compactMap { line -> String? in
                guard line.hasPrefix("n") else { return nil }
                let path = String(line.dropFirst())
                return path.hasPrefix("/dev/tty") || path.hasPrefix("/dev/ttys") ? path : nil
            }
            .first
    }

    private static func defaultActivator(pid: Int) -> Bool {
        guard let app = NSRunningApplication(processIdentifier: pid_t(pid)) else { return false }
        return app.activate()
    }

    private static func runCommand(_ launchPath: String, arguments: [String]) -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: launchPath)
        process.arguments = arguments

        let out = Pipe()
        process.standardOutput = out
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { return "" }
            let data = out.fileHandleForReading.readDataToEndOfFile()
            return String(data: data, encoding: .utf8) ?? ""
        } catch {
            return ""
        }
    }

    private static func normalized(path: String?) -> String? {
        guard let path, !path.isEmpty else { return nil }
        return URL(fileURLWithPath: path).standardizedFileURL.path
    }
}
