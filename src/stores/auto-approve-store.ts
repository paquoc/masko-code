import { createStore } from "solid-js/store";
import { createSignal } from "solid-js";
import { emit, listen } from "@tauri-apps/api/event";

export type RiskLevel = "safe" | "medium" | "high";

export interface AutoApproveRule {
  id: string;
  /** One pattern per line (plain text or regex) */
  patterns: string;
  risk: RiskLevel;
  autoApprove: boolean;
}

export interface AutoApproveSettings {
  rules: AutoApproveRule[];
  /** Countdown duration in seconds */
  countdownSeconds: number;
}

const STORAGE_KEY = "masko_auto_approve_settings";

const defaultRules: AutoApproveRule[] = [
  {
    id: crypto.randomUUID(),
    patterns: "ls, pwd, echo, cat, head, tail, date, whoami, grep, find, wc, sort, diff, file, which, type",
    risk: "safe",
    autoApprove: false,
  },
  {
    id: crypto.randomUUID(),
    patterns: "git\\s+(status|log|diff|branch|show), cd",
    risk: "safe",
    autoApprove: false,
  },
  {
    id: crypto.randomUUID(),
    patterns: "npm\\s+(run|test|start|build), yarn\\s+(run|test|start|build), pnpm\\s+(run|test|start|build), npx",
    risk: "medium",
    autoApprove: false,
  },
  {
    id: crypto.randomUUID(),
    patterns: "git\\s+(push|pull|merge|rebase|reset|checkout), cp, mv, mkdir, touch",
    risk: "medium",
    autoApprove: false,
  },
  {
    id: crypto.randomUUID(),
    patterns: "curl, wget, ssh",
    risk: "medium",
    autoApprove: false,
  },
  {
    id: crypto.randomUUID(),
    patterns: "rm, chmod, chown, sudo, su, eval, bash\\s+-c",
    risk: "high",
    autoApprove: false,
  },
];

function loadSettings(): AutoApproveSettings {
  const defaults: AutoApproveSettings = {
    rules: defaultRules,
    countdownSeconds: 5,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed };
    }
  } catch { /* ignore */ }
  return defaults;
}

const [settings, setSettings] = createStore<AutoApproveSettings>(loadSettings());
/** Set of session IDs that have session-wide auto-approve enabled */
const [sessionAutoApproveSessions, setSessionAutoApproveSessions] = createSignal<Set<string>>(new Set());

const SYNC_EVENT = "auto-approve-settings-changed";
let isApplyingRemote = false;

// Listen for updates from other windows
listen<AutoApproveSettings>(SYNC_EVENT, (e) => {
  isApplyingRemote = true;
  setSettings(e.payload);
  isApplyingRemote = false;
}).catch(() => {});

function persist(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  if (!isApplyingRemote) {
    emit(SYNC_EVENT, { ...settings, rules: [...settings.rules] }).catch(() => {});
  }
}

function addRule(): void {
  setSettings("rules", (rules) => [
    ...rules,
    {
      id: crypto.randomUUID(),
      patterns: "",
      risk: "medium" as RiskLevel,
      autoApprove: false,
    },
  ]);
  persist();
}

function updateRule(id: string, updates: Partial<Omit<AutoApproveRule, "id">>): void {
  const idx = settings.rules.findIndex((r) => r.id === id);
  if (idx === -1) return;
  setSettings("rules", idx, (rule) => ({ ...rule, ...updates }));
  persist();
}

function removeRule(id: string): void {
  setSettings("rules", (rules) => rules.filter((r) => r.id !== id));
  persist();
}

function setCountdown(seconds: number): void {
  setSettings("countdownSeconds", seconds);
  persist();
}

function isSessionAutoApprove(sessionId: string | undefined): boolean {
  if (!sessionId) return false;
  return sessionAutoApproveSessions().has(sessionId);
}

function toggleSessionAutoApprove(sessionId: string | undefined): void {
  if (!sessionId) return;
  setSessionAutoApproveSessions((prev) => {
    const next = new Set(prev);
    if (next.has(sessionId)) next.delete(sessionId);
    else next.add(sessionId);
    return next;
  });
}

export const autoApproveStore = {
  get settings() { return settings; },
  isSessionAutoApprove,
  toggleSessionAutoApprove,
  addRule,
  updateRule,
  removeRule,
  setCountdown,
};
