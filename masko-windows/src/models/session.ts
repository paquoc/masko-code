import { AgentSource } from "./types";

export type SessionStatus = "active" | "ended";
export type SessionPhase = "idle" | "working" | "waiting" | "compacting";

export interface AgentSession {
  id: string; // session_id from hook event
  projectDir?: string;
  projectName?: string;
  agentSource: AgentSource;
  status: SessionStatus;
  phase: SessionPhase;
  eventCount: number;
  startedAt: Date;
  lastEventAt?: Date;
  lastToolName?: string;
  activeSubagentCount: number;
  terminalPid?: number;
  shellPid?: number;
  transcriptPath?: string;
}

export function createSession(
  id: string,
  projectDir?: string,
  projectName?: string,
  agentSource: AgentSource = AgentSource.ClaudeCode,
): AgentSession {
  return {
    id,
    projectDir,
    projectName,
    agentSource,
    status: "active",
    phase: "idle",
    eventCount: 0,
    startedAt: new Date(),
    activeSubagentCount: 0,
  };
}
