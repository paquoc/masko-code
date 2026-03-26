import {
  type AgentEvent,
  HookEventType,
  getEventType,
  getProjectName,
  getAssistantDisplayName,
} from "../models/agent-event";
import { createNotification, type AppNotification } from "../models/notification";
import { eventStore } from "../stores/event-store";
import { sessionStore } from "../stores/session-store";
import { notificationStore } from "../stores/notification-store";
import { permissionStore } from "../stores/permission-store";

/** Process an incoming agent event — route to all stores */
export function processEvent(event: AgentEvent): void {
  eventStore.appendEvent(event);
  sessionStore.recordEvent(event);

  const notif = createNotificationFromEvent(event);
  if (notif && notif.category !== "permissionRequest") {
    notificationStore.appendNotification(notif);
  }

  // Handle permission-related dismissals
  const eventType = getEventType(event);
  const sid = event.session_id;

  if (!eventType || !sid) return;

  // Cache PreToolUse toolUseId
  if (eventType === HookEventType.PreToolUse && event.tool_use_id && event.tool_name) {
    permissionStore.cachePreToolUse(sid, event.agent_id, event.tool_name, event.tool_use_id);
  }

  // Dismiss stale permissions by toolUseId
  if (eventType !== HookEventType.PermissionRequest && event.tool_use_id) {
    permissionStore.dismissByToolUseId(sid, event.tool_use_id);
  }

  // Stop/UserPromptSubmit: dismiss all permissions for agent
  if (
    [HookEventType.Stop, HookEventType.UserPromptSubmit].includes(eventType) &&
    permissionStore.pending.some(
      (p) => p.event.session_id === sid && p.event.agent_id === event.agent_id,
    )
  ) {
    permissionStore.dismissForAgent(sid, event.agent_id);
  }

  // PostToolUse/Failure: dismiss specific tool use
  if (
    [HookEventType.PostToolUse, HookEventType.PostToolUseFailure].includes(eventType) &&
    event.tool_use_id
  ) {
    permissionStore.dismissByToolUseId(sid, event.tool_use_id);
  }
}

/** Handle a PermissionRequest event — add to permission queue */
export function processPermissionRequest(event: AgentEvent): void {
  if (!event.request_id) {
    console.error("[masko] PermissionRequest without request_id");
    return;
  }

  permissionStore.add(event, event.request_id);

  // Also process as regular event for tracking
  processEvent(event);
}

function createNotificationFromEvent(event: AgentEvent): AppNotification | null {
  const eventType = getEventType(event);
  if (!eventType) return null;

  const assistant = getAssistantDisplayName(event);
  const project = getProjectName(event) || "a project";

  switch (eventType) {
    case HookEventType.Notification: {
      switch (event.notification_type) {
        case "permission_prompt":
          return createNotification(
            "Permission Required",
            event.message || `${assistant} needs your approval to proceed`,
            "permissionRequest",
            "urgent",
            event.session_id,
          );
        case "idle_prompt":
          return createNotification(
            `${assistant} is Waiting`,
            event.message || `${assistant} has been idle in ${project}`,
            "idleAlert",
            "high",
            event.session_id,
          );
        case "elicitation_dialog":
          return createNotification(
            "Input Needed",
            event.message || `${assistant} needs your input`,
            "elicitationDialog",
            "high",
            event.session_id,
          );
        default:
          return null;
      }
    }

    case HookEventType.PermissionRequest: {
      const body = event.message || `${assistant} wants to use ${event.tool_name || "a tool"} in ${project}`;
      return createNotification(
        event.tool_name === "AskUserQuestion" ? "Question" : "Permission Requested",
        body,
        "permissionRequest",
        "high",
        event.session_id,
      );
    }

    case HookEventType.Stop:
      return createNotification(
        "Task Completed",
        truncate(event.last_assistant_message, 100) || `${assistant} finished in ${project}`,
        "sessionLifecycle",
        "normal",
        event.session_id,
      );

    case HookEventType.PostToolUseFailure:
      return createNotification(
        "Tool Failed",
        `${event.tool_name || "A tool"} failed in ${project}`,
        "toolFailed",
        "normal",
        event.session_id,
      );

    case HookEventType.TaskCompleted:
      return createNotification(
        "Task Completed",
        event.task_subject || "A task was completed",
        "taskCompleted",
        "normal",
        event.session_id,
      );

    case HookEventType.SessionStart:
      return createNotification(
        "Session Started",
        `New session in ${project}`,
        "sessionLifecycle",
        "low",
        event.session_id,
      );

    case HookEventType.SessionEnd:
      return createNotification(
        "Session Ended",
        `Session ended in ${project}`,
        "sessionLifecycle",
        "low",
        event.session_id,
      );

    case HookEventType.PreCompact:
      return createNotification(
        "Context Compacting",
        `${assistant} is compacting context in ${project}`,
        "sessionLifecycle",
        "low",
        event.session_id,
      );

    default:
      return null;
  }
}

function truncate(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  return text.length <= max ? text : text.slice(0, max) + "...";
}
