import { createStore } from "solid-js/store";
import { createSignal } from "solid-js";
import type { AppNotification } from "../models/notification";

const MAX_NOTIFICATIONS = 100;

const [notifications, setNotifications] = createStore<AppNotification[]>([]);

export function appendNotification(notif: AppNotification): void {
  setNotifications((prev) => {
    const next = [notif, ...prev];
    return next.length > MAX_NOTIFICATIONS ? next.slice(0, MAX_NOTIFICATIONS) : next;
  });
}

export function markAsRead(id: string): void {
  const idx = notifications.findIndex((n) => n.id === id);
  if (idx !== -1) {
    setNotifications(idx, "read", true);
  }
}

export function markAllAsRead(): void {
  setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
}

export function clearAll(): void {
  setNotifications([]);
}

export function getUnreadCount(): number {
  return notifications.filter((n) => !n.read).length;
}

export const notificationStore = {
  get notifications() { return notifications; },
  get unreadCount() { return getUnreadCount(); },
  appendNotification,
  markAsRead,
  markAllAsRead,
  clearAll,
};
