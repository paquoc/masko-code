import { createStore } from "solid-js/store";
import { createSignal } from "solid-js";
import type { AgentEvent } from "../models/agent-event";
import type { PendingPermission, PermissionDecision } from "../models/permission";
import { invoke } from "@tauri-apps/api/core";

const [pending, setPending] = createStore<PendingPermission[]>([]);
const [onPendingCountChange, setOnPendingCountChange] = createSignal(0);

// Cache PreToolUse toolUseId → correlate with PermissionRequest
const preToolUseCache = new Map<string, string>(); // key: `${sessionId}:${toolName}` → toolUseId

export function cachePreToolUse(sessionId: string, agentId: string | undefined, toolName: string, toolUseId: string): void {
  const key = `${sessionId}:${agentId || ""}:${toolName}`;
  preToolUseCache.set(key, toolUseId);
}

export function add(event: AgentEvent, requestId: string): void {
  // Try to resolve toolUseId from cache
  const key = `${event.session_id || ""}:${event.agent_id || ""}:${event.tool_name || ""}`;
  const resolvedToolUseId = event.tool_use_id || preToolUseCache.get(key);
  if (resolvedToolUseId) {
    preToolUseCache.delete(key);
  }

  const perm: PendingPermission = {
    id: crypto.randomUUID(),
    event,
    requestId,
    receivedAt: new Date(),
    resolvedToolUseId,
    collapsed: false,
  };

  setPending((prev) => [...prev, perm]);
  setOnPendingCountChange((v) => v + 1);
}

export async function resolve(id: string, decision: PermissionDecision, suggestion?: any): Promise<void> {
  const perm = pending.find((p) => p.id === id);
  if (!perm) return;

  // Build decision payload
  const payload: any = { permission: decision };
  if (suggestion) {
    payload.suggestion = suggestion;
  }

  // Send resolution to Rust backend → HTTP response to hook script
  try {
    await invoke("resolve_permission", {
      requestId: perm.requestId,
      decision: payload,
    });
  } catch (e) {
    console.error("[masko] Failed to resolve permission:", e);
  }

  // Remove from pending
  setPending((prev) => prev.filter((p) => p.id !== id));
  setOnPendingCountChange((v) => v + 1);
}

export function collapse(id: string): void {
  const idx = pending.findIndex((p) => p.id === id);
  if (idx !== -1) {
    setPending(idx, "collapsed", true);
  }
}

export function expand(id: string): void {
  const idx = pending.findIndex((p) => p.id === id);
  if (idx !== -1) {
    setPending(idx, "collapsed", false);
  }
}

export function dismissForAgent(sessionId: string, agentId?: string): void {
  const toRemove = pending.filter(
    (p) => p.event.session_id === sessionId && p.event.agent_id === agentId,
  );
  for (const p of toRemove) {
    resolve(p.id, "deny").catch(() => {});
  }
}

export function dismissByToolUseId(sessionId: string, toolUseId: string): void {
  const toRemove = pending.filter(
    (p) => p.event.session_id === sessionId && p.resolvedToolUseId === toolUseId,
  );
  for (const p of toRemove) {
    resolve(p.id, "deny").catch(() => {});
  }
}

export const permissionStore = {
  get pending() { return pending; },
  get pendingCountChanged() { return onPendingCountChange(); },
  add,
  resolve,
  collapse,
  expand,
  dismissForAgent,
  dismissByToolUseId,
  cachePreToolUse,
};
