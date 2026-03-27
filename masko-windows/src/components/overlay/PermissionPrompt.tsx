import { Show, For, createSignal, createEffect } from "solid-js";
import type { PendingPermission } from "../../models/permission";
import { parsePermissionSuggestions, type PermissionSuggestion } from "../../models/permission";
import { getAssistantDisplayName, getProjectName } from "../../models/agent-event";
import { permissionStore } from "../../stores/permission-store";

/** Speech bubble tail pointing down toward the mascot */
function SpeechBubbleTail() {
  return (
    <div class="flex justify-end pr-8">
      <div
        style={{
          width: "0",
          height: "0",
          "border-left": "8px solid transparent",
          "border-right": "8px solid transparent",
          "border-top": "8px solid white",
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
    console.log("[masko] handleApprove called, id:", props.permission.id);
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
    console.log("[masko] handleDeny called, id:", props.permission.id);
    permissionStore.resolve(props.permission.id, "deny");
  };

  const handleCollapse = () => {
    permissionStore.collapse(props.permission.id);
  };

  const toggleOption = (label: string) => {
    setSelectedOptions((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <div class="w-72 select-none" style={{ "font-family": "var(--font-body)" }}>
      {/* Speech bubble card */}
      <div
        class="bg-white rounded-[14px] overflow-hidden"
        style={{
          "box-shadow": "0 2px 12px rgba(35,17,60,0.15), 0 0 0 1px rgba(35,17,60,0.06)",
        }}
      >
        {/* Header */}
        <div class="px-3 pt-2.5 pb-1.5">
          <div class="flex items-center gap-1.5">
            <Show
              when={!isQ()}
              fallback={
                <span class="text-orange-primary text-xs font-semibold">Question</span>
              }
            >
              <span class="text-orange-primary text-xs font-semibold">{toolName()}</span>
            </Show>
            <span class="text-text-muted text-[10px] ml-auto">{project()}</span>
          </div>
        </div>

        {/* Content */}
        <div class="px-3 pb-2">
          <Show when={isQ()}>
            {/* Question mode */}
            <For each={questions()}>
              {(q) => (
                <div class="mb-2">
                  <p class="text-[11px] text-text-primary leading-snug mb-1.5">{q.question}</p>
                  <Show when={q.options.length > 0}>
                    <div class="space-y-1">
                      <For each={q.options}>
                        {(opt) => (
                          <button
                            class="w-full text-left px-2 py-1 rounded-lg text-[11px] border transition-colors"
                            classList={{
                              "bg-orange-primary/5 border-orange-primary/25 text-text-primary":
                                selectedOptions().has(opt.label),
                              "bg-white border-border hover:border-border-hover text-text-muted":
                                !selectedOptions().has(opt.label),
                            }}
                            onClick={() => toggleOption(opt.label)}
                          >
                            {opt.label}
                            <Show when={opt.description}>
                              <span class="text-text-muted text-[9px] block">{opt.description}</span>
                            </Show>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={q.options.length === 0}>
                    <input
                      type="text"
                      class="w-full px-2 py-1 rounded-lg text-[11px] border border-border bg-bg-light focus:border-orange-primary focus:outline-none"
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
                class="rounded-lg px-2 py-1 mb-1.5 text-[10px] font-mono break-all leading-snug max-h-16 overflow-y-auto"
                style={{
                  background: "rgba(35,17,60,0.04)",
                  border: "1px solid rgba(35,17,60,0.06)",
                  color: "var(--color-text-primary)",
                }}
              >
                {toolInput()}
              </div>
            </Show>

            <Show when={event().message}>
              <p class="text-[11px] text-text-muted leading-snug mb-1.5 max-h-12 overflow-y-auto">
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
                    class="px-1.5 py-0.5 rounded-md text-[9px] border transition-colors"
                    classList={{
                      "bg-orange-primary/8 border-orange-primary/25 text-orange-primary":
                        selectedSuggestion()?.id === s.id,
                      "bg-white border-border text-text-muted hover:border-border-hover":
                        selectedSuggestion()?.id !== s.id,
                    }}
                    onClick={() =>
                      setSelectedSuggestion((prev) => (prev?.id === s.id ? null : s))
                    }
                  >
                    {s.displayLabel}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Action buttons */}
        <div class="px-3 pb-2.5 flex items-center gap-1.5">
          <button
            class="flex-1 px-3 py-1 rounded-lg text-[11px] font-semibold text-white transition-colors"
            style={{
              "font-family": "var(--font-heading)",
              background: "var(--color-orange-primary)",
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = "var(--color-orange-hover)")}
            onMouseOut={(e) => (e.currentTarget.style.background = "var(--color-orange-primary)")}
            onClick={handleApprove}
          >
            {isQ() ? "Submit" : selectedSuggestion() ? "Allow Rule" : "Approve"}
          </button>

          <Show when={!isQ()}>
            <button
              class="px-2.5 py-1 rounded-lg text-[11px] font-medium border border-border text-text-muted hover:border-border-hover transition-colors"
              style={{ "font-family": "var(--font-heading)" }}
              onClick={handleDeny}
            >
              Deny
            </button>
          </Show>

          <button
            class="px-1.5 py-1 rounded-lg text-[11px] text-text-muted hover:text-text-primary transition-colors"
            onClick={handleCollapse}
            title="Later"
          >
            ▼
          </button>
        </div>
      </div>

      {/* Speech bubble tail */}
      <SpeechBubbleTail />
    </div>
  );
}
