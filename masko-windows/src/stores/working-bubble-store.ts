import { createStore } from "solid-js/store";

export type BubbleStatus = "working" | "done" | "session-start";

export interface WorkingBubbleState {
  visible: boolean;
  toolName: string;
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

function show(toolName: string, projectName: string, sessionId: string) {
  if (!settings.showToolBubble) return;
  if (autoHideTimer) clearTimeout(autoHideTimer);
  setState({
    visible: true,
    toolName,
    projectName,
    sessionId,
    status: "working",
  });
  autoHideTimer = setTimeout(hide, 20000);
}

function showDone() {
  if (!settings.showSessionEnd) return;
  if (autoHideTimer) clearTimeout(autoHideTimer);
  setState({
    visible: true,
    status: "done",
    toolName: "DONE",
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
