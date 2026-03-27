import { For, Show } from "solid-js";
import { appStore } from "../../stores/app-store";
import type { AgentSession } from "../../models/session";

const PHASE_LABEL: Record<string, string> = {
  idle: "Idle",
  working: "Working",
  waiting: "Waiting for input",
  compacting: "Compacting context",
};

function phaseColor(session: AgentSession): string {
  if (session.status === "ended") return "bg-gray-400";
  switch (session.phase) {
    case "working": return "bg-green-500";
    case "waiting": return "bg-yellow-500";
    case "compacting": return "bg-blue-400";
    default: return "bg-gray-400";
  }
}

function timeAgo(date?: Date): string {
  if (!date) return "";
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

export default function SessionList() {
  const active = () => appStore.sessions.sessions.filter((s) => s.status === "active");
  const ended = () => appStore.sessions.sessions.filter((s) => s.status === "ended");

  return (
    <div class="space-y-6">
      {/* Active sessions */}
      <section>
        <h3 class="font-heading font-semibold text-sm text-text-muted uppercase tracking-wide mb-3">
          Active
          <Show when={active().length > 0}>
            <span class="ml-2 text-xs bg-orange-primary text-white px-1.5 py-0.5 rounded-full normal-case tracking-normal">
              {active().length}
            </span>
          </Show>
        </h3>
        <Show
          when={active().length > 0}
          fallback={
            <div class="text-sm text-text-muted bg-surface rounded-[--radius-card] border border-border p-4">
              No active sessions. Start Claude Code or Codex to see sessions here.
            </div>
          }
        >
          <div class="space-y-2">
            <For each={active()}>
              {(session) => <SessionCard session={session} />}
            </For>
          </div>
        </Show>
      </section>

      {/* Ended sessions */}
      <Show when={ended().length > 0}>
        <section>
          <h3 class="font-heading font-semibold text-sm text-text-muted uppercase tracking-wide mb-3">
            Recent
          </h3>
          <div class="space-y-2">
            <For each={ended().slice(0, 10)}>
              {(session) => <SessionCard session={session} />}
            </For>
          </div>
        </section>
      </Show>
    </div>
  );
}

function SessionCard(props: { session: AgentSession }) {
  const s = () => props.session;

  return (
    <div class="bg-surface rounded-[--radius-card] border border-border p-3 hover:border-border-hover transition-colors">
      <div class="flex items-center gap-2">
        {/* Status dot */}
        <div class={`w-2.5 h-2.5 rounded-full shrink-0 ${phaseColor(s())}`} />

        {/* Project name */}
        <span class="font-body font-medium text-sm text-text-primary truncate">
          {s().projectName || "Unknown project"}
        </span>

        {/* Source badge */}
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-orange-subtle text-orange-primary font-medium shrink-0">
          {s().agentSource === "claudeCode" ? "Claude" : "Codex"}
        </span>

        {/* Last activity */}
        <span class="ml-auto text-xs text-text-muted shrink-0">
          {timeAgo(s().lastEventAt)}
        </span>
      </div>

      {/* Details row */}
      <div class="mt-1.5 flex items-center gap-3 text-xs text-text-muted pl-[18px]">
        <span>{PHASE_LABEL[s().phase] || s().phase}</span>
        <span>{s().eventCount} events</span>
        <Show when={s().activeSubagentCount > 0}>
          <span>{s().activeSubagentCount} subagent{s().activeSubagentCount > 1 ? "s" : ""}</span>
        </Show>
        <Show when={s().lastToolName}>
          <span class="truncate max-w-[120px]">{s().lastToolName}</span>
        </Show>
      </div>
    </div>
  );
}
