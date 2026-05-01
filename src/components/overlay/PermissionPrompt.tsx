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
import { getAutoApproveReason, type AutoApproveReason } from "../../services/bash-risk-analyzer";

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
  // Per-question state — indexed by question position
  const [currentQuestionIndex, setCurrentQuestionIndex] = createSignal(0);
  const [questionSelections, setQuestionSelections] = createSignal<Set<string>[]>([]);
  const [questionOtherActive, setQuestionOtherActive] = createSignal<boolean[]>([]);
  const [questionOtherText, setQuestionOtherText] = createSignal<string[]>([]);
  const [feedback, setFeedback] = createSignal("");
  let progressBarRef: HTMLDivElement | undefined;

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
  const [autoReason, setAutoReason] = createSignal<AutoApproveReason | null>(null);
  let wrapperRef: HTMLDivElement | undefined;

  const sessionId = () => event().session_id;

  // Determine if this permission should auto-approve, and why
  const computeAutoReason = (): AutoApproveReason | null => {
    if (isQ()) return null;
    return getAutoApproveReason(event().tool_name, event().tool_input, sessionId());
  };

  // Start countdown timer
  let countdownInterval: ReturnType<typeof setInterval> | null = null;

  const clearCountdownInterval = () => {
    if (countdownInterval !== null) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  };

  // Track permission id to restart countdown when permission changes
  const [animKey, setAnimKey] = createSignal(0);
  let lastPermId: string | null = null;

  createEffect(() => {
    // Access permission id so effect re-runs when it changes
    const permId = props.permission.id;
    const permChanged = permId !== lastPermId;
    lastPermId = permId;

    clearCountdownInterval();
    setAnimKey((k) => k + 1);

    if (permChanged) {
      // Always start unpaused on a new permission. The component instance is
      // reused across permissions (Show is non-keyed), so countdownPaused can
      // be stuck true from the previous prompt — and if the cursor is parked
      // over the bubble area when a new permission arrives, no mouseEnter/
      // mouseLeave will fire to clear it. The whole point of auto-approve is
      // running while the user is AFK / not interacting; if they want to
      // pause, the next mouseEnter will set paused=true again.
      setCountdownPaused(false);

      // Reset per-question state only when permission actually changes
      const qs = questions();
      setCurrentQuestionIndex(0);
      setQuestionSelections(qs.map(() => new Set<string>()));
      setQuestionOtherActive(qs.map(() => false));
      setQuestionOtherText(qs.map(() => ""));
    }

    const sid = sessionId();
    const reason = computeAutoReason();
    setAutoReason(reason);
    if (!reason) {
      setCountdown(null);
      log("[countdown] skip permId=", permId, "tool=", event().tool_name, "sessionId=", sid);
      return;
    }

    const seconds = autoApproveStore.settings.countdownSeconds;
    log("[countdown] init permId=", permId, "tool=", event().tool_name, "sessionId=", sid, "reason=", reason, "seconds=", seconds, "permChanged=", permChanged, "paused=", countdownPaused());
    setCountdown(seconds);

    countdownInterval = setInterval(() => {
      if (countdownPaused()) return;
      const prev = countdown();
      log("[countdown] tick, prev =", prev);
      if (prev === null) return;
      const next = prev - 1;
      if (next <= 0) {
        log("[countdown] reached 0, approving");
        clearCountdownInterval();
        setCountdown(null);
        handleApprove();
      } else {
        log("[countdown] next =", next);
        setCountdown(next);
      }
    }, 1000);

    onCleanup(clearCountdownInterval);
  });

  // Restart CSS animation when permission changes
  createEffect(() => {
    const _key = animKey();
    if (progressBarRef) {
      progressBarRef.style.animation = "none";
      progressBarRef.offsetHeight; // reflow
      progressBarRef.style.animation = `countdown-fill ${autoApproveStore.settings.countdownSeconds}s linear forwards`;
    }
  });

  /** Build the answer string for a single question from its per-question state */
  const buildQuestionAnswer = (idx: number): string => {
    const sels = [...(questionSelections()[idx] || new Set<string>())];
    if (questionOtherActive()[idx] && questionOtherText()[idx]?.trim()) {
      sels.push(questionOtherText()[idx].trim());
    }
    return sels.join(", ");
  };

  const handleApprove = () => {
    log("handleApprove called, id:", props.permission.id);
    const suggestion = selectedSuggestion();
    if (isQ()) {
      const qs = questions();
      // Multi-question: advance to next question instead of submitting
      if (qs.length > 1 && currentQuestionIndex() < qs.length - 1) {
        setCurrentQuestionIndex(currentQuestionIndex() + 1);
        return;
      }
      // Last (or only) question — submit all answers
      const answerText = answer().trim();
      if (qs.length > 0 && qs[0].options.length > 0) {
        // Option-based: send one entry per question (in question order)
        const answers = qs.map((_, i) => buildQuestionAnswer(i)).filter((a) => a.length > 0);
        permissionStore.resolve(props.permission.id, "allow", {
          type: "updatedInput",
          answers,
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

  const updateQuestionSelection = (idx: number, updater: (prev: Set<string>) => Set<string>) => {
    setQuestionSelections((prev) => {
      const next = prev.slice();
      next[idx] = updater(next[idx] || new Set<string>());
      return next;
    });
  };

  const setQuestionOtherActiveAt = (idx: number, value: boolean) => {
    setQuestionOtherActive((prev) => {
      const next = prev.slice();
      next[idx] = value;
      return next;
    });
  };

  const setQuestionOtherTextAt = (idx: number, value: string) => {
    setQuestionOtherText((prev) => {
      const next = prev.slice();
      next[idx] = value;
      return next;
    });
  };

  const toggleOption = (idx: number, label: string, multiSelect: boolean) => {
    if (multiSelect) {
      updateQuestionSelection(idx, (prev) => {
        const next = new Set(prev);
        if (next.has(label)) next.delete(label);
        else next.add(label);
        return next;
      });
    } else {
      // Single select: replace selection
      updateQuestionSelection(idx, (prev) => (prev.has(label) ? new Set<string>() : new Set<string>([label])));
    }
    // Deactivate "Other" when selecting a predefined option
    setQuestionOtherActiveAt(idx, false);
    setQuestionOtherTextAt(idx, "");
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
      ref={(el) => { wrapperRef = el; }}
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
              class="ml-1 px-1 py-0.5 rounded transition-colors cursor-pointer hover:bg-neutral-200"
              style={{
                "font-size": `${fsMuted()}px`,
                color: a().mutedColor,
                "line-height": "1",
              }}
              onClick={(e) => { e.stopPropagation(); props.onToggleExpand?.(); }}
              title={props.expanded ? "Collapse" : "Expand"}
            >
              {props.expanded ? "↘" : "⤡"}
            </button>
            {/* Close — collapses bubble (does not resolve the permission) */}
            <button
              class="px-1 py-0.5 rounded transition-colors cursor-pointer hover:bg-neutral-200"
              style={{
                "font-size": `${fsMuted()}px`,
                color: a().mutedColor,
                "line-height": "1",
              }}
              onClick={(e) => { e.stopPropagation(); clearCountdownInterval(); setCountdown(null); handleCollapse(); }}
              title="Close bubble (permission stays pending)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div class="px-3 pb-2">
          <Show when={isQ()}>
            {/* Question mode — show only current question. Use reactive accessors so JSX updates when index changes. */}
            <Show when={questions()[currentQuestionIndex()]}>
              {(() => {
                const q = () => questions()[currentQuestionIndex()];
                const idx = () => currentQuestionIndex();
                const sel = () => questionSelections()[idx()] || new Set<string>();
                const otherOn = () => questionOtherActive()[idx()] || false;
                const otherTxt = () => questionOtherText()[idx()] || "";
                return (
                <div class="mb-2">
                  <Show when={questions().length > 1}>
                    <p class="mb-1" style={{ "font-size": `${fsXs()}px`, color: a().mutedColor }}>
                      Question {idx() + 1} / {questions().length}
                    </p>
                  </Show>
                  <p class="leading-snug mb-1.5" style={{ "font-size": `${fsSm()}px`, color: a().textColor }}>{q().question}</p>
                  <Show when={q().options.length > 0}>
                    <div class="space-y-1">
                      <For each={q().options}>
                        {(opt) => (
                          <button
                            class="w-full text-left px-2 py-1 rounded-lg border transition-colors"
                            style={{
                              "font-size": `${fsSm()}px`,
                              background: sel().has(opt.label) ? `${a().accentColor}0d` : a().bgColor,
                              "border-color": sel().has(opt.label) ? `${a().accentColor}40` : "rgba(35,17,60,0.12)",
                              color: sel().has(opt.label) ? a().textColor : a().mutedColor,
                            }}
                            onClick={() => toggleOption(idx(), opt.label, q().multiSelect)}
                          >
                            {q().multiSelect ? (sel().has(opt.label) ? "☑ " : "☐ ") : (sel().has(opt.label) ? "● " : "○ ")}
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
                          background: otherOn() ? `${a().accentColor}0d` : a().bgColor,
                          "border-color": otherOn() ? `${a().accentColor}40` : "rgba(35,17,60,0.12)",
                          color: otherOn() ? a().textColor : a().mutedColor,
                        }}
                        onClick={() => {
                          if (!q().multiSelect) updateQuestionSelection(idx(), () => new Set<string>());
                          const wasOn = otherOn();
                          setQuestionOtherActiveAt(idx(), !wasOn);
                          if (wasOn) setQuestionOtherTextAt(idx(), "");
                        }}
                      >
                        {q().multiSelect ? (otherOn() ? "☑ " : "☐ ") : (otherOn() ? "● " : "○ ")}
                        Other
                      </button>
                      <Show when={otherOn()}>
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
                          value={otherTxt()}
                          onInput={(e) => setQuestionOtherTextAt(idx(), e.currentTarget.value)}
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
                  <Show when={q().options.length === 0}>
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
                );
              })()}
            </Show>
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
                    onClick={() => {
                      setSelectedSuggestion((prev) => (prev?.id === s.id ? null : s));
                      // Stop countdown when user interacts with suggestions
                      clearCountdownInterval();
                      setCountdown(null);
                    }}
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
                checked={autoApproveStore.isSessionAutoApprove(sessionId())}
                onChange={() => autoApproveStore.toggleSessionAutoApprove(sessionId())}
                class="w-3 h-3 accent-orange-500 rounded"
              />
              <span style={{ "font-size": `${fsXs()}px`, color: a().mutedColor }}>
                Auto-approve for this session
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
            {/* Countdown progress bar — smooth CSS animation, keyed to restart on permission change */}
            <Show when={countdown() !== null}>
              <div
                ref={(el) => { progressBarRef = el; }}
                class="absolute inset-0 bg-black/15 origin-left"
                style={{
                  animation: `countdown-fill ${autoApproveStore.settings.countdownSeconds}s linear forwards`,
                  "animation-play-state": countdownPaused() ? "paused" : "running",
                }}
              />
            </Show>
            <span class="relative">
              {(() => {
                if (isQ()) {
                  return questions().length > 1 && currentQuestionIndex() < questions().length - 1 ? "Next" : "Submit";
                }
                if (selectedSuggestion()) return "Allow Rule";
                const c = countdown();
                if (c === null || c <= 0) return "Approve";
                const r = autoReason();
                if (r?.type === "rule") return `Approve - Auto by rule (${c})`;
                return `Approve (${c})`;
              })()}
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
