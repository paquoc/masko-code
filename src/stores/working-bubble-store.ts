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

export interface WorkingBubbleSettings {
  showToolBubble: boolean;
  showSessionStart: boolean;
  showSessionEnd: boolean;
  appearance: BubbleAppearance;
}

const SETTINGS_KEY = "masko_working_bubble_settings";

function loadSettings(): WorkingBubbleSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...defaultSettings };
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

const defaultSettings: WorkingBubbleSettings = {
  showToolBubble: true,
  showSessionStart: true,
  showSessionEnd: true,
  appearance: { ...defaultAppearance },
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
