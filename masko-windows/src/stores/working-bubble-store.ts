import { createStore } from "solid-js/store";

export type BubbleStatus = "working" | "done" | "session-start";

export interface WorkingBubbleState {
  visible: boolean;
  toolName: string;
  projectName: string;
  sessionId: string;
  terminalPid?: number;
  status: BubbleStatus;
}

const [state, setState] = createStore<WorkingBubbleState>({
  visible: false,
  toolName: "",
  projectName: "",
  sessionId: "",
  terminalPid: undefined,
  status: "working",
});

let autoHideTimer: ReturnType<typeof setTimeout> | undefined;

function show(toolName: string, projectName: string, sessionId: string, terminalPid?: number) {
  if (autoHideTimer) clearTimeout(autoHideTimer);
  setState({
    visible: true,
    toolName,
    projectName,
    sessionId,
    terminalPid,
    status: "working",
  });
  autoHideTimer = setTimeout(hide, 20000);
}

function showDone() {
  if (autoHideTimer) clearTimeout(autoHideTimer);
  setState({ visible: true, status: "done", toolName: "DONE" });
  autoHideTimer = setTimeout(hide, 10000);
}

function showSessionStart(projectName: string, sessionId: string, terminalPid?: number) {
  if (autoHideTimer) clearTimeout(autoHideTimer);
  setState({ visible: true, status: "session-start", toolName: "SESSION START", projectName, sessionId, terminalPid });
  autoHideTimer = setTimeout(hide, 4000);
}

function hide() {
  if (autoHideTimer) { clearTimeout(autoHideTimer); autoHideTimer = undefined; }
  setState("visible", false);
}

export const workingBubbleStore = {
  get state() { return state; },
  show,
  showDone,
  showSessionStart,
  hide,
};
