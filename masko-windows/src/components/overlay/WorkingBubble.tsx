import { Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { workingBubbleStore } from "../../stores/working-bubble-store";
import { log } from "../../services/log";

export default function WorkingBubble() {
  const s = () => workingBubbleStore.state;

  const handleClick = async () => {
    const pid = s().terminalPid;
    if (!pid) return;
    try {
      await invoke("focus_terminal", { pid });
    } catch (e) {
      log("focus_terminal failed:", e);
    }
  };

  return (
    <div
      class="w-44 select-none cursor-pointer"
      style={{ "font-family": "var(--font-body)" }}
      onClick={handleClick}
    >
      <div
        class="bg-white/95 backdrop-blur-sm rounded-xl px-3 py-2 overflow-hidden"
        style={{
          "box-shadow": "0 2px 8px rgba(35,17,60,0.12), 0 0 0 1px rgba(35,17,60,0.06)",
        }}
      >
        {/* Folder name — small muted text */}
        <div class="text-[9px] text-text-muted truncate leading-tight">
          {s().projectName}
        </div>

        {/* Tool name / status indicator */}
        <div class="flex items-center gap-1.5 mt-0.5">
          <Show when={s().status === "working"}>
            <span class="relative flex h-1.5 w-1.5 shrink-0">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-primary opacity-75" />
              <span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-orange-primary" />
            </span>
          </Show>
          <Show when={s().status === "done" || s().status === "session-start"}>
            <span class="flex h-3 w-3 shrink-0 items-center justify-center rounded-full bg-green-500">
              <svg class="h-2 w-2 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2.5 6.5L5 9L9.5 3.5" />
              </svg>
            </span>
          </Show>
          <span class="text-[11px] font-medium truncate"
            classList={{ "text-green-600": s().status !== "working", "text-text-primary": s().status === "working" }}
          >
            {s().toolName}
          </span>
        </div>
      </div>

      {/* Speech bubble tail */}
      <div class="flex justify-end pr-8">
        <div
          style={{
            width: "0",
            height: "0",
            "border-left": "6px solid transparent",
            "border-right": "6px solid transparent",
            "border-top": "6px solid rgba(255,255,255,0.95)",
            filter: "drop-shadow(0 1px 1px rgba(35,17,60,0.06))",
          }}
        />
      </div>
    </div>
  );
}
