import { Show, For, createSignal, createEffect } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { PendingPermission } from "../../models/permission";
import { parsePermissionSuggestions, type PermissionSuggestion } from "../../models/permission";
import { getAssistantDisplayName, getProjectName } from "../../models/agent-event";
import { permissionStore } from "../../stores/permission-store";
import { workingBubbleStore } from "../../stores/working-bubble-store";
import { log } from "../../services/log";

/** Speech bubble tail pointing down toward the mascot */
function SpeechBubbleTail(props: { color: string }) {
  return (
    <div class="flex justify-end pr-8">
      <div
        style={{
          width: "0",
          height: "0",
          "border-left": "8px solid transparent",
          "border-right": "8px solid transparent",
          "border-top": `8px solid ${props.color}`,
          filter: "drop-shadow(0 1px 1px rgba(35,17,60,0.08))",
        }}
      />
    </div>
  );
}

/** Format tool input for display */
function formatToolInput(event: PendingPermission["event"]): string | null {
  if (!event.tool_input) return null;
  const input = event.tool_input;

  // Bash command
  if (input.command) return String(input.command);
  // File path
  if (input.file_path) return String(input.file_path);
  // Query
  if (input.query) return String(input.query);
  // URL
  if (input.url) return String(input.url);

  return null;
}

/** Check if this is an AskUserQuestion */
function isQuestion(event: PendingPermission["event"]): boolean {
  return event.tool_name === "AskUserQuestion";
}

/** Parse questions from AskUserQuestion tool_input */
function parseQuestions(event: PendingPermission["event"]): Array<{
  question: string;
  options: Array<{ label: string; description?: string }>;
}> {
  if (!event.tool_input?.questions) return [];
  const raw = event.tool_input.questions;
  if (!Array.isArray(raw)) return [];
  return raw.map((q: any) => ({
    question: q.question || "",
    options: Array.isArray(q.options)
      ? q.options.map((o: any) =>
          typeof o === "string" ? { label: o } : { label: o.label || "", description: o.description },
        )
      : [],
  }));
}

