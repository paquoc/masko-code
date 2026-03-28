import { createStore } from "solid-js/store";

export interface WorkingBubbleState {
  visible: boolean;
  toolName: string;
  projectName: string;
  sessionId: string;
  terminalPid?: number;
  done: boolean;
}

const [state, setState] = createStore<WorkingBubbleState>({
  visible: false,
  toolName: "",
  projectName: "",
  sessionId: "",
  terminalPid: undefined,
  done: false,
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
    done: false,
  });
  autoHideTimer = setTimeout(hide, 3000);
}

function showDone() {
  if (autoHideTimer) clearTimeout(autoHideTimer);
  setState({ visible: true, done: true, toolName: "DONE" });
  autoHideTimer = setTimeout(hide, 5000);
}

function hide() {
  if (autoHideTimer) { clearTimeout(autoHideTimer); autoHideTimer = undefined; }
  setState("visible", false);
}

export const workingBubbleStore = {
  get state() { return state; },
  show,
  showDone,
  hide,
};
