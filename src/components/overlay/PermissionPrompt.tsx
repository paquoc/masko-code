import { Show, For, createSignal, createEffect, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { PendingPermission } from "../../models/permission";
import { parsePermissionSuggestions, type PermissionSuggestion } from "../../models/permission";
import { getAssistantDisplayName, getProjectName } from "../../models/agent-event";
import { permissionStore } from "../../stores/permission-store";
import { workingBubbleStore, type BubbleAppearance } from "../../stores/working-bubble-store";
import { log } from "../../services/log";
import { BubbleTail, type TailDir } from "./BubbleTail";
import { autoApproveStore } from "../../stores/auto-approve-store";
import { shouldShowCountdown } from "../../services/bash-risk-analyzer";

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
  multiSelect: boolean;
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
    multiSelect: q.multiSelect === true,
  }));
}

export default function PermissionPrompt(props: { permission: PendingPermission; tailDir?: TailDir; expanded?: boolean; onToggleExpand?: () => void; appearance?: BubbleAppearance }) {
  const [selectedSuggestion, setSelectedSuggestion] = createSignal<PermissionSuggestion | null>(null);
  const [answer, setAnswer] = createSignal("");
  const [selectedOptions, setSelectedOptions] = createSignal<Set<string>>(new Set());
  const [otherActive, setOtherActive] = createSignal(false);
  const [otherText, setOtherText] = createSignal("");
  const [feedback, setFeedback] = createSignal("");

  const event = () => props.permission.event;
  const toolName = () => event().tool_name || "Unknown";
  const assistant = () => getAssistantDisplayName(event());
  const project = () => getProjectName(event()) || "project";
  const toolInput = () => formatToolInput(event());
  const suggestions = () => parsePermissionSuggestions(event().permission_suggestions);
  const questions = () => parseQuestions(event());
  const isQ = () => isQuestion(event());

  // Auto-approve countdown
  const [countdown, setCountdown] = createSignal<number | null>(null);
  const [countdownPaused, setCountdownPaused] = createSignal(false);

  // Determine if this permission should auto-approve
  const shouldCountdown = () => {
    if (isQ()) return false;
    return shouldShowCountdown(event().tool_name, event().tool_input);
  };

  // Start countdown timer
  createEffect(() => {
    if (!shouldCountdown()) {
      setCountdown(null);
      return;
    }

    const seconds = autoApproveStore.settings.countdownSeconds;
    setCountdown(seconds);

    const interval = setInterval(() => {
      if (countdownPaused()) return;
      setCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(interval);
          // Auto-approve
          handleApprove();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    onCleanup(() => clearInterval(interval));
  });

  const handleApprove = () => {
    log("handleApprove called, id:", props.permission.id);
    const suggestion = selectedSuggestion();
    if (isQ()) {
      // Send answer
      const answerText = answer().trim();
      if (questions().length > 0 && questions()[0].options.length > 0) {
        // Option-based answer — include "Other" text if active
        const selected = [...selectedOptions()];
        if (otherActive() && otherText().trim()) {
          selected.push(otherText().trim());
        }
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
    const fb = feedback().trim();
    permissionStore.resolve(props.permission.id, "deny", fb ? { type: "feedback", reason: fb } : undefined);
  };

  const handleCollapse = () => {
    permissionStore.collapse(props.permission.id);
  };

  const toggleOption = (label: string, multiSelect: boolean) => {
    if (multiSelect) {
      setSelectedOptions((prev) => {
        const next = new Set(prev);
        if (next.has(label)) next.delete(label);
        else next.add(label);
        return next;
      });
    } else {
      // Single select: replace selection
      setSelectedOptions((prev) => prev.has(label) ? new Set<string>() : new Set<string>([label]));
    }
    // Deactivate "Other" when selecting a predefined option
    setOtherActive(false);
    setOtherText("");
  };

  const a = () => props.appearance || workingBubbleStore.settings.appearance;

  // Derived font sizes from the setting — permission uses +2 as base
  const fs = () => a().fontSize + 2;       // base (was 13px at default 11)
  const fsSm = () => a().fontSize + 1;     // body text
  const fsMono = () => a().fontSize;        // code block
  const fsMuted = () => a().fontSize - 1;   // secondary
  const fsXs = () => a().fontSize - 1;      // secondary (suggestions)

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
      onMouseEnter={() => setCountdownPaused(true)}
      onMouseLeave={() => setCountdownPaused(false)}
    >
      {/* Speech bubble card */}
      <div
        class="rounded-[14px] shrink-0 transition-all duration-200 ease-out"
        style={{
          width: props.expanded ? "27rem" : "18rem",
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
            {/* Expand / Collapse toggle */}
            <button
              class="ml-1 px-1 py-0.5 rounded transition-colors"
              style={{
                "font-size": `${fsMuted()}px`,
                color: a().mutedColor,
                background: "transparent",
                "line-height": "1",
              }}
              onClick={(e) => { e.stopPropagation(); props.onToggleExpand?.(); }}
              title={props.expanded ? "Collapse" : "Expand"}
            >
              {props.expanded ? "↘" : "⤡"}
            </button>
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
                            onClick={() => toggleOption(opt.label, q.multiSelect)}
                          >
                            {q.multiSelect ? (selectedOptions().has(opt.label) ? "☑ " : "☐ ") : (selectedOptions().has(opt.label) ? "● " : "○ ")}
                            {opt.label}
                            <Show when={opt.description}>
                              <span class="block ml-4" style={{ "font-size": `${fsXs()}px`, color: a().mutedColor }}>{opt.description}</span>
                            </Show>
                          </button>
                        )}
                      </For>
                      {/* "Other" option */}
                      <button
                        class="w-full text-left px-2 py-1 rounded-lg border transition-colors"
                        style={{
                          "font-size": `${fsSm()}px`,
                          background: otherActive() ? `${a().accentColor}0d` : a().bgColor,
                          "border-color": otherActive() ? `${a().accentColor}40` : "rgba(35,17,60,0.12)",
                          color: otherActive() ? a().textColor : a().mutedColor,
                        }}
                        onClick={() => {
                          if (!q.multiSelect) setSelectedOptions(new Set<string>());
                          setOtherActive((v) => !v);
                          if (otherActive()) setOtherText("");
                        }}
                      >
                        {q.multiSelect ? (otherActive() ? "☑ " : "☐ ") : (otherActive() ? "● " : "○ ")}
                        Other
                      </button>
                      <Show when={otherActive()}>
                        <input
                          type="text"
                          class="w-full px-2 py-1 rounded-lg border focus:outline-none"
                          style={{
                            "font-size": `${fsSm()}px`,
                            "border-color": `${a().accentColor}40`,
                            background: "rgba(35,17,60,0.02)",
                            color: a().textColor,
                          }}
                          placeholder="Type your answer..."
                          value={otherText()}
                          onInput={(e) => setOtherText(e.currentTarget.value)}
                          onFocus={() => invoke("focus_overlay").catch(() => {})}
                          onBlur={() => invoke("unfocus_overlay").catch(() => {})}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleApprove();
                          }}
                          autofocus
                        />
                      </Show>
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
                      onFocus={() => invoke("focus_overlay").catch(() => {})}
                      onBlur={() => invoke("unfocus_overlay").catch(() => {})}
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
                class="select-text rounded-lg px-2 py-1 mb-1.5 font-mono leading-snug overflow-y-auto"
                classList={{ "max-h-20": !props.expanded, "max-h-40": !!props.expanded }}
                style={{
                  "font-size": `${fsMono()}px`,
                  "overflow-wrap": "break-word",
                  "word-break": "normal",
                  "user-select": "text",
                  background: "rgba(35,17,60,0.04)",
                  border: "1px solid rgba(35,17,60,0.06)",
                  color: a().textColor,
                }}
              >
                {toolInput()}
              </div>
            </Show>

            <Show when={event().message}>
              <p class="leading-snug mb-1.5 overflow-y-auto" classList={{ "max-h-12": !props.expanded, "max-h-[7.5rem]": !!props.expanded }} style={{ "font-size": `${fsSm()}px`, color: a().mutedColor }}>
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
                      "white-space": "nowrap",
                      background: selectedSuggestion()?.id === s.id ? `${a().accentColor}14` : a().bgColor,
                      "border-color": selectedSuggestion()?.id === s.id ? `${a().accentColor}40` : "rgba(35,17,60,0.12)",
                      color: selectedSuggestion()?.id === s.id ? a().accentColor : a().mutedColor,
                    }}
                    onClick={() =>
                      setSelectedSuggestion((prev) => (prev?.id === s.id ? null : s))
                    }
                  >
                    {s.displayLabel.length > 40 ? s.displayLabel.slice(0, 37) + "..." : s.displayLabel}
                    {/* Tooltip — shows full untruncated label */}
                    <div
                      class="absolute min-w-32 bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50"
                      style={{
                        "font-size": `${fsXs()}px`,
                        "font-family": "var(--font-mono, monospace)",
                        "text-align": "left",
                        "white-space": "pre-wrap",
                        "overflow-wrap": "break-word",
                        "word-break": "normal",
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

        {/* Session auto-approve checkbox */}
        <Show when={!isQ()}>
          <div class="px-3.5 pb-1">
            <label
              class="flex items-center gap-1.5 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={autoApproveStore.sessionAutoApprove}
                onChange={() => autoApproveStore.toggleSessionAutoApprove()}
                class="w-3 h-3 accent-orange-500 rounded"
              />
              <span style={{ "font-size": `${fsXs()}px`, color: a().mutedColor }}>
                Auto Approve for this session
              </span>
            </label>
          </div>
        </Show>

        {/* Action buttons */}
        <div class="px-3.5 pb-2.5 flex items-center gap-1.5">
          <button
            class="flex-1 px-3 py-1.5 rounded-lg font-semibold transition-colors relative overflow-hidden"
            style={{
              "font-size": `${fsSm()}px`,
              "font-family": "var(--font-heading)",
              background: a().accentColor,
              color: a().buttonTextColor,
            }}
            onClick={handleApprove}
            title="Ctrl+⏎"
          >
            {/* Countdown progress bar */}
            <Show when={countdown() !== null && countdown()! > 0}>
              <div
                class="absolute inset-0 bg-black/15 origin-left transition-transform duration-1000 ease-linear"
                style={{
                  transform: `scaleX(${1 - (countdown()! / autoApproveStore.settings.countdownSeconds)})`,
                }}
              />
            </Show>
            <span class="relative">
              {isQ()
                ? "Submit"
                : selectedSuggestion()
                  ? "Allow Rule"
                  : countdown() !== null && countdown()! > 0
                    ? `Approve (${countdown()})`
                    : "Approve"}
            </span>
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
              onClick={() => { setCountdown(null); handleDeny(); }}
              title="Ctrl+←"
            >
              Deny
            </button>
          </Show>
        </div>

        {/* Feedback input — for tool permissions only */}
        <Show when={!isQ()}>
          <div class="px-3 pb-2.5">
            <input
              type="text"
              class="w-full px-2 py-1 rounded-lg border focus:outline-none"
              style={{
                "font-size": `${fsXs()}px`,
                "border-color": "rgba(35,17,60,0.10)",
                background: "rgba(35,17,60,0.02)",
                color: a().textColor,
              }}
              placeholder="Tell what to do instead..."
              value={feedback()}
              onInput={(e) => setFeedback(e.currentTarget.value)}
              onFocus={() => invoke("focus_overlay").catch(() => {})}
              onBlur={() => invoke("unfocus_overlay").catch(() => {})}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleDeny();
              }}
            />
          </div>
        </Show>
      </div>

      {/* Speech bubble tail */}
      <BubbleTail dir={dir()} color={a().bgColor} />
    </div>
  );
}
