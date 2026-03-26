// Condition value — used in animation state machine conditions
export type ConditionValue =
  | { type: "bool"; value: boolean }
  | { type: "number"; value: number };

export function conditionBool(v: boolean): ConditionValue {
  return { type: "bool", value: v };
}

export function conditionNumber(v: number): ConditionValue {
  return { type: "number", value: v };
}

export function conditionToDouble(v: ConditionValue): number {
  return v.type === "bool" ? (v.value ? 1 : 0) : v.value;
}

export function conditionEqual(a: ConditionValue, b: ConditionValue): boolean {
  return conditionToDouble(a) === conditionToDouble(b);
}

/** Parse a raw JSON condition value (bool or number) into ConditionValue */
export function parseConditionValue(raw: unknown): ConditionValue {
  if (typeof raw === "boolean") return conditionBool(raw);
  if (typeof raw === "number") return conditionNumber(raw);
  return conditionBool(true); // default
}

// Agent source — which AI assistant sent the event
export enum AgentSource {
  ClaudeCode = "claudeCode",
  Codex = "codex",
  Copilot = "copilot",
}

// Active overlay card — determines which card owns keyboard shortcuts
export enum ActiveCard {
  None = 0,
  Toast = 1,
  Permission = 2,
  ExpandedPermission = 3,
  SessionSwitcher = 4,
}
