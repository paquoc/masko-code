import { createStore } from "solid-js/store";
import { createSignal } from "solid-js";

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
    patterns: "ls\npwd\necho\ncat\nhead\ntail\ndate\nwhoami\ngrep\nfind\nwc\nsort\ndiff\nfile\nwhich\ntype",
    risk: "safe",
    autoApprove: false,
  },
  {
    id: crypto.randomUUID(),
    patterns: "git\\s+(status|log|diff|branch|show)\ncd",
    risk: "safe",
    autoApprove: false,
  },
  {
    id: crypto.randomUUID(),
    patterns: "npm\\s+(run|test|start|build)\nyarn\\s+(run|test|start|build)\npnpm\\s+(run|test|start|build)\nnpx",
    risk: "medium",
    autoApprove: false,
  },
  {
    id: crypto.randomUUID(),
    patterns: "git\\s+(push|pull|merge|rebase|reset|checkout)\ncp\nmv\nmkdir\ntouch",
    risk: "medium",
    autoApprove: false,
  },
  {
    id: crypto.randomUUID(),
    patterns: "curl\nwget\nssh",
    risk: "medium",
    autoApprove: false,
  },
  {
    id: crypto.randomUUID(),
    patterns: "rm\nchmod\nchown\nsudo\nsu\neval\nbash\\s+-c",
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

function persist(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
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
