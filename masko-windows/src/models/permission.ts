import type { AgentEvent } from "./agent-event";

export interface PermissionSuggestion {
  id: string;
  type: string; // "addRules" or "setMode"
  destination?: string; // "session" or "localSettings"
  behavior?: string; // "allow"
  rules?: Array<{ toolName: string; ruleContent: string }>;
  mode?: string; // e.g. "acceptEdits"
  displayLabel: string;
  fullLabel: string; // untruncated version for tooltips
}

export interface PendingPermission {
  id: string;
  event: AgentEvent;
  requestId: string; // maps to the HTTP connection held in Rust
  receivedAt: Date;
  resolvedToolUseId?: string;
  collapsed: boolean;
}

export type PermissionDecision = "allow" | "deny";

/** Parse permission suggestions from Claude Code event */
export function parsePermissionSuggestions(raw?: any[]): PermissionSuggestion[] {
  if (!raw) return [];
  return raw.map((s: any) => {
    let displayLabel = s.type || "Unknown";

    let fullLabel = displayLabel;

    if (s.type === "addRules") {
      const firstRule = s.rules?.[0];
      if (firstRule) {
        const toolName = firstRule.toolName || "tool";
        const ruleContent = firstRule.ruleContent || "";
        if (ruleContent.includes("**")) {
          const folder = ruleContent.replace(/\/\*\*$/, "").split("/").pop() || "";
          displayLabel = `Allow ${toolName} in ${folder}/`;
          fullLabel = `Allow ${toolName} in ${ruleContent}`;
        } else if (ruleContent) {
          fullLabel = `Always allow \`${ruleContent}\``;
          const short = ruleContent.length > 30 ? ruleContent.slice(0, 27) + "..." : ruleContent;
          displayLabel = `Always allow \`${short}\``;
        } else {
          displayLabel = `Always allow ${toolName}`;
          fullLabel = displayLabel;
        }
      }
    } else if (s.type === "setMode") {
      switch (s.mode) {
        case "acceptEdits": displayLabel = "Auto-accept edits"; break;
        case "plan": displayLabel = "Switch to plan mode"; break;
        default: displayLabel = s.mode || "Set mode";
      }
      fullLabel = displayLabel;
    }

    return {
      id: crypto.randomUUID(),
      type: s.type,
      destination: s.destination,
      behavior: s.behavior,
      rules: s.rules,
      mode: s.mode,
      displayLabel,
      fullLabel,
    };
  });
}

/** Parsed question from AskUserQuestion tool */
export interface ParsedQuestion {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect: boolean;
}
