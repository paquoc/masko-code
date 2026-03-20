import XCTest
@testable import masko_code

final class ClaudeEventAssistantTests: XCTestCase {
    func testAssistantDisplayNameDefaultsToClaude() {
        let event = AgentEvent(hookEventName: HookEventType.sessionStart.rawValue)
        XCTAssertEqual(event.assistantDisplayName, "Claude Code")
    }

    func testAssistantDisplayNameDetectsCodexCLI() {
        let event = AgentEvent(
            hookEventName: HookEventType.sessionStart.rawValue,
            source: "codex-cli"
        )
        XCTAssertEqual(event.assistantDisplayName, "Codex")
    }

    func testAssistantDisplayNameDetectsCodexDesktop() {
        let event = AgentEvent(
            hookEventName: HookEventType.sessionStart.rawValue,
            source: "vscode"
        )
        XCTAssertEqual(event.assistantDisplayName, "Codex")
    }
}
