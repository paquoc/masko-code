import { For, Show } from "solid-js";
import { appStore } from "../../stores/app-store";
import type { AppNotification, NotificationPriority } from "../../models/notification";

const PRIORITY_BORDER: Record<NotificationPriority, string> = {
  urgent: "border-l-orange-primary",
  high: "border-l-orange-hover",
  normal: "border-l-blue-400",
  low: "border-l-gray-300",
};

const PRIORITY_DOT: Record<NotificationPriority, string> = {
  urgent: "bg-orange-primary",
  high: "bg-orange-hover",
  normal: "bg-blue-400",
  low: "bg-gray-400",
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function NotificationCenter() {
  const notifications = () => appStore.notifications.notifications;
  const unread = () => appStore.notifications.unreadCount;

  return (
    <div class="space-y-4">
      {/* Header actions */}
      <div class="flex items-center gap-2">
        <Show when={unread() > 0}>
          <span class="text-xs bg-orange-primary text-white px-2 py-0.5 rounded-full">
            {unread()} unread
          </span>
        </Show>
        <div class="ml-auto flex gap-2">
          <Show when={unread() > 0}>
            <button
              class="text-xs text-text-muted hover:text-text-primary transition-colors"
              onClick={() => appStore.notifications.markAllAsRead()}
            >
              Mark all read
            </button>
          </Show>
          <Show when={notifications().length > 0}>
            <button
              class="text-xs text-text-muted hover:text-destructive transition-colors"
              onClick={() => appStore.notifications.clearAll()}
            >
              Clear all
            </button>
          </Show>
        </div>
      </div>

      {/* Notification list */}
      <Show
        when={notifications().length > 0}
        fallback={
          <div class="text-sm text-text-muted bg-surface rounded-[--radius-card] border border-border p-6 text-center">
            No notifications yet. Events from your AI sessions will appear here.
          </div>
        }
      >
        <div class="space-y-2">
          <For each={notifications()}>
            {(notif) => <NotificationItem notif={notif} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

function NotificationItem(props: { notif: AppNotification }) {
  const n = () => props.notif;

  return (
    <div
      class={`bg-surface rounded-[--radius-card-sm] border border-border p-3 border-l-[3px] ${PRIORITY_BORDER[n().priority]} cursor-pointer hover:border-border-hover transition-colors`}
      classList={{ "opacity-60": n().read }}
      onClick={() => {
        if (!n().read) appStore.notifications.markAsRead(n().id);
      }}
    >
      <div class="flex items-start gap-2">
        <Show when={!n().read}>
          <div class={`w-2 h-2 rounded-full mt-1 shrink-0 ${PRIORITY_DOT[n().priority]}`} />
        </Show>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-body font-medium text-sm text-text-primary truncate">
              {n().title}
            </span>
            <span class="ml-auto text-[10px] text-text-muted shrink-0">
              {formatTime(n().createdAt)}
            </span>
          </div>
          <p class="text-xs text-text-muted mt-0.5 line-clamp-2">{n().body}</p>
          <span class="text-[10px] text-text-muted mt-1 inline-block">{n().category}</span>
        </div>
      </div>
    </div>
  );
}
