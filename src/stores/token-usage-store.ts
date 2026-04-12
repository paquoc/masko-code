// src/stores/token-usage-store.ts

import { createStore, produce } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { error, log } from "../services/log";
import type { TokenMetricKey } from "./working-bubble-store";

export interface RawUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface SessionTokenUsage extends RawUsage {
  sessionId: string;
  projectName: string;
}

interface TokenUsageStoreState {
  bySession: Record<string, SessionTokenUsage>;
  pathCache: Record<string, string>;
}

const [state, setState] = createStore<TokenUsageStoreState>({
  bySession: {},
  pathCache: {},
});

// ISO 8601 timestamp recorded when the overlay window first mounts.
// Only tokens from lines with timestamp >= this value are counted.
let mascotOpenTime: string | undefined;

function setMascotOpenTime(t: string): void {
  mascotOpenTime = t;
}

interface RustRawUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

/** Cache transcript path without reading JSONL (used when panel is hidden) */
function cachePath(sessionId: string, transcriptPath?: string, projectName?: string): void {
  if (!sessionId || !transcriptPath) return;
  setState("pathCache", sessionId, transcriptPath);
  if (projectName) {
    const prev = state.bySession[sessionId];
    if (!prev || prev.projectName !== projectName) {
      setState("bySession", sessionId, {
        sessionId,
        projectName,
        input: prev?.input ?? 0,
        output: prev?.output ?? 0,
        cacheRead: prev?.cacheRead ?? 0,
        cacheCreation: prev?.cacheCreation ?? 0,
      });
    }
  }
}

/** Refresh all cached sessions (used when panel is re-enabled) */
async function refreshAllCached(): Promise<void> {
  const entries = Object.entries(state.pathCache);
  await Promise.all(entries.map(([sid, path]) => refreshSession(sid, path)));
}

async function refreshSession(
  sessionId: string,
  transcriptPath?: string,
  projectName?: string,
): Promise<void> {
  if (!sessionId) return;
  const path = transcriptPath || state.pathCache[sessionId];
  if (!path) return;

  if (transcriptPath) {
    setState("pathCache", sessionId, transcriptPath);
  }

  try {
    const raw = await invoke<RustRawUsage>("get_session_token_usage", {
      sessionId,
      transcriptPath: path,
      sinceRfc3339: mascotOpenTime ?? null,
    });

    const prev = state.bySession[sessionId];
    setState("bySession", sessionId, {
      sessionId,
      projectName: projectName ?? prev?.projectName ?? "",
      input: raw.input ?? 0,
      output: raw.output ?? 0,
      cacheRead: raw.cacheRead ?? 0,
      cacheCreation: raw.cacheCreation ?? 0,
    });
  } catch (e) {
    error("tokenUsageStore.refreshSession failed:", e);
  }
}

async function removeSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  try {
    await invoke("reset_session_token_usage", { sessionId });
  } catch (e) {
    log("tokenUsageStore.removeSession invoke failed (ignored):", e);
  }
  setState(
    "bySession",
    produce((bs) => {
      delete bs[sessionId];
    }),
  );
  setState(
    "pathCache",
    produce((pc) => {
      delete pc[sessionId];
    }),
  );
}

function aggregate(): RawUsage {
  const totals: RawUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  for (const s of Object.values(state.bySession)) {
    totals.input += s.input;
    totals.output += s.output;
    totals.cacheRead += s.cacheRead;
    totals.cacheCreation += s.cacheCreation;
  }
  return totals;
}

function computed(metric: TokenMetricKey): number {
  const t = aggregate();
  switch (metric) {
    case "read": return t.input + t.cacheRead;
    case "write": return t.output + t.cacheCreation;
    case "total": return t.input + t.output + t.cacheRead + t.cacheCreation;
    case "input": return t.input;
    case "output": return t.output;
    case "cache_read": return t.cacheRead;
    case "cache_creation": return t.cacheCreation;
  }
}

function sessions(): SessionTokenUsage[] {
  // Group by projectName — merge all sessions from the same project into one row
  const byProject = new Map<string, SessionTokenUsage>();
  for (const s of Object.values(state.bySession)) {
    if (s.input + s.output + s.cacheRead + s.cacheCreation === 0) continue;
    const key = s.projectName || s.sessionId;
    const existing = byProject.get(key);
    if (existing) {
      byProject.set(key, {
        ...existing,
        input: existing.input + s.input,
        output: existing.output + s.output,
        cacheRead: existing.cacheRead + s.cacheRead,
        cacheCreation: existing.cacheCreation + s.cacheCreation,
      });
    } else {
      byProject.set(key, { ...s });
    }
  }
  return Array.from(byProject.values()).sort((a, b) =>
    (a.projectName || a.sessionId).localeCompare(b.projectName || b.sessionId),
  );
}

async function resetToNow(): Promise<void> {
  mascotOpenTime = new Date().toISOString();
  // Zero out frontend state immediately so the panel shows 0 right away
  setState("bySession", produce((bs) => {
    for (const key of Object.keys(bs)) {
      bs[key] = { ...bs[key], input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    }
  }));
  // Clear the Rust-side cache for each session so the new since-cutoff is respected
  // (Rust only applies the `since` filter when first creating the entry)
  const entries = Object.entries(state.pathCache);
  await Promise.all(
    entries.map(async ([sessionId, transcriptPath]) => {
      try { await invoke("reset_session_token_usage", { sessionId }); } catch { /* ignore */ }
      await refreshSession(sessionId, transcriptPath);
    }),
  );
}

function hasAnyUsage(): boolean {
  for (const s of Object.values(state.bySession)) {
    if (s.input + s.output + s.cacheRead + s.cacheCreation > 0) return true;
  }
  return false;
}

export const tokenUsageStore = {
  get bySession() { return state.bySession; },
  setMascotOpenTime,
  cachePath,
  refreshSession,
  refreshAllCached,
  removeSession,
  resetToNow,
  aggregate,
  computed,
  sessions,
  hasAnyUsage,
};
