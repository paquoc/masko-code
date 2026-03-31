import { For, Show, createSignal } from "solid-js";
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

export default function MascotGallery() {
  const mascots = () => appStore.mascots.mascots;
  const activeId = () => appStore.mascots.activeMascotId;
  const [showAddModal, setShowAddModal] = createSignal(false);

  return (
    <div class="space-y-4">
      <Show
        when={mascots().length > 0}
        fallback={
          <div class="text-sm text-text-muted bg-surface rounded-[--radius-card] border border-border p-6 text-center">
            Loading mascots...
          </div>
        }
      >
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <For each={mascots()}>
            {(mascot) => (
              <MascotCard
                mascot={mascot}
                isActive={activeId() === mascot.id}
                onSelect={() => appStore.mascots.setActiveMascot(mascot.id)}
              />
            )}
          </For>

          {/* Add mascot card */}
          <button
            class="bg-surface rounded-[--radius-card] border-2 border-dashed border-border hover:border-orange-primary p-4 text-center transition-all hover:shadow-sm flex flex-col items-center justify-center gap-2"
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

      {/* Community link */}
      <div class="bg-surface rounded-[--radius-card] border border-border border-dashed p-4 text-center">
        <p class="text-sm text-text-muted font-body">
          Want more mascots?
        </p>
        <a
          href="https://masko.ai/claude-code"
          target="_blank"
          class="text-sm text-orange-primary font-medium hover:underline"
        >
          Browse community mascots
        </a>
      </div>

      {/* Add mascot modal */}
      <Show when={showAddModal()}>
        <AddMascotModal onClose={() => setShowAddModal(false)} />
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
      <div class="bg-background rounded-[--radius-card] border border-border shadow-lg w-full max-w-lg mx-4 p-5 space-y-4">
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
          <a
            href="https://masko.ai/claude-code"
            target="_blank"
            class="text-orange-primary hover:underline"
          >
            masko.ai/claude-code
          </a>
          .
        </p>

        <textarea
          class="w-full h-48 bg-surface border border-border rounded-[--radius-card] p-3 text-sm font-mono text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-orange-primary transition-colors"
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
            class="px-4 py-2 text-sm font-body font-medium bg-orange-primary text-white rounded-[--radius-card] hover:opacity-90 transition-opacity disabled:opacity-50"
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

function MascotCard(props: { mascot: SavedMascot; isActive: boolean; onSelect: () => void }) {
  const thumb = () => getThumbnail(props.mascot);

  return (
    <button
      class="bg-surface rounded-[--radius-card] border-2 p-4 text-center transition-all hover:shadow-sm"
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
      <Show when={props.isActive}>
        <span class="text-[10px] text-orange-primary font-medium mt-1 block">Active</span>
      </Show>
    </button>
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
