import XCTest
@testable import masko_code

final class AppStoreAssistantEventStatusTests: XCTestCase {
    func testCodexQuestionStopDoesNotDismissPendingPermissions() {
        let event = ClaudeEvent(
            hookEventName: HookEventType.stop.rawValue,
            sessionId: "codex-question-stop",
            cwd: "/tmp/project",
            source: "codex-cli",
            reason: "completed",
            lastAssistantMessage: "Which remote should I use for the dry-run push?"
        )

        XCTAssertFalse(AppStore.shouldDismissPendingPermissions(for: event))
    }

    func testClaudeStopStillDismissesPendingPermissions() {
        let event = ClaudeEvent(
            hookEventName: HookEventType.stop.rawValue,
            sessionId: "claude-stop",
            cwd: "/tmp/project",
            source: "claude",
            reason: "completed",
            lastAssistantMessage: "Do you want me to continue?"
        )

        XCTAssertTrue(AppStore.shouldDismissPendingPermissions(for: event))
    }

    func testCodexQuestionStopDoesNotShowSessionFinishedToast() {
        let event = ClaudeEvent(
            hookEventName: HookEventType.stop.rawValue,
            sessionId: "codex-question-stop",
            cwd: "/tmp/project",
            source: "codex-cli",
            reason: "completed",
            lastAssistantMessage: "Which remote should I use for the dry-run push?"
        )

        XCTAssertFalse(AppStore.shouldShowSessionFinishedToast(for: event, hasPendingPermissions: false))
    }

    func testClaudeStopStillShowsSessionFinishedToastWhenNoPendingPermissions() {
        let event = ClaudeEvent(
            hookEventName: HookEventType.stop.rawValue,
            sessionId: "claude-stop",
            cwd: "/tmp/project",
            source: "claude",
            reason: "completed",
            lastAssistantMessage: "Do you want me to continue?"
        )

        XCTAssertTrue(AppStore.shouldShowSessionFinishedToast(for: event, hasPendingPermissions: false))
    }

    func testStatusWhenBothClaudeAndCodexIngestionAreActive() {
        let status = AppStore.assistantEventIngestionStatus(
            localServerRunning: true,
            localServerPort: 49152,
            codexMonitorRunning: true
        )
        XCTAssertTrue(status.isActive)
        XCTAssertEqual(status.text, "Listening on 49152 + Codex logs")
    }

    func testStatusWhenOnlyClaudeHookServerIsActive() {
        let status = AppStore.assistantEventIngestionStatus(
            localServerRunning: true,
            localServerPort: 49152,
            codexMonitorRunning: false
        )
        XCTAssertTrue(status.isActive)
        XCTAssertEqual(status.text, "Listening on 49152")
    }

    func testStatusWhenOnlyCodexLogMonitorIsActive() {
        let status = AppStore.assistantEventIngestionStatus(
            localServerRunning: false,
            localServerPort: 49152,
            codexMonitorRunning: true
        )
        XCTAssertTrue(status.isActive)
        XCTAssertEqual(status.text, "Listening to Codex logs")
    }

    func testStatusWhenNoIngestionIsActive() {
        let status = AppStore.assistantEventIngestionStatus(
            localServerRunning: false,
            localServerPort: 49152,
            codexMonitorRunning: false
        )
        XCTAssertFalse(status.isActive)
        XCTAssertEqual(status.text, "Offline")
    }
}
