import AppKit
import Foundation

/// Best-effort focus bridge for Codex sessions when terminal PID metadata is unavailable.
enum CodexInteractiveBridge {
    struct ProcessInfo {
        let pid: Int
        let cwd: String?
        let tty: String?
    }

    /// Background replies are not supported via this bridge.
    static let supportsBackgroundReplies = false

    private static let codexProcessMatchers: [[String]] = [
        ["-x", "codex"],
        ["-x", "Codex"],
        ["-f", "codex_cli_rs"],
        ["-f", "Codex.app"],
        ["-f", "Codex Desktop"],
    ]

    struct TerminalContext {
        let terminalPid: Int
        let shellPid: Int?
    }

    /// Resolve the terminal app PID and shell PID for a Codex process matching the given project dir.
    /// Returns nil if no matching Codex process is found.
    static func resolveTerminalContext(projectDir: String?) -> TerminalContext? {
        let infos = runningCodexProcesses()
        guard !infos.isEmpty else { return nil }

        // Find matching Codex process by cwd
        let target: ProcessInfo?
        if let cwd = normalized(path: projectDir) {
            let matched = infos.filter { normalized(path: $0.cwd) == cwd }
            target = matched.count == 1 ? matched.first : matched.max(by: { $0.pid < $1.pid })
        } else {
            target = infos.count == 1 ? infos.first : nil
        }
        guard let codexPid = target?.pid else { return nil }

        // Walk up process tree to find shell and terminal app
        var shellPid: Int?
        var current = codexPid
        for _ in 0..<20 {
            let ppidStr = runCommand("/bin/ps", arguments: ["-o", "ppid=", "-p", "\(current)"])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard let ppid = Int(ppidStr), ppid > 1 else { break }
            let comm = runCommand("/bin/ps", arguments: ["-o", "comm=", "-p", "\(ppid)"])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let name = (comm as NSString).lastPathComponent
            if shellNames.contains(name) {
                shellPid = ppid
            }
            if terminalAppNames.contains(name) {
                return TerminalContext(terminalPid: ppid, shellPid: shellPid)
            }
            current = ppid
        }
        return nil
    }

    static func focus(
        event: AgentEvent,
        processInfos: [ProcessInfo]? = nil,
        activator: ((Int) -> Bool)? = nil
    ) -> Bool {
        guard AgentSource(rawSource: event.source) == .codex else { return false }

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

    static func selectProcess(for event: AgentEvent, from infos: [ProcessInfo]) -> ProcessInfo? {
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
        // Prefer the newest interactive TTY process so mascot "open terminal" still works.
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
        // Try direct activation first (works if pid is a GUI app like Codex Desktop)
        if let app = NSRunningApplication(processIdentifier: pid_t(pid)), app.activate() {
            return true
        }
        // Walk up the process tree to find the terminal/IDE app hosting the CLI
        if let terminalPid = findTerminalAncestor(of: pid),
           let app = NSRunningApplication(processIdentifier: pid_t(terminalPid)),
           app.activate() {
            return true
        }
        // Last resort: use IDETerminalFocus with the process cwd
        let cwd = cwdForPid(pid)
        if let cwd {
            IDETerminalFocus.focus(projectDir: cwd)
            return true
        }
        return false
    }

    private static let shellNames: Set<String> = [
        "zsh", "bash", "fish", "sh", "nu", "pwsh", "elvish",
        "-zsh", "-bash", "-fish", "-sh",
    ]

    /// Walk up the process tree from a CLI PID to find the enclosing terminal/IDE app.
    private static let terminalAppNames: Set<String> = [
        "Terminal", "iTerm2", "wezterm-gui", "kitty", "Cursor", "Code",
        "Windsurf", "ghostty", "alacritty", "Warp", "Zed",
        "pycharm", "idea", "webstorm", "goland", "clion", "phpstorm",
        "rubymine", "rider",
    ]

    private static func findTerminalAncestor(of pid: Int) -> Int? {
        var current = pid
        for _ in 0..<20 { // safety limit
            let ppidStr = runCommand("/bin/ps", arguments: ["-o", "ppid=", "-p", "\(current)"])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard let ppid = Int(ppidStr), ppid > 1 else { return nil }
            let comm = runCommand("/bin/ps", arguments: ["-o", "comm=", "-p", "\(ppid)"])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let name = (comm as NSString).lastPathComponent
            if terminalAppNames.contains(name) {
                return ppid
            }
            current = ppid
        }
        return nil
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
