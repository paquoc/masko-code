import { createStore } from "solid-js/store";

export type BubbleStatus = "working" | "done" | "session-start";

export interface WorkingBubbleState {
  visible: boolean;
  toolName: string;
  toolDetail: string;
  projectName: string;
  sessionId: string;
  status: BubbleStatus;
}

export interface BubbleAppearance {
  fontSize: number;        // base font size in px (default 11)
  bgColor: string;         // bubble background
  textColor: string;       // primary text
  mutedColor: string;      // muted/secondary text
  accentColor: string;     // button + status dot color
  buttonTextColor: string; // text on accent-colored buttons
  hoverColor: string;      // mascot hover highlight color
}

export type TokenMetricKey =
  | "read"
  | "write"
  | "total"
  | "input"
  | "output"
  | "cache_read"
  | "cache_creation";

export const ALL_TOKEN_METRICS: TokenMetricKey[] = [
  "read",
  "write",
  "total",
  "input",
  "output",
  "cache_read",
  "cache_creation",
];

export interface TokenPanelSettings {
  enabled: boolean;
  order: TokenMetricKey[];
  visible: Record<TokenMetricKey, boolean>;
  bgColor: string;
  textColor: string;
}

export interface WorkingBubbleSettings {
  showToolBubble: boolean;
  showSessionStart: boolean;
  showSessionEnd: boolean;
  appearance: BubbleAppearance;
  tokenPanel: TokenPanelSettings;
}

const SETTINGS_KEY = "masko_working_bubble_settings";

function loadSettings(): WorkingBubbleSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WorkingBubbleSettings>;
      return {
        ...defaultSettings,
        ...parsed,
        appearance: { ...defaultSettings.appearance, ...(parsed.appearance ?? {}) },
        tokenPanel: mergeTokenPanel(parsed.tokenPanel),
      };
    }
  } catch { /* ignore */ }
  return {
    ...defaultSettings,
    appearance: { ...defaultSettings.appearance },
    tokenPanel: {
      ...defaultTokenPanel,
      order: [...defaultTokenPanel.order],
      visible: { ...defaultTokenPanel.visible },
    },
  };
}

function mergeTokenPanel(stored: Partial<TokenPanelSettings> | undefined): TokenPanelSettings {
  const base: TokenPanelSettings = {
    ...defaultTokenPanel,
    order: [...defaultTokenPanel.order],
    visible: { ...defaultTokenPanel.visible },
  };
  if (!stored) return base;
  if (typeof stored.enabled === "boolean") base.enabled = stored.enabled;
  if (Array.isArray(stored.order)) {
    const seen = new Set<TokenMetricKey>();
    const filtered: TokenMetricKey[] = [];
    for (const k of stored.order) {
      if (ALL_TOKEN_METRICS.includes(k as TokenMetricKey) && !seen.has(k as TokenMetricKey)) {
        filtered.push(k as TokenMetricKey);
        seen.add(k as TokenMetricKey);
      }
    }
    for (const k of ALL_TOKEN_METRICS) {
      if (!seen.has(k)) filtered.push(k);
    }
    base.order = filtered;
  }
  if (stored.visible && typeof stored.visible === "object") {
    for (const k of ALL_TOKEN_METRICS) {
      const v = (stored.visible as Record<string, unknown>)[k];
      if (typeof v === "boolean") base.visible[k] = v;
    }
  }
  if (typeof stored.bgColor === "string") base.bgColor = stored.bgColor;
  if (typeof stored.textColor === "string") base.textColor = stored.textColor;
  return base;
}

const defaultAppearance: BubbleAppearance = {
  fontSize: 11,
  bgColor: "rgba(255,255,255,0.95)",
  textColor: "#23113c",
  mutedColor: "rgba(35,17,60,0.55)",
  accentColor: "#f95d02",
  buttonTextColor: "#ffffff",
  hoverColor: "rgba(255,176,72,0.45)",
};

export const defaultTokenPanel: TokenPanelSettings = {
  enabled: true,
  order: ["read", "write", "total", "input", "output", "cache_read", "cache_creation"],
  visible: {
    read: true,
    write: true,
    total: true,
    input: false,
    output: false,
    cache_read: false,
    cache_creation: false,
  },
  bgColor: "rgba(12,16,12,0.85)",
  textColor: "rgba(74,222,128,1)",
};

const defaultSettings: WorkingBubbleSettings = {
  showToolBubble: true,
  showSessionStart: true,
  showSessionEnd: true,
  appearance: { ...defaultAppearance },
  tokenPanel: {
    ...defaultTokenPanel,
    order: [...defaultTokenPanel.order],
    visible: { ...defaultTokenPanel.visible },
  },
};

const [state, setState] = createStore<WorkingBubbleState>({
  visible: false,
  toolName: "",
  toolDetail: "",
  projectName: "",
  sessionId: "",
  status: "working",
});

const [settings, setSettingsStore] = createStore<WorkingBubbleSettings>(loadSettings());

function updateSettings(patch: Partial<WorkingBubbleSettings>) {
  setSettingsStore(patch);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings }));
}

let autoHideTimer: ReturnType<typeof setTimeout> | undefined;
let minShowUntil = 0; // timestamp — bubble stays visible until at least this time
const MIN_SHOW_MS = 2000;

function show(toolName: string, projectName: string, sessionId: string, toolDetail?: string) {
  if (!settings.showToolBubble) return;
  if (autoHideTimer) clearTimeout(autoHideTimer);
  minShowUntil = Date.now() + MIN_SHOW_MS;
  setState({
    visible: true,
    toolName,
    toolDetail: toolDetail || "",
    projectName,
    sessionId,
    status: "working",
  });
  autoHideTimer = setTimeout(hide, 20000);
}

function showDone(projectName?: string) {
  if (!settings.showSessionEnd) return;
  if (autoHideTimer) clearTimeout(autoHideTimer);
  setState({
    visible: true,
    status: "done",
    toolName: "DONE",
    ...(projectName ? { projectName } : {}),
  });
  autoHideTimer = setTimeout(hide, 10000);
}

function showSessionStart(projectName: string, sessionId: string) {
  if (!settings.showSessionStart) return;
  if (autoHideTimer) clearTimeout(autoHideTimer);
  setState({ visible: true, status: "session-start", toolName: "SESSION START", projectName, sessionId });
  autoHideTimer = setTimeout(hide, 4000);
}

function hide() {
  const remaining = minShowUntil - Date.now();
  if (remaining > 0) {
    // Defer hide until min display time has elapsed
    if (autoHideTimer) clearTimeout(autoHideTimer);
    autoHideTimer = setTimeout(hide, remaining);
    return;
  }
  if (autoHideTimer) { clearTimeout(autoHideTimer); autoHideTimer = undefined; }
  setState("visible", false);
}

export const workingBubbleStore = {
  get state() { return state; },
  get settings() { return settings; },
  updateSettings,
  show,
  showDone,
  showSessionStart,
  hide,
};
