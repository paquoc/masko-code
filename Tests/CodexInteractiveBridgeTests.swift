import Foundation
import XCTest
@testable import masko_code

final class CodexInteractiveBridgeTests: XCTestCase {
    func testSubmitWritesAllowDecisionToMatchedCwdTTY() {
        let event = ClaudeEvent(
            hookEventName: HookEventType.permissionRequest.rawValue,
            sessionId: "sid-1",
            cwd: "/Users/test/project",
            toolName: "exec_command",
            source: "codex-cli"
        )

        let processes = [
            CodexInteractiveBridge.ProcessInfo(pid: 10, cwd: "/tmp/other", tty: "/dev/ttys001"),
            CodexInteractiveBridge.ProcessInfo(pid: 11, cwd: "/Users/test/project", tty: "/dev/ttys002"),
        ]

        var writtenPath: String?
        var writtenText: String?
        let ok = CodexInteractiveBridge.submit(
            resolution: .decision(.allow),
            event: event,
            processInfos: processes
        ) { path, text in
            writtenPath = path
            writtenText = text
            return true
        }

        XCTAssertTrue(ok)
        XCTAssertEqual(writtenPath, "/dev/ttys002")
        XCTAssertEqual(writtenText, "y\r")
    }

    func testSubmitReturnsFalseWhenAmbiguousWithoutCwdMatch() {
        let event = ClaudeEvent(
            hookEventName: HookEventType.permissionRequest.rawValue,
            sessionId: "sid-2",
            cwd: nil,
            toolName: "exec_command",
            source: "codex-cli"
        )

        let processes = [
            CodexInteractiveBridge.ProcessInfo(pid: 20, cwd: "/a", tty: "/dev/ttys003"),
            CodexInteractiveBridge.ProcessInfo(pid: 21, cwd: "/b", tty: "/dev/ttys004"),
        ]

        let ok = CodexInteractiveBridge.submit(
            resolution: .decision(.deny),
            event: event,
            processInfos: processes
        ) { _, _ in
            XCTFail("Writer should not be called when process selection is ambiguous")
            return false
        }

        XCTAssertFalse(ok)
    }

    func testSubmitSelectsNewestTTYForCodexDesktopWhenNoCwdMatch() {
        let event = ClaudeEvent(
            hookEventName: HookEventType.permissionRequest.rawValue,
            sessionId: "sid-2b",
            cwd: nil,
            toolName: "exec_command",
            source: "codex-desktop"
        )

        let processes = [
            CodexInteractiveBridge.ProcessInfo(pid: 120, cwd: nil, tty: "/dev/ttys010"),
            CodexInteractiveBridge.ProcessInfo(pid: 125, cwd: nil, tty: "/dev/ttys011"),
        ]

        var writtenPath: String?
        let ok = CodexInteractiveBridge.submit(
            resolution: .decision(.allow),
            event: event,
            processInfos: processes
        ) { path, _ in
            writtenPath = path
            return true
        }

        XCTAssertTrue(ok)
        XCTAssertEqual(writtenPath, "/dev/ttys011")
    }

    func testInputTextForAnswersAndFeedback() {
        let answersText = CodexInteractiveBridge.inputText(for: .answers([
            "b": "second",
            "a": "first",
        ]))
        XCTAssertEqual(answersText, "first\rsecond\r")

        let feedbackText = CodexInteractiveBridge.inputText(for: .feedback("  looks good  "))
        XCTAssertEqual(feedbackText, "e\rlooks good\r")
    }

    func testInputTextForPermissionSuggestionsUsesAlwaysApproveShortcut() {
        let suggestions = [
            PermissionSuggestion(
                type: "addRules",
                destination: "session",
                behavior: "allow",
                rules: [["toolName": "exec_command", "ruleContent": "git push"]],
                mode: nil
            ),
        ]

        let inputText = CodexInteractiveBridge.inputText(for: .permissionSuggestions(suggestions))

        XCTAssertEqual(inputText, "p\r")
    }

    func testInputTextForAnswersUsesQuestionOrderFromEvent() {
        let event = ClaudeEvent(
            hookEventName: HookEventType.permissionRequest.rawValue,
            sessionId: "sid-ordered",
            cwd: "/Users/test/project",
            toolName: "AskUserQuestion",
            toolInput: [
                "questions": AnyCodable([
                    [
                        "id": "question_b",
                        "question": "Second question?",
                    ],
                    [
                        "id": "question_a",
                        "question": "First question?",
                    ],
                ]),
            ],
            source: "codex-cli"
        )

        let answersText = CodexInteractiveBridge.inputText(
            for: .answers([
                "First question?": "first",
                "Second question?": "second",
            ]),
            event: event
        )

        XCTAssertEqual(answersText, "second\rfirst\r")
    }

    func testFocusSelectsMatchingCodexDesktopProcess() {
        let event = ClaudeEvent(
            hookEventName: HookEventType.permissionRequest.rawValue,
            sessionId: "sid-focus",
            cwd: nil,
            toolName: "exec_command",
            source: "codex-desktop"
        )

        let processes = [
            CodexInteractiveBridge.ProcessInfo(pid: 120, cwd: nil, tty: "/dev/ttys010"),
            CodexInteractiveBridge.ProcessInfo(pid: 125, cwd: nil, tty: "/dev/ttys011"),
        ]

        var activatedPid: Int?
        let ok = CodexInteractiveBridge.focus(event: event, processInfos: processes) { pid in
            activatedPid = pid
            return true
        }

        XCTAssertTrue(ok)
        XCTAssertEqual(activatedPid, 125)
    }

    func testSubmitRejectsClaudeEvents() {
        let event = ClaudeEvent(
            hookEventName: HookEventType.permissionRequest.rawValue,
            sessionId: "sid-3",
            cwd: "/Users/test/project",
            toolName: "Bash",
            source: "claude"
        )

        let ok = CodexInteractiveBridge.submit(
            resolution: .decision(.allow),
            event: event,
            processInfos: [CodexInteractiveBridge.ProcessInfo(pid: 42, cwd: "/Users/test/project", tty: "/dev/ttys009")]
        ) { _, _ in
            XCTFail("Writer should not be called for Claude events")
            return false
        }

        XCTAssertFalse(ok)
    }
}
