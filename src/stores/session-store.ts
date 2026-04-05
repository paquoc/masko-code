import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { AgentEvent } from "../models/agent-event";
import { getEventType, getProjectName, getAgentSource, HookEventType } from "../models/agent-event";
import { type AgentSession, createSession } from "../models/session";

const [sessions, setSessions] = createStore<AgentSession[]>([]);
const [onPhasesChanged, setOnPhasesChanged] = createSignal(0);

function notifyPhasesChanged() {
  setOnPhasesChanged((v) => v + 1);
}

export function getActiveSessions(): AgentSession[] {
  return sessions.filter((s) => s.status === "active");
}

export function recordEvent(event: AgentEvent): void {
  const eventType = getEventType(event);
  if (!eventType || !event.session_id) return;

  const idx = sessions.findIndex((s) => s.id === event.session_id);

  switch (eventType) {
    case HookEventType.SessionStart: {
      if (idx === -1) {
        const session = createSession(
          event.session_id,
          event.cwd,
          getProjectName(event),
          getAgentSource(event),
        );
        session.transcriptPath = event.transcript_path;
        setSessions((prev) => [...prev, session]);
      }
      break;
    }

    case HookEventType.SessionEnd: {
      if (idx !== -1) {
        setSessions(idx, "status", "ended");
        setSessions(idx, "phase", "idle");
      }
      break;
    }

    case HookEventType.PreToolUse:
    case HookEventType.UserPromptSubmit: {
      if (idx !== -1) {
        setSessions(idx, "phase", "working");
        setSessions(idx, "lastEventAt", new Date());
        setSessions(idx, "eventCount", (c) => c + 1);
        if (event.tool_name) {
          setSessions(idx, "lastToolName", event.tool_name);
        }
      }
      break;
    }

    case HookEventType.PostToolUse:
    case HookEventType.PostToolUseFailure: {
      if (idx !== -1) {
        setSessions(idx, "lastEventAt", new Date());
        setSessions(idx, "eventCount", (c) => c + 1);
      }
      break;
    }

    case HookEventType.Stop:
    case HookEventType.StopFailure: {
      if (idx !== -1) {
        setSessions(idx, "phase", "idle");
        setSessions(idx, "lastEventAt", new Date());
      }
      break;
    }

    case HookEventType.PermissionRequest: {
      if (idx !== -1) {
        setSessions(idx, "phase", "waiting");
        setSessions(idx, "lastEventAt", new Date());
      }
      break;
    }

    case HookEventType.PreCompact: {
      if (idx !== -1) {
        setSessions(idx, "phase", "compacting");
      }
      break;
    }

    case HookEventType.PostCompact: {
      if (idx !== -1) {
        setSessions(idx, "phase", "working");
      }
      break;
    }

    case HookEventType.SubagentStart: {
      if (idx !== -1) {
        setSessions(idx, "activeSubagentCount", (c) => c + 1);
      }
      break;
    }

    case HookEventType.SubagentStop: {
      if (idx !== -1) {
        setSessions(idx, "activeSubagentCount", (c) => Math.max(0, c - 1));
      }
      break;
    }

    default: {
      if (idx !== -1) {
        setSessions(idx, "lastEventAt", new Date());
        setSessions(idx, "eventCount", (c) => c + 1);
      }
    }
  }

  notifyPhasesChanged();
}

export const sessionStore = {
  get sessions() { return sessions; },
  get activeSessions() { return getActiveSessions(); },
  get phasesChanged() { return onPhasesChanged(); },
  recordEvent,
};
