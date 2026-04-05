import { createSignal } from "solid-js";
import { ActiveCard } from "../models/types";
import { sessionStore } from "./session-store";
import { eventStore } from "./event-store";
import { notificationStore } from "./notification-store";
import { permissionStore } from "./permission-store";
import { mascotStore } from "./mascot-store";
import { startEventListeners } from "../services/ipc";
import { log } from "../services/log";

const [isRunning, setIsRunning] = createSignal(false);
const [isReady, setIsReady] = createSignal(false);
const [activeCard, setActiveCard] = createSignal(ActiveCard.None);
const [hasCompletedOnboarding, setHasCompletedOnboarding] = createSignal(
  localStorage.getItem("hasCompletedOnboarding") === "true",
);

/** Recompute which overlay card has priority */
function syncActiveCard(): void {
  if (activeCard() === ActiveCard.ExpandedPermission) return; // Don't overwrite

  if (permissionStore.pending.length > 0) {
    setActiveCard(ActiveCard.Permission);
  } else {
    setActiveCard(ActiveCard.None);
  }
}

/** Initialize the app — start event listeners, load mascots */
async function start(): Promise<void> {
  if (isRunning()) return;
  setIsRunning(true);

  // Load bundled mascots
  await mascotStore.loadBundledMascots();

  // Start listening for Rust events
  await startEventListeners();

  // Auto-activate first mascot if none active
  if (!mascotStore.activeMascotId && mascotStore.mascots.length > 0) {
    const clippy = mascotStore.mascots.find((m) => m.templateSlug === "clippy");
    mascotStore.setActiveMascot((clippy || mascotStore.mascots[0]).id);
  }

  setIsReady(true);
  log("App store started");
}

function completeOnboarding(): void {
  setHasCompletedOnboarding(true);
  localStorage.setItem("hasCompletedOnboarding", "true");
}

export const appStore = {
  // State
  get isRunning() { return isRunning(); },
  get isReady() { return isReady(); },
  get activeCard() { return activeCard(); },
  get hasCompletedOnboarding() { return hasCompletedOnboarding(); },
  get hasUnreadNotifications() { return notificationStore.unreadCount > 0; },

  // Sub-stores
  sessions: sessionStore,
  events: eventStore,
  notifications: notificationStore,
  permissions: permissionStore,
  mascots: mascotStore,

  // Actions
  start,
  syncActiveCard,
  setActiveCard,
  completeOnboarding,
};
