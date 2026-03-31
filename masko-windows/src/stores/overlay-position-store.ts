import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

const STORAGE_KEY = "mascot_position";
const SIZE_KEY = "mascot_size";
const OPACITY_KEY = "mascot_opacity";
const DEFAULT_MASCOT_SIZE = 200;
const SYNC_THROTTLE_MS = 16; // ~60fps

interface SavedPosition {
  screenX: number;
  screenY: number;
}

// Mascot position in CSS logical pixels (relative to overlay window)
const [x, setX] = createSignal(0);
const [y, setY] = createSignal(0);

// Current monitor bounds (screen coordinates, physical)
const [monitorX, setMonitorX] = createSignal(0);
const [monitorY, setMonitorY] = createSignal(0);
const [monitorW, setMonitorW] = createSignal(1920);
const [monitorH, setMonitorH] = createSignal(1080);

// Mascot size (px) and opacity — persisted to localStorage
const savedSize = parseInt(localStorage.getItem(SIZE_KEY) || "", 10);
const savedOpacity = parseFloat(localStorage.getItem(OPACITY_KEY) || "");
const [mascotSize, setMascotSizeSignal] = createSignal(
  isNaN(savedSize) ? DEFAULT_MASCOT_SIZE : Math.max(80, Math.min(400, savedSize)),
);
const [mascotOpacity, setMascotOpacitySignal] = createSignal(
  isNaN(savedOpacity) ? 1 : Math.max(0.1, Math.min(1, savedOpacity)),
);

let lastSyncTime = 0;
let syncTimer: ReturnType<typeof setTimeout> | undefined;

function syncToRust(px: number, py: number, size?: number) {
  const s = size ?? mascotSize();
  const now = Date.now();
  if (now - lastSyncTime >= SYNC_THROTTLE_MS) {
    lastSyncTime = now;
    invoke("update_mascot_position", { x: px, y: py, w: s, h: s }).catch(() => {});
  } else if (!syncTimer) {
    syncTimer = setTimeout(() => {
      syncTimer = undefined;
      lastSyncTime = Date.now();
      invoke("update_mascot_position", { x: x(), y: y(), w: mascotSize(), h: mascotSize() }).catch(() => {});
    }, SYNC_THROTTLE_MS);
  }
}

function updatePosition(newX: number, newY: number) {
  // Clamp to window bounds
  const size = mascotSize();
  const maxX = window.innerWidth - size;
  const maxY = window.innerHeight - size;
  const cx = Math.max(0, Math.min(newX, maxX));
  const cy = Math.max(0, Math.min(newY, maxY));
  setX(cx);
  setY(cy);
  syncToRust(cx, cy);
}

function setMascotSize(size: number) {
  const clamped = Math.max(80, Math.min(400, Math.round(size)));
  setMascotSizeSignal(clamped);
  localStorage.setItem(SIZE_KEY, String(clamped));
  // Re-clamp position with new size and sync
  updatePosition(x(), y());
}

function setMascotOpacity(opacity: number) {
  const clamped = Math.max(0.1, Math.min(1, opacity));
  setMascotOpacitySignal(clamped);
  localStorage.setItem(OPACITY_KEY, String(clamped));
}

function persistPosition() {
  const saved: SavedPosition = {
    screenX: monitorX() + x(),
    screenY: monitorY() + y(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

async function restorePosition() {
  const raw = localStorage.getItem(STORAGE_KEY);
  let savedScreenX = 0;
  let savedScreenY = 0;
  let hasSaved = false;

  if (raw) {
    try {
      const saved: SavedPosition = JSON.parse(raw);
      savedScreenX = saved.screenX;
      savedScreenY = saved.screenY;
      hasSaved = true;
    } catch { /* fall through to default */ }
  }

  // Query monitor at saved position (or primary if no saved position)
  try {
    const queryX = hasSaved ? savedScreenX : 0;
    const queryY = hasSaved ? savedScreenY : 0;
    const bounds = await invoke<[number, number, number, number]>("get_monitor_at_point", { x: queryX, y: queryY });
    setMonitorX(bounds[0]);
    setMonitorY(bounds[1]);
    setMonitorW(bounds[2]);
    setMonitorH(bounds[3]);

    // Move overlay to the correct monitor if saved position is on a different one
    if (hasSaved) {
      await invoke("move_overlay_to_monitor", { x: savedScreenX, y: savedScreenY });
    }
  } catch { /* use defaults */ }

  if (hasSaved) {
    // Convert screen coords to window-relative
    updatePosition(savedScreenX - monitorX(), savedScreenY - monitorY());
  } else {
    // Default: bottom-center
    const size = mascotSize();
    const defaultX = (window.innerWidth - size) / 2;
    const defaultY = window.innerHeight - size;
    updatePosition(defaultX, defaultY);
  }
}

function setMonitorBounds(mx: number, my: number, mw: number, mh: number) {
  setMonitorX(mx);
  setMonitorY(my);
  setMonitorW(mw);
  setMonitorH(mh);
}

/** Screen coordinates of mascot center (for monitor detection) */
function screenCenter(): { x: number; y: number } {
  const size = mascotSize();
  return {
    x: monitorX() + x() + size / 2,
    y: monitorY() + y() + size / 2,
  };
}

export const overlayPositionStore = {
  get x() { return x(); },
  get y() { return y(); },
  get monitorX() { return monitorX(); },
  get monitorY() { return monitorY(); },
  get monitorW() { return monitorW(); },
  get monitorH() { return monitorH(); },
  get mascotSize() { return mascotSize(); },
  get mascotOpacity() { return mascotOpacity(); },
  /** @deprecated use mascotSize getter — kept for compatibility */
  MASCOT_SIZE: DEFAULT_MASCOT_SIZE,
  updatePosition,
  persistPosition,
  restorePosition,
  setMonitorBounds,
  screenCenter,
  setMascotSize,
  setMascotOpacity,
};
