import { AgentSource } from "./types";

/** All Claude Code / Codex hook event types */
export enum HookEventType {
  SessionStart = "SessionStart",
  SessionEnd = "SessionEnd",
  UserPromptSubmit = "UserPromptSubmit",
  PreToolUse = "PreToolUse",
  PostToolUse = "PostToolUse",
  PostToolUseFailure = "PostToolUseFailure",
  PermissionRequest = "PermissionRequest",
  Stop = "Stop",
  StopFailure = "StopFailure",
  SubagentStart = "SubagentStart",
  SubagentStop = "SubagentStop",
  Notification = "Notification",
  PreCompact = "PreCompact",
  PostCompact = "PostCompact",
  TaskCompleted = "TaskCompleted",
  TeammateIdle = "TeammateIdle",
  ConfigChange = "ConfigChange",
  WorktreeCreate = "WorktreeCreate",
  WorktreeRemove = "WorktreeRemove",
}

export const HOOK_EVENT_DISPLAY: Record<HookEventType, string> = {
  [HookEventType.SessionStart]: "Session Started",
  [HookEventType.SessionEnd]: "Session Ended",
  [HookEventType.UserPromptSubmit]: "Prompt Submitted",
  [HookEventType.PreToolUse]: "Tool Starting",
  [HookEventType.PostToolUse]: "Tool Completed",
  [HookEventType.PostToolUseFailure]: "Tool Failed",
  [HookEventType.PermissionRequest]: "Permission Requested",
  [HookEventType.Stop]: "Agent Stopped",
  [HookEventType.StopFailure]: "Agent Error",
  [HookEventType.SubagentStart]: "Subagent Started",
  [HookEventType.SubagentStop]: "Subagent Stopped",
  [HookEventType.Notification]: "Notification",
  [HookEventType.PreCompact]: "Context Compacting",
  [HookEventType.PostCompact]: "Context Compacted",
  [HookEventType.TaskCompleted]: "Task Completed",
  [HookEventType.TeammateIdle]: "Teammate Idle",
  [HookEventType.ConfigChange]: "Config Changed",
  [HookEventType.WorktreeCreate]: "Worktree Created",
  [HookEventType.WorktreeRemove]: "Worktree Removed",
};

export const HOOK_EVENT_COLOR: Record<HookEventType, string> = {
  [HookEventType.SessionStart]: "green",
  [HookEventType.SessionEnd]: "red",
  [HookEventType.UserPromptSubmit]: "secondary",
  [HookEventType.PreToolUse]: "purple",
  [HookEventType.PostToolUse]: "purple",
  [HookEventType.PostToolUseFailure]: "red",
  [HookEventType.PermissionRequest]: "orange",
  [HookEventType.Stop]: "blue",
  [HookEventType.StopFailure]: "red",
  [HookEventType.SubagentStart]: "green",
  [HookEventType.SubagentStop]: "red",
  [HookEventType.Notification]: "orange",
  [HookEventType.PreCompact]: "secondary",
  [HookEventType.PostCompact]: "secondary",
  [HookEventType.TaskCompleted]: "blue",
  [HookEventType.TeammateIdle]: "secondary",
  [HookEventType.ConfigChange]: "secondary",
  [HookEventType.WorktreeCreate]: "secondary",
  [HookEventType.WorktreeRemove]: "secondary",
};

export const HIGH_PRIORITY_EVENTS = new Set([
  HookEventType.Notification,
  HookEventType.PermissionRequest,
  HookEventType.PostToolUseFailure,
]);

/** A single agent hook event — matches the JSON from hook scripts */
export interface AgentEvent {
  /** Client-generated UUID */
  id: string;
  hook_event_name: string;
  session_id?: string;
  cwd?: string;
  permission_mode?: string;
  transcript_path?: string;

  // Tool events
  tool_name?: string;
  tool_input?: Record<string, any>;
  tool_response?: Record<string, any>;
  tool_use_id?: string;

  // Notification events
  message?: string;
  title?: string;
  notification_type?: string;

  // Session events
  source?: string;
  reason?: string;
  model?: string;

  // Stop events
  stop_hook_active?: boolean;
  last_assistant_message?: string;

  // Subagent events
  agent_id?: string;
  agent_type?: string;

  // Task events
  task_id?: string;
  task_subject?: string;

  // Permission suggestions
  permission_suggestions?: any[];

  // Terminal PID (injected by hook script)
  terminal_pid?: number;
  shell_pid?: number;

  // Server-injected
  request_id?: string;

  // Local timestamp
  received_at: Date;
}

/** Parse raw JSON into AgentEvent */
export function parseAgentEvent(raw: any): AgentEvent {
  return {
    ...raw,
    id: raw.id || crypto.randomUUID(),
    received_at: new Date(),
  };
}

/** Get the typed event type, or undefined if unknown */
export function getEventType(event: AgentEvent): HookEventType | undefined {
  return Object.values(HookEventType).includes(event.hook_event_name as HookEventType)
    ? (event.hook_event_name as HookEventType)
    : undefined;
}

/** Extract project name from cwd */
export function getProjectName(event: AgentEvent): string | undefined {
  if (!event.cwd) return undefined;
  const parts = event.cwd.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || undefined;
}

export type AssistantClientKind = "claude" | "codexCLI" | "codexDesktop" | "codex";

export function getAssistantClientKind(event: AgentEvent): AssistantClientKind {
  const src = (event.source || "").toLowerCase();
  if (src.includes("codex-desktop") || src === "vscode" || src.includes("desktop"))
    return "codexDesktop";
  if (src.includes("codex-cli") || src === "cli" || src.includes("codex_cli"))
    return "codexCLI";
  if (src.includes("codex")) return "codex";
  return "claude";
}

export function getAssistantDisplayName(event: AgentEvent): string {
  const kind = getAssistantClientKind(event);
  return kind === "claude" ? "Claude Code" : "Codex";
}

export function getAgentSource(event: AgentEvent): AgentSource {
  const kind = getAssistantClientKind(event);
  if (kind === "claude") return AgentSource.ClaudeCode;
  return AgentSource.Codex;
}
