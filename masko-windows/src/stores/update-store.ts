import { createSignal } from "solid-js";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { log, error } from "../services/log";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "error";

const [status, setStatus] = createSignal<UpdateStatus>("idle");
const [version, setVersion] = createSignal("");
const [progress, setProgress] = createSignal(0);
const [errorMsg, setErrorMsg] = createSignal("");

let cachedUpdate: Update | null = null;

async function checkForUpdates(): Promise<void> {
  setStatus("checking");
  setErrorMsg("");
  try {
    const update = await check();
    if (update) {
      cachedUpdate = update;
      setVersion(update.version);
      setStatus("available");
      log(`[update-store] Update available: v${update.version}`);
    } else {
      cachedUpdate = null;
      setStatus("idle");
    }
  } catch (e) {
    error("[update-store] Check failed:", e);
    setErrorMsg(String(e));
    setStatus("error");
  }
}

async function downloadAndInstall(): Promise<void> {
  setStatus("downloading");
  setProgress(0);
  try {
    // Re-check if we lost the cached update reference
    const update = cachedUpdate ?? await check();
    if (!update) return;
    let totalLength = 0;
    let downloaded = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started" && event.data.contentLength) {
        totalLength = event.data.contentLength;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        if (totalLength > 0) {
          setProgress(Math.round((downloaded / totalLength) * 100));
        }
      }
    });
    await relaunch();
  } catch (e) {
    error("[update-store] Install failed:", e);
    setErrorMsg(String(e));
    setStatus("error");
  }
}

export const updateStore = {
  get status() { return status(); },
  get version() { return version(); },
  get progress() { return progress(); },
  get error() { return errorMsg(); },
  get hasUpdate() { return status() === "available"; },
  checkForUpdates,
  downloadAndInstall,
};
