import { createStore } from "solid-js/store";
import { createSignal } from "solid-js";
import type { AgentEvent } from "../models/agent-event";
import type { PendingPermission, PermissionDecision } from "../models/permission";
import { invoke } from "@tauri-apps/api/core";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { log, error } from "../services/log";
import { hotkeyStore } from "./hotkey-store";

const [pending, setPending] = createStore<PendingPermission[]>([]);
const [onPendingCountChange, _setOnPendingCountChange] = createSignal(0);
/** Bump the count signal AND sync hotkeys */
function setOnPendingCountChange(fn: (v: number) => number): void {
  _setOnPendingCountChange(fn);
  syncHotkeys();
}

// --- Global shortcut + window keydown fallback ---
let globalRegistered = false;
let windowRegistered = false;
let registeredAccelerators: string[] = [];

function handleApprove(): void {
  const perm = pending.find((p) => !p.collapsed);
  if (perm) {
    log("[hotkey] approve", perm.id);
    resolve(perm.id, "allow");
  }
}

function handleDeny(): void {
  const perm = pending.find((p) => !p.collapsed);
  if (perm) {
    log("[hotkey] deny", perm.id);
    resolve(perm.id, "deny");
  }
}

// Window keydown fallback (works when overlay has focus)
function handleKeyDown(e: KeyboardEvent): void {
  const { approve, deny } = hotkeyStore.settings;
  if (hotkeyStore.matchesBinding(e, approve)) { e.preventDefault(); handleApprove(); }
  else if (hotkeyStore.matchesBinding(e, deny)) { e.preventDefault(); handleDeny(); }
}

async function registerHotkeys(): Promise<void> {
  const { approve, deny } = hotkeyStore.settings;
  const approveAccel = hotkeyStore.bindingToTauriAccelerator(approve);
  const denyAccel = hotkeyStore.bindingToTauriAccelerator(deny);

  // 1) Global shortcuts (OS-level, works without focus)
  if (!globalRegistered) {
    try {
      // Unregister leftover from previous run
      await unregister(approveAccel).catch(() => {});
      await unregister(denyAccel).catch(() => {});
      await register(approveAccel, (e) => {
        if (e.state === "Pressed") handleApprove();
      });
      await register(denyAccel, (e) => {
        if (e.state === "Pressed") handleDeny();
      });
      globalRegistered = true;
      registeredAccelerators = [approveAccel, denyAccel];
      log(`[registerHotkeys] ✓ Global: ${approveAccel}, ${denyAccel}`);
    } catch (e) {
      error("[registerHotkeys] ✗ Global shortcut failed:", e);
    }
  }

  // 2) Window keydown fallback
  if (!windowRegistered) {
    window.addEventListener("keydown", handleKeyDown);
    windowRegistered = true;
  }
}

async function unregisterHotkeys(): Promise<void> {
  if (globalRegistered) {
    for (const accel of registeredAccelerators) {
      await unregister(accel).catch(() => {});
    }
    globalRegistered = false;
    registeredAccelerators = [];
  }
  if (windowRegistered) {
    window.removeEventListener("keydown", handleKeyDown);
    windowRegistered = false;
  }
}

/** Re-register hotkeys when settings change */
export async function reloadHotkeys(): Promise<void> {
  await unregisterHotkeys();
  const hasUncollapsed = pending.some((p) => !p.collapsed);
  if (hasUncollapsed) await registerHotkeys();
}

/** Sync hotkey registration with pending permission count */
function syncHotkeys(): void {
  const hasUncollapsed = pending.some((p) => !p.collapsed);
  if (hasUncollapsed && !globalRegistered) {
    registerHotkeys();
  } else if (!hasUncollapsed && (globalRegistered || windowRegistered)) {
    unregisterHotkeys();
  }
}

// Cache PreToolUse toolUseId → correlate with PermissionRequest
const preToolUseCache = new Map<string, string>(); // key: `${sessionId}:${toolName}` → toolUseId

