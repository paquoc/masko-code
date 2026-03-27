import { For, Show } from "solid-js";
import { appStore } from "../../stores/app-store";
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
        </div>
      </Show>

      {/* Community link */}
      <div class="bg-surface rounded-[--radius-card] border border-border border-dashed p-4 text-center">
        <p class="text-sm text-text-muted font-body">
          Want more mascots?
        </p>
        <a
          href="https://masko.ai"
          target="_blank"
          class="text-sm text-orange-primary font-medium hover:underline"
        >
          Browse community mascots
        </a>
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
