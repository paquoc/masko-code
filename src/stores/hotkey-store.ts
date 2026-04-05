import { createSignal } from "solid-js";
import { log } from "../services/log";

const STORAGE_KEY = "masko_hotkeys";

export interface HotkeyBinding {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  key: string; // lowercase key name, e.g. "a", "enter", "f1"
}

export interface HotkeySettings {
  approve: HotkeyBinding;
  deny: HotkeyBinding;
}

const defaultSettings: HotkeySettings = {
  approve: { ctrlKey: true, shiftKey: true, altKey: true, metaKey: false, key: "a" },
  deny: { ctrlKey: true, shiftKey: true, altKey: true, metaKey: false, key: "d" },
};

function load(): HotkeySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...defaultSettings };
}

function save(settings: HotkeySettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

const [settings, _setSettings] = createSignal<HotkeySettings>(load());

/** Convert a KeyboardEvent to a HotkeyBinding */
export function eventToBinding(e: KeyboardEvent): HotkeyBinding | null {
  const key = e.key.toLowerCase();
  // Ignore lone modifier presses
  if (["control", "shift", "alt", "meta"].includes(key)) return null;
  return {
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    key,
  };
}

/** Check if a KeyboardEvent matches a binding */
export function matchesBinding(e: KeyboardEvent, binding: HotkeyBinding): boolean {
  return (
    e.ctrlKey === binding.ctrlKey &&
    e.shiftKey === binding.shiftKey &&
    e.altKey === binding.altKey &&
    e.metaKey === binding.metaKey &&
    e.key.toLowerCase() === binding.key
  );
}

/** Convert binding to Tauri global shortcut string */
export function bindingToTauriAccelerator(b: HotkeyBinding): string {
  const parts: string[] = [];
  if (b.ctrlKey) parts.push("CommandOrControl");
  if (b.shiftKey) parts.push("Shift");
  if (b.altKey) parts.push("Alt");
  if (b.metaKey) parts.push("Super");
  // Map key names to Tauri accelerator format
  const keyMap: Record<string, string> = {
    enter: "Enter", backspace: "Backspace", delete: "Delete",
    escape: "Escape", tab: "Tab", " ": "Space",
    arrowup: "Up", arrowdown: "Down", arrowleft: "Left", arrowright: "Right",
  };
  parts.push(keyMap[b.key] || b.key.toUpperCase());
  return parts.join("+");
}

/** Format binding for display */
export function bindingToLabel(b: HotkeyBinding): string {
  const parts: string[] = [];
  if (b.ctrlKey) parts.push("Ctrl");
  if (b.shiftKey) parts.push("Shift");
  if (b.altKey) parts.push("Alt");
  if (b.metaKey) parts.push("Win");
  const keyLabels: Record<string, string> = {
    " ": "Space", enter: "Enter", backspace: "Backspace", delete: "Delete",
    escape: "Esc", tab: "Tab",
    arrowup: "\u2191", arrowdown: "\u2193", arrowleft: "\u2190", arrowright: "\u2192",
  };
  parts.push(keyLabels[b.key] || b.key.toUpperCase());
  return parts.join(" + ");
}

function setHotkey(action: keyof HotkeySettings, binding: HotkeyBinding): void {
  const next = { ...settings(), [action]: binding };
  _setSettings(next);
  save(next);
  log(`[hotkey-store] Updated ${action}:`, bindingToLabel(binding));
}

export const hotkeyStore = {
  get settings() { return settings(); },
  setHotkey,
  bindingToLabel,
  bindingToTauriAccelerator,
  matchesBinding,
  eventToBinding,
};