export function cachePreToolUse(sessionId: string, agentId: string | undefined, toolName: string, toolUseId: string): void {
  const key = `${sessionId}:${agentId || ""}:${toolName}`;
  preToolUseCache.set(key, toolUseId);
}

export function add(event: AgentEvent, requestId: string): void {
  // Deduplicate: both "hook-event" and "permission-request" listeners call add()
  if (pending.some((p) => p.id === requestId)) return;

  // Try to resolve toolUseId from cache
  const key = `${event.session_id || ""}:${event.agent_id || ""}:${event.tool_name || ""}`;
  const resolvedToolUseId = event.tool_use_id || preToolUseCache.get(key);
  if (resolvedToolUseId) {
    preToolUseCache.delete(key);
  }

  const perm: PendingPermission = {
    id: requestId,
    event,
    requestId,
    receivedAt: new Date(),
    resolvedToolUseId,
    collapsed: false,
  };

  setPending((prev) => [...prev, perm]);
  setOnPendingCountChange((v) => v + 1);
}

const resolving = new Set<string>();

export async function resolve(id: string, decision: PermissionDecision, suggestion?: any): Promise<void> {
  if (resolving.has(id)) return;
  const perm = pending.find((p) => p.id === id);
  if (!perm) return;
  resolving.add(id);

  // Remove from pending IMMEDIATELY so UI updates before await
  setPending((prev) => prev.filter((p) => p.id !== id));
  setOnPendingCountChange((v) => v + 1);

  // Build Claude Code hook response format
  const hookDecision: any = { behavior: decision };
  if (suggestion) {
    if (suggestion.type === "updatedInput") {
      hookDecision.updatedInput = suggestion;
    } else if (suggestion.type === "addRules" && suggestion.rules) {
      hookDecision.updatedPermissions = [suggestion];
    } else if (suggestion.type === "setMode" && suggestion.mode) {
      hookDecision.updatedPermissions = [suggestion];
    } else if (suggestion.type === "feedback" && suggestion.reason) {
      hookDecision.message = suggestion.reason;
    }
    log("Permission suggestion applied:", JSON.stringify(suggestion));
  }

  const payload = {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: hookDecision,
    },
  };

  log("Permission resolved, body:", JSON.stringify(payload));

  // Send resolution to Rust backend → HTTP response to hook script
  try {
    await invoke("resolve_permission", {
      requestId: perm.requestId,
      decision: payload,
    });
  } catch (e) {
    error("Failed to resolve permission:", e);
  } finally {
    resolving.delete(id);
  }
}

export function collapse(id: string): void {
  const idx = pending.findIndex((p) => p.id === id);
  if (idx !== -1) {
    setPending(idx, "collapsed", true);
    syncHotkeys();
  }
}

export function expand(id: string): void {
  const idx = pending.findIndex((p) => p.id === id);
  if (idx !== -1) {
    setPending(idx, "collapsed", false);
    syncHotkeys();
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

/** Dismiss a permission by its backend request ID (e.g. on timeout) */
export function dismissByRequestId(requestId: string): void {
  const perm = pending.find((p) => p.requestId === requestId);
  if (perm) {
    setPending((prev) => prev.filter((p) => p.requestId !== requestId));
    setOnPendingCountChange((v) => v + 1);
  }
}

/** Dismiss pending permission when CLI already accepted (PostToolUse for same session+tool+input) */
export function dismissIfCliAccepted(sessionId: string, toolName: string, toolInput?: unknown): void {
  const toRemove = pending.filter((p) => {
    if (p.event.session_id !== sessionId || p.event.tool_name !== toolName) return false;
    if (toolInput === undefined) return true;
    return JSON.stringify(p.event.tool_input) === JSON.stringify(toolInput);
  });
  for (const p of toRemove) {
    resolve(p.id, "allow").catch(() => {});
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
  dismissByRequestId,
  dismissIfCliAccepted,
  cachePreToolUse,
};
