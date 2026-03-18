import XCTest
@testable import masko_code

@MainActor
final class EventProcessorTests: XCTestCase {
    func testCodexPermissionNotificationUsesEventMessage() async throws {
        let eventStore = EventStore()
        eventStore.clear()
        let sessionStore = SessionStore()
        defer { sessionStore.stopTimers() }
        let notificationStore = NotificationStore()
        let processor = EventProcessor(
            eventStore: eventStore,
            sessionStore: sessionStore,
            notificationStore: notificationStore,
            notificationService: .shared
        )

        let sessionId = "event-processor-codex-permission"
        let event = AgentEvent(
            hookEventName: HookEventType.permissionRequest.rawValue,
            sessionId: sessionId,
            cwd: "/tmp/project",
            toolName: "exec_command",
            message: "Need network access to push",
            source: "codex-cli"
        )

        await processor.process(event)

        let notification = try XCTUnwrap(notificationStore.notifications.first(where: { $0.sessionId == sessionId }))
        XCTAssertEqual(notification.title, "Permission Requested")
        XCTAssertEqual(notification.body, "Need network access to push")
    }

    func testClaudePermissionNotificationUsesEventMessage() async throws {
        let eventStore = EventStore()
        eventStore.clear()
        let sessionStore = SessionStore()
        defer { sessionStore.stopTimers() }
        let notificationStore = NotificationStore()
        let processor = EventProcessor(
            eventStore: eventStore,
            sessionStore: sessionStore,
            notificationStore: notificationStore,
            notificationService: .shared
        )

        let sessionId = "event-processor-claude-permission"
        let event = AgentEvent(
            hookEventName: HookEventType.permissionRequest.rawValue,
            sessionId: sessionId,
            cwd: "/tmp/project",
            toolName: "Bash",
            message: "Need approval to run Bash",
            source: "claude"
        )

        await processor.process(event)

        let notification = try XCTUnwrap(notificationStore.notifications.first(where: { $0.sessionId == sessionId }))
        XCTAssertEqual(notification.title, "Permission Requested")
        XCTAssertEqual(notification.body, "Need approval to run Bash")
    }

    func testCodexQuestionStopStillCreatesCompletionNotificationWhenProcessed() async throws {
        let eventStore = EventStore()
        eventStore.clear()
        let sessionStore = SessionStore()
        defer { sessionStore.stopTimers() }
        let notificationStore = NotificationStore()
        let processor = EventProcessor(
            eventStore: eventStore,
            sessionStore: sessionStore,
            notificationStore: notificationStore,
            notificationService: .shared
        )

        let sessionId = "event-processor-codex-question-stop"
        let event = AgentEvent(
            hookEventName: HookEventType.stop.rawValue,
            sessionId: sessionId,
            cwd: "/tmp/project",
            source: "codex-cli",
            reason: "completed",
            lastAssistantMessage: "Which remote should I use for the dry-run push?"
        )

        await processor.process(event)

        let notification = try XCTUnwrap(notificationStore.notifications.first(where: { $0.sessionId == sessionId }))
        XCTAssertEqual(notification.title, "Task Completed")
        XCTAssertEqual(notification.category, .sessionLifecycle)
    }

    func testCodexQuestionTaskCompletedStillCreatesNotificationWhenProcessed() async throws {
        let eventStore = EventStore()
        eventStore.clear()
        let sessionStore = SessionStore()
        defer { sessionStore.stopTimers() }
        let notificationStore = NotificationStore()
        let processor = EventProcessor(
            eventStore: eventStore,
            sessionStore: sessionStore,
            notificationStore: notificationStore,
            notificationService: .shared
        )

        let sessionId = "event-processor-codex-question-task"
        let event = AgentEvent(
            hookEventName: HookEventType.taskCompleted.rawValue,
            sessionId: sessionId,
            cwd: "/tmp/project",
            source: "codex-cli",
            taskSubject: "Which remote should I use for the dry-run push?"
        )

        await processor.process(event)

        let notification = try XCTUnwrap(notificationStore.notifications.first(where: { $0.sessionId == sessionId }))
        XCTAssertEqual(notification.title, "Task Completed")
        XCTAssertEqual(notification.category, .taskCompleted)
    }

    func testClaudeStopStillCreatesCompletionNotificationForQuestionText() async throws {
        let eventStore = EventStore()
        eventStore.clear()
        let sessionStore = SessionStore()
        defer { sessionStore.stopTimers() }
        let notificationStore = NotificationStore()
        let processor = EventProcessor(
            eventStore: eventStore,
            sessionStore: sessionStore,
            notificationStore: notificationStore,
            notificationService: .shared
        )

        let sessionId = "event-processor-claude-stop-question"
        let event = AgentEvent(
            hookEventName: HookEventType.stop.rawValue,
            sessionId: sessionId,
            cwd: "/tmp/project",
            source: "claude",
            reason: "completed",
            lastAssistantMessage: "Do you want me to continue?"
        )

        await processor.process(event)

        let notification = try XCTUnwrap(notificationStore.notifications.first(where: { $0.sessionId == sessionId }))
        XCTAssertEqual(notification.title, "Task Completed")
        XCTAssertEqual(notification.body, "Do you want me to continue?")
    }
}
