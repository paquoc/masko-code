import { For, Show } from "solid-js";
import { appStore } from "../../stores/app-store";
import { HOOK_EVENT_DISPLAY, HOOK_EVENT_COLOR, type AgentEvent, getProjectName } from "../../models/agent-event";

const COLOR_MAP: Record<string, string> = {
  green: "bg-green-500",
  red: "bg-red-500",
  orange: "bg-orange-primary",
  blue: "bg-blue-400",
  purple: "bg-purple-500",
  secondary: "bg-gray-400",
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function ActivityFeed() {
  const events = () => [...appStore.events.events].reverse().slice(0, 50);

  return (
    <div class="space-y-4">
      <Show
        when={events().length > 0}
        fallback={
          <div class="text-sm text-text-muted bg-surface rounded-[--radius-card] border border-border p-6 text-center">
            No activity yet. Events will appear here as your AI sessions run.
          </div>
        }
      >
        <div class="space-y-1">
          <For each={events()}>
            {(event) => <ActivityItem event={event} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

function ActivityItem(props: { event: AgentEvent }) {
  const e = () => props.event;
  const label = () => HOOK_EVENT_DISPLAY[e().hook_event_name as keyof typeof HOOK_EVENT_DISPLAY] || e().hook_event_name;
  const color = () => COLOR_MAP[HOOK_EVENT_COLOR[e().hook_event_name as keyof typeof HOOK_EVENT_COLOR] || "secondary"] || "bg-gray-400";
  const project = () => getProjectName(e());

  return (
    <div class="flex items-center gap-2 py-1.5 px-3 rounded-[--radius-card-sm] hover:bg-orange-subtle transition-colors">
      <div class={`w-2 h-2 rounded-full shrink-0 ${color()}`} />
      <span class="text-sm font-body text-text-primary">{label()}</span>
      <Show when={e().tool_name}>
        <span class="text-xs text-text-muted font-mono">{e().tool_name}</span>
      </Show>
      <Show when={project()}>
        <span class="text-[10px] text-text-muted">{project()}</span>
      </Show>
      <span class="ml-auto text-[10px] text-text-muted shrink-0">
        {formatTime(e().received_at)}
      </span>
    </div>
  );
}