export default function PermissionPrompt(props: { permission: PendingPermission }) {
  const [selectedSuggestion, setSelectedSuggestion] = createSignal<PermissionSuggestion | null>(null);
  const [answer, setAnswer] = createSignal("");
  const [selectedOptions, setSelectedOptions] = createSignal<Set<string>>(new Set());

  const event = () => props.permission.event;
  const toolName = () => event().tool_name || "Unknown";
  const assistant = () => getAssistantDisplayName(event());
  const project = () => getProjectName(event()) || "project";
  const toolInput = () => formatToolInput(event());
  const suggestions = () => parsePermissionSuggestions(event().permission_suggestions);
  const questions = () => parseQuestions(event());
  const isQ = () => isQuestion(event());

  const handleApprove = () => {
    log("handleApprove called, id:", props.permission.id);
    const suggestion = selectedSuggestion();
    if (isQ()) {
      // Send answer
      const answerText = answer().trim();
      if (questions().length > 0 && questions()[0].options.length > 0) {
        // Option-based answer
        const selected = [...selectedOptions()];
        permissionStore.resolve(props.permission.id, "allow", {
          type: "updatedInput",
          answers: selected,
        });
      } else if (answerText) {
        permissionStore.resolve(props.permission.id, "allow", {
          type: "updatedInput",
          answer: answerText,
        });
      }
    } else if (suggestion) {
      permissionStore.resolve(props.permission.id, "allow", suggestion);
    } else {
      permissionStore.resolve(props.permission.id, "allow");
    }
  };

  const handleDeny = () => {
    log("handleDeny called, id:", props.permission.id);
    permissionStore.resolve(props.permission.id, "deny");
  };

  const handleCollapse = () => {
    permissionStore.collapse(props.permission.id);
  };

  const handleOpenTerminal = async () => {
    const pid = event().terminal_pid;
    if (!pid) return;
    try {
      await invoke("focus_terminal", { pid });
    } catch (e) {
      log("focus_terminal failed:", e);
    }
  };

  const toggleOption = (label: string) => {
    setSelectedOptions((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const a = () => workingBubbleStore.settings.appearance;

  // Derived font sizes from the setting — permission uses +2 as base
  const fs = () => a().fontSize + 2;       // base (was 13px at default 11)
  const fsSm = () => a().fontSize + 1;     // body text
  const fsMono = () => a().fontSize;        // code block
  const fsMuted = () => a().fontSize - 1;   // secondary
  const fsXs = () => a().fontSize - 2;      // smallest (suggestions)

  return (
    <div class="w-72 select-none" style={{ "font-family": "var(--font-body)" }}>
      {/* Speech bubble card */}
      <div
        class="rounded-[14px] overflow-hidden"
        style={{
          background: a().bgColor,
          "box-shadow": "0 2px 12px rgba(35,17,60,0.15), 0 0 0 1px rgba(35,17,60,0.06)",
        }}
      >
        {/* Header */}
        <div class="px-3 pt-2 pb-1.5">
          <div class="flex items-center gap-1.5">
            <Show
              when={!isQ()}
              fallback={
                <span class="font-semibold" style={{ "font-size": `${fs()}px`, color: a().accentColor }}>Question</span>
              }
            >
              <span class="font-semibold" style={{ "font-size": `${fs()}px`, color: a().accentColor }}>{toolName()}</span>
            </Show>
            <span class="ml-auto" style={{ "font-size": `${fsMuted()}px`, color: a().mutedColor }}>{project()}</span>
          </div>
        </div>

        {/* Content */}
        <div class="px-3 pb-2">
          <Show when={isQ()}>
            {/* Question mode */}
            <For each={questions()}>
              {(q) => (
                <div class="mb-2">
                  <p class="leading-snug mb-1.5" style={{ "font-size": `${fsSm()}px`, color: a().textColor }}>{q.question}</p>
                  <Show when={q.options.length > 0}>
                    <div class="space-y-1">
                      <For each={q.options}>
                        {(opt) => (
                          <button
                            class="w-full text-left px-2 py-1 rounded-lg border transition-colors"
                            style={{
                              "font-size": `${fsSm()}px`,
                              background: selectedOptions().has(opt.label) ? `${a().accentColor}0d` : a().bgColor,
                              "border-color": selectedOptions().has(opt.label) ? `${a().accentColor}40` : "rgba(35,17,60,0.12)",
                              color: selectedOptions().has(opt.label) ? a().textColor : a().mutedColor,
                            }}
                            onClick={() => toggleOption(opt.label)}
                          >
                            {opt.label}
                            <Show when={opt.description}>
                              <span class="block" style={{ "font-size": `${fsXs()}px`, color: a().mutedColor }}>{opt.description}</span>
                            </Show>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={q.options.length === 0}>
                    <input
                      type="text"
                      class="w-full px-2 py-1 rounded-lg border focus:outline-none"
                      style={{
                        "font-size": `${fsSm()}px`,
                        "border-color": "rgba(35,17,60,0.12)",
                        background: "rgba(35,17,60,0.02)",
                        color: a().textColor,
                      }}
                      placeholder="Type your answer..."
                      value={answer()}
                      onInput={(e) => setAnswer(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleApprove();
                      }}
                    />
                  </Show>
                </div>
              )}
            </For>
          </Show>

          <Show when={!isQ()}>
            {/* Tool use mode — show command/path */}
            <Show when={toolInput()}>
              <div
                class="rounded-lg px-2 py-1 mb-1.5 font-mono break-all leading-snug max-h-16 overflow-y-auto"
                style={{
                  "font-size": `${fsMono()}px`,
                  background: "rgba(35,17,60,0.04)",
                  border: "1px solid rgba(35,17,60,0.06)",
                  color: a().textColor,
                }}
              >
                {toolInput()}
              </div>
            </Show>

            <Show when={event().message}>
              <p class="leading-snug mb-1.5 max-h-12 overflow-y-auto" style={{ "font-size": `${fsSm()}px`, color: a().mutedColor }}>
                {event().message}
              </p>
            </Show>
          </Show>

          {/* Permission suggestions */}
          <Show when={suggestions().length > 0}>
            <div class="flex flex-wrap gap-1 mb-1.5">
              <For each={suggestions()}>
                {(s) => (
                  <button
                    class="relative group px-1.5 py-0.5 rounded-md border transition-colors"
                    style={{
                      "font-size": `${fsXs()}px`,
                      background: selectedSuggestion()?.id === s.id ? `${a().accentColor}14` : a().bgColor,
                      "border-color": selectedSuggestion()?.id === s.id ? `${a().accentColor}40` : "rgba(35,17,60,0.12)",
                      color: selectedSuggestion()?.id === s.id ? a().accentColor : a().mutedColor,
                    }}
                    onClick={() =>
                      setSelectedSuggestion((prev) => (prev?.id === s.id ? null : s))
                    }
                  >
                    {s.displayLabel}
                    {/* Tooltip — shows full untruncated label */}
                    <div
                      class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150"
                      style={{
                        "font-size": `${fsXs()}px`,
                        "white-space": "pre-wrap",
                        "word-break": "break-all",
                        "max-width": "250px",
                        background: a().textColor,
                        color: a().bgColor,
                        "box-shadow": "0 2px 8px rgba(0,0,0,0.2)",
                      }}
                    >
                      {s.fullLabel}
                      <div
                        class="absolute top-full left-1/2 -translate-x-1/2"
                        style={{
                          width: "0", height: "0",
                          "border-left": "4px solid transparent",
                          "border-right": "4px solid transparent",
                          "border-top": `4px solid ${a().textColor}`,
                        }}
                      />
                    </div>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Action buttons */}
        <div class="px-3.5 pb-2.5 flex items-center gap-1.5">
          <button
            class="flex-1 px-3 py-1.5 rounded-lg font-semibold transition-colors"
            style={{
              "font-size": `${fsSm()}px`,
              "font-family": "var(--font-heading)",
              background: a().accentColor,
              color: a().buttonTextColor,
            }}
            onClick={handleApprove}
          >
            {isQ() ? "Submit" : selectedSuggestion() ? "Allow Rule" : "Approve"}
          </button>

          <Show when={!isQ()}>
            <button
              class="px-2.5 py-1.5 rounded-lg font-medium border transition-colors"
              style={{
                "font-size": `${fsSm()}px`,
                "font-family": "var(--font-heading)",
                "border-color": "rgba(35,17,60,0.12)",
                color: a().mutedColor,
              }}
              onClick={handleDeny}
            >
              Deny
            </button>
          </Show>

          {/* Open terminal */}
          <Show when={event().terminal_pid}>
            <button
              class="px-1.5 py-1.5 rounded-lg transition-colors"
              style={{ color: a().mutedColor }}
              onClick={handleOpenTerminal}
              title="Open terminal"
            >
              <svg width={fsSm()} height={fsSm()} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="1" y="2" width="14" height="12" rx="2" />
                <path d="M4 6l3 2.5L4 11" />
                <path d="M9 11h3" />
              </svg>
            </button>
          </Show>

          {/* <button
            class="px-1.5 py-1.5 rounded-lg transition-colors"
            style={{ "font-size": `${fsSm()}px`, color: a().mutedColor }}
            onClick={handleCollapse}
            title="Later"
          >
            ▼
          </button> */}
        </div>
      </div>

      {/* Speech bubble tail */}
      <SpeechBubbleTail color={a().bgColor} />
    </div>
  );
}
