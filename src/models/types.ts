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

/** Parse a raw JSON condition value (bool or number) into ConditionValue.
 *  Idempotent — safely handles already-parsed ConditionValue objects. */
export function parseConditionValue(raw: unknown): ConditionValue {
  if (typeof raw === "boolean") {
    console.log(`[masko:parse] primitive bool → ${raw}`);
    return conditionBool(raw);
  }
  if (typeof raw === "number") {
    console.log(`[masko:parse] primitive number → ${raw}`);
    return conditionNumber(raw);
  }
  // Handle already-parsed ConditionValue (e.g. config loaded from store / localStorage)
  if (typeof raw === "object" && raw !== null && "type" in raw) {
    const obj = raw as Record<string, unknown>;
    if (obj.type === "bool" && typeof obj.value === "boolean") {
      console.log(`[masko:parse] already-parsed bool → ${obj.value}`);
      return conditionBool(obj.value);
    }
    if (obj.type === "number" && typeof obj.value === "number") {
      console.log(`[masko:parse] already-parsed number → ${obj.value}`);
      return conditionNumber(obj.value);
    }
  }
  console.warn(`[masko:parse] fallback to true — raw was:`, raw);
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
