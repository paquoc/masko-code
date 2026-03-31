import { Show } from "solid-js";
import { workingBubbleStore } from "../../stores/working-bubble-store";
import { BubbleTail, type TailDir } from "./BubbleTail";

export default function WorkingBubble(props: { tailDir?: TailDir }) {
  const s = () => workingBubbleStore.state;
  const a = () => workingBubbleStore.settings.appearance;
  const dir = () => props.tailDir || "down";

  return (
    <div
      class="select-none flex items-center"
      classList={{
        "flex-col items-center": dir() === "down",
        "flex-row": dir() === "right",
        "flex-row-reverse": dir() === "left",
      }}
      style={{ "font-family": "var(--font-body)" }}
    >
      {/* Card — fixed width */}
      <div
        class="w-44 backdrop-blur-sm rounded-xl px-3 py-2 overflow-hidden shrink-0"
        style={{
          background: a().bgColor,
          "box-shadow": "0 2px 8px rgba(35,17,60,0.12), 0 0 0 1px rgba(35,17,60,0.06)",
        }}
      >
        {/* Folder name — small muted text */}
        <div class="truncate leading-tight" style={{ "font-size": `${a().fontSize - 2}px`, color: a().mutedColor }}>
          {s().projectName}
        </div>

        {/* Tool name / status indicator */}
        <div class="flex items-center gap-1.5 mt-0.5">
          <Show when={s().status === "working"}>
            <span class="relative flex h-1.5 w-1.5 shrink-0">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: a().accentColor }} />
              <span class="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: a().accentColor }} />
            </span>
          </Show>
          <Show when={s().status === "done" || s().status === "session-start"}>
            <span class="flex h-3 w-3 shrink-0 items-center justify-center rounded-full" style={{ background: a().accentColor }}>
              <svg class="h-2 w-2 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2.5 6.5L5 9L9.5 3.5" />
              </svg>
            </span>
          </Show>
          <span class="font-medium truncate"
            style={{
              "font-size": `${a().fontSize}px`,
              color: s().status === "working" ? a().textColor : a().accentColor,
            }}
          >
            {s().toolName}
          </span>
        </div>
      </div>

      {/* Tail — sibling to card so it has real layout width */}
      <BubbleTail dir={dir()} color={a().bgColor} />
    </div>
  );
}
