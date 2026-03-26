import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { parseAgentEvent, type AgentEvent, HookEventType } from "../models/agent-event";
import { processEvent, processPermissionRequest } from "./event-processor";

/** Start listening for events from the Rust backend */
export async function startEventListeners(): Promise<UnlistenFn[]> {
  const unlisteners: UnlistenFn[] = [];

  // Hook events (non-permission)
  unlisteners.push(
    await listen<any>("hook-event", (e) => {
      const event = parseAgentEvent(e.payload);

      if (event.hook_event_name === HookEventType.PermissionRequest) {
        processPermissionRequest(event);
      } else {
        processEvent(event);
      }
    }),
  );

  // Custom input events
  unlisteners.push(
    await listen<any>("input-event", (e) => {
      // Will be wired to state machine in Phase 06
      console.log("[masko] Input event:", e.payload);
    }),
  );

  // Mascot install events (from masko.ai)
  unlisteners.push(
    await listen<any>("mascot-install", (e) => {
      console.log("[masko] Mascot install:", e.payload);
      // Will be handled in mascot store
    }),
  );

  // Server status updates
  unlisteners.push(
    await listen<any>("server-status", (e) => {
      console.log("[masko] Server status:", e.payload);
    }),
  );

  console.log("[masko] Event listeners started");
  return unlisteners;
}

/** Get server status from Rust backend */
export async function getServerStatus(): Promise<{ running: boolean; port: number }> {
  return invoke("get_server_status");
}

/** Install hooks into ~/.claude/settings.json */
export async function installHooks(): Promise<void> {
  return invoke("install_hooks");
}

/** Uninstall hooks from ~/.claude/settings.json */
export async function uninstallHooks(): Promise<void> {
  return invoke("uninstall_hooks");
}

/** Check if hooks are registered */
export async function isHooksRegistered(): Promise<boolean> {
  return invoke("is_hooks_registered");
}
