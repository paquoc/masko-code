import { For, Show, createSignal } from "solid-js";
import { emit } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { appStore } from "../../stores/app-store";
import { parseMascotConfig } from "../../models/mascot-config";
import type { SavedMascot } from "../../models/mascot-config";

/** Get the first node's thumbnail URL from a mascot config */
function getThumbnail(mascot: SavedMascot): string | undefined {
  const nodes = mascot.config?.nodes;
  if (!nodes || nodes.length === 0) return undefined;
  // Prefer the initial node, fallback to first node
  const initialId = mascot.config.initialNode;
  const node = nodes.find((n) => n.id === initialId) || nodes[0];
  return node.transparentThumbnailUrl;
}

const DEBUG_STATES = [
  { id: "idle", label: "Idle", icon: "💤" },
  { id: "working", label: "Working", icon: "⚡" },
  { id: "attention", label: "Need Attention", icon: "🔔" },
  { id: "thinking", label: "Thinking", icon: "💭" },
] as const;

export default function MascotGallery() {
  const mascots = () => appStore.mascots.mascots;
  const activeId = () => appStore.mascots.activeMascotId;
  const [showAddModal, setShowAddModal] = createSignal(false);
  const [activeDebugState, setActiveDebugState] = createSignal<string | null>(null);
  const [removingMascot, setRemovingMascot] = createSignal<SavedMascot | null>(null);

  function setDebugState(stateId: string) {
    setActiveDebugState(stateId);
    emit("debug-set-state", stateId).catch(() => { });
  }

  return (
    <div class="space-y-4">
      <Show
        when={mascots().length > 0}
        fallback={
          <div class="text-sm text-text-muted bg-surface rounded-card border border-border p-6 text-center">
            Loading mascots...
          </div>
        }
      >
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {/* No Mascot card */}
          <button
            class="bg-surface rounded-card border-2 p-4 text-center transition-all hover:shadow-sm flex flex-col items-center justify-center gap-2"
            classList={{
              "border-orange-primary shadow-sm": appStore.mascots.disabled,
              "border-border hover:border-border-hover": !appStore.mascots.disabled,
            }}
            onClick={() => appStore.mascots.setMascotDisabled(!appStore.mascots.disabled)}
          >
            <div class="w-16 h-16 mx-auto rounded-full bg-orange-subtle flex items-center justify-center overflow-hidden">
              <img src="/logo.png" alt="No mascot" class="w-8 h-8 object-contain opacity-60" />
            </div>
            <span class="font-body font-medium text-sm text-text-primary block">No Mascot</span>
            <span class="text-[10px] font-medium mt-1 block" classList={{ "text-orange-primary": appStore.mascots.disabled, "invisible": !appStore.mascots.disabled }}>Active</span>
          </button>

          <For each={mascots()}>
            {(mascot) => (
              <MascotCard
                mascot={mascot}
                isActive={!appStore.mascots.disabled && activeId() === mascot.id}
                onSelect={() => {
                  if (appStore.mascots.disabled) appStore.mascots.setMascotDisabled(false);
                  appStore.mascots.setActiveMascot(mascot.id);
                }}
                onRemove={mascot.templateSlug ? undefined : () => {
                  setRemovingMascot(mascot);
                }}
              />
            )}
          </For>

          {/* Add mascot card */}
          <button
            class="bg-surface rounded-card border-2 border-dashed border-border hover:border-orange-primary p-4 text-center transition-all hover:shadow-sm flex flex-col items-center justify-center gap-2"
            onClick={() => setShowAddModal(true)}
          >
            <div class="w-16 h-16 mx-auto rounded-full bg-orange-subtle flex items-center justify-center">
              <span class="text-2xl text-orange-primary">+</span>
            </div>
            <span class="font-body font-medium text-sm text-text-muted block">
              Add mascot
            </span>
          </button>
        </div>
      </Show>

      {/* Debug: test animation states */}
      <div class="bg-surface rounded-card border border-border p-4 space-y-3">
        <p class="text-xs text-text-muted font-body font-semibold uppercase tracking-wider">
          Debug States
        </p>
        <div class="flex flex-wrap gap-2">
          <For each={DEBUG_STATES}>
            {(state) => (
              <button
                class="px-3 py-1.5 text-sm font-body font-medium rounded-lg border transition-all"
                classList={{
                  "bg-orange-primary text-white border-orange-primary": activeDebugState() === state.id,
                  "bg-surface text-text-primary border-border hover:border-orange-primary hover:text-orange-primary": activeDebugState() !== state.id,
                }}
                onClick={() => setDebugState(state.id)}
              >
                <span class="mr-1.5">{state.icon}</span>
                {state.label}
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Community link */}
      <div class="bg-surface rounded-card border border-border border-dashed p-4 text-center">
        <p class="text-sm text-text-muted font-body">
          Want more mascots?
        </p>
        <button
          onClick={() => openUrl("https://masko.ai/claude-code")}
          class="text-sm text-orange-primary font-medium hover:underline cursor-pointer bg-transparent border-none"
        >
          Browse community mascots
        </button>
      </div>

      {/* Add mascot modal */}
      <Show when={showAddModal()}>
        <AddMascotModal onClose={() => setShowAddModal(false)} />
      </Show>

      {/* Remove mascot confirm */}
      <Show when={removingMascot()}>
        {(mascot) => (
          <ConfirmModal
            title="Remove mascot"
            message={`Remove "${mascot().name}"? This cannot be undone.`}
            confirmLabel="Remove"
            onConfirm={() => {
              const id = mascot().id;
              const wasActive = activeId() === id;
              appStore.mascots.removeMascot(id);
              if (wasActive) {
                const remaining = appStore.mascots.mascots;
                if (remaining.length > 0) {
                  appStore.mascots.setActiveMascot(remaining[0].id);
                }
              }
              setRemovingMascot(null);
            }}
            onCancel={() => setRemovingMascot(null)}
          />
        )}
      </Show>
    </div>
  );
}

function AddMascotModal(props: { onClose: () => void }) {
  const [jsonText, setJsonText] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal(false);

  function handleAdd() {
    setError(null);
    const text = jsonText().trim();
    if (!text) {
      setError("Please paste a mascot JSON config.");
      return;
    }
    try {
      const raw = JSON.parse(text);
      const config = parseMascotConfig(raw);
      appStore.mascots.addMascot(config);
      setSuccess(true);
      setTimeout(() => {
        props.onClose();
      }, 800);
    } catch (e) {
      setError(`Invalid mascot config: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div class="bg-surface rounded-card border border-border shadow-lg w-full max-w-lg mx-4 p-5 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="font-heading font-semibold text-text-primary">Add mascot</h3>
          <button
            class="text-text-muted hover:text-text-primary transition-colors text-lg leading-none"
            onClick={props.onClose}
          >
            ×
          </button>
        </div>

        <p class="text-sm text-text-muted font-body">
          Paste the mascot JSON config below. You can find mascot configs on{" "}
          <button
            onClick={() => openUrl("https://masko.ai/claude-code")}
            class="text-orange-primary hover:underline cursor-pointer bg-transparent border-none p-0 text-sm font-body inline"
          >
            masko.ai/claude-code
          </button>
          .
        </p>

        <textarea
          class="w-full h-48 bg-surface border border-border rounded-card p-3 text-sm font-mono text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-orange-primary transition-colors"
          placeholder='{"version": "1.0", "name": "My Mascot", ...}'
          value={jsonText()}
          onInput={(e) => {
            setJsonText(e.currentTarget.value);
            setError(null);
          }}
        />

        <Show when={error()}>
          <p class="text-sm text-red-400 font-body">{error()}</p>
        </Show>

        <Show when={success()}>
          <p class="text-sm text-green-400 font-body">Mascot added!</p>
        </Show>

        <div class="flex gap-2 justify-end">
          <button
            class="px-4 py-2 text-sm font-body text-text-muted hover:text-text-primary transition-colors"
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            class="px-4 py-2 text-sm font-body font-medium bg-orange-primary text-white rounded-card hover:opacity-90 transition-opacity disabled:opacity-50"
            onClick={handleAdd}
            disabled={success()}
          >
            Add mascot
          </button>
        </div>
      </div>
    </div>
  );
}

function MascotCard(props: { mascot: SavedMascot; isActive: boolean; onSelect: () => void; onRemove?: () => void }) {
  const thumb = () => getThumbnail(props.mascot);

  return (
    <div class="relative group">
      <button
        class="w-full bg-surface rounded-card border-2 p-4 text-center transition-all hover:shadow-sm"
        classList={{
          "border-orange-primary shadow-sm": props.isActive,
          "border-border hover:border-border-hover": !props.isActive,
        }}
        onClick={props.onSelect}
      >
        {/* Mascot preview */}
        <div class="w-16 h-16 mx-auto mb-2 rounded-full bg-orange-subtle flex items-center justify-center overflow-hidden">
          <Show
            when={thumb()}
            fallback={<span class="text-2xl">{getMascotEmoji(props.mascot.templateSlug)}</span>}
          >
            <img
              src={thumb()!}
              alt={props.mascot.name}
              class="w-full h-full object-contain"
              loading="lazy"
            />
          </Show>
        </div>
        <span class="font-body font-medium text-sm text-text-primary block">
          {props.mascot.name}
        </span>
        <span class="text-[10px] font-medium mt-1 block" classList={{ "text-orange-primary": props.isActive, "invisible": !props.isActive }}>Active</span>
      </button>
      <Show when={props.onRemove}>
        <button
          class="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500/80 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
          onClick={(e) => {
            e.stopPropagation();
            props.onRemove!();
          }}
          title="Remove mascot"
        >
          ×
        </button>
      </Show>
    </div>
  );
}

function ConfirmModal(props: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && props.onCancel()}
    >
      <div class="bg-surface rounded-card border border-border shadow-lg w-full max-w-sm mx-4 p-5 space-y-4">
        <h3 class="font-heading font-semibold text-text-primary">{props.title}</h3>
        <p class="text-sm text-text-muted font-body">{props.message}</p>
        <div class="flex gap-2 justify-end">
          <button
            class="px-4 py-2 text-sm font-body text-text-muted hover:text-text-primary transition-colors"
            onClick={props.onCancel}
          >
            Cancel
          </button>
          <button
            class="px-4 py-2 text-sm font-body font-medium bg-red-500 text-white rounded-card hover:bg-red-600 transition-colors"
            onClick={props.onConfirm}
          >
            {props.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function getMascotEmoji(slug?: string): string {
  const map: Record<string, string> = {
    clippy: "📎",
    masko: "🦊",
    otto: "🐙",
    nugget: "🐔",
    rusty: "🦊",
    cupidon: "💘",
    "madame-patate": "🥔",
  };
  return map[slug || ""] || "🤖";
}
