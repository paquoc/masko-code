import { createStore } from "solid-js/store";
import { createSignal } from "solid-js";
import type { SavedMascot, MaskoAnimationConfig } from "../models/mascot-config";
import { parseMascotConfig } from "../models/mascot-config";

const STORAGE_KEY = "masko_saved_mascots";
const ACTIVE_KEY = "masko_active_mascot";

// Load saved mascots from localStorage
function loadSavedMascots(): SavedMascot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistMascots(mascots: SavedMascot[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(mascots));
}

const [mascots, setMascots] = createStore<SavedMascot[]>(loadSavedMascots());
const [activeMascotId, setActiveMascotId] = createSignal<string | null>(
  localStorage.getItem(ACTIVE_KEY),
);

/** Load bundled mascot configs from assets */
export async function loadBundledMascots(): Promise<void> {
  if (mascots.length > 0) return; // Already loaded

  const slugs = ["clippy", "masko", "otto", "nugget", "rusty", "cupidon", "madame-patate"];
  const loaded: SavedMascot[] = [];

  for (const slug of slugs) {
    try {
      const resp = await fetch(`/src/assets/mascots/${slug}.json`);
      if (!resp.ok) continue;
      const raw = await resp.json();
      const config = parseMascotConfig(raw);
      loaded.push({
        id: crypto.randomUUID(),
        name: config.name,
        config,
        templateSlug: slug,
        addedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn(`[masko] Failed to load bundled mascot ${slug}:`, e);
    }
  }

  if (loaded.length > 0) {
    setMascots(loaded);
    persistMascots(loaded);
  }
}

export function addMascot(config: MaskoAnimationConfig, slug?: string): void {
  const mascot: SavedMascot = {
    id: crypto.randomUUID(),
    name: config.name,
    config,
    templateSlug: slug,
    addedAt: new Date().toISOString(),
  };
  setMascots((prev) => {
    const next = [...prev, mascot];
    persistMascots(next);
    return next;
  });
}

export function removeMascot(id: string): void {
  setMascots((prev) => {
    const next = prev.filter((m) => m.id !== id);
    persistMascots(next);
    return next;
  });
  if (activeMascotId() === id) {
    setActiveMascotId(null);
    localStorage.removeItem(ACTIVE_KEY);
  }
}

export function setActiveMascot(id: string | null): void {
  setActiveMascotId(id);
  if (id) {
    localStorage.setItem(ACTIVE_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

export function getActiveMascotConfig(): MaskoAnimationConfig | null {
  const id = activeMascotId();
  if (!id) return null;
  return mascots.find((m) => m.id === id)?.config ?? null;
}

export const mascotStore = {
  get mascots() { return mascots; },
  get activeMascotId() { return activeMascotId(); },
  get activeConfig() { return getActiveMascotConfig(); },
  loadBundledMascots,
  addMascot,
  removeMascot,
  setActiveMascot,
};
