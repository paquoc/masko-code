import { createSignal, createEffect, onMount, onCleanup, Show, type JSX } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { OverlayStateMachine } from "../../services/state-machine";
import { parseMascotConfig } from "../../models/mascot-config";
import { parseAgentEvent, HookEventType, getEventType } from "../../models/agent-event";
import { conditionBool, conditionNumber } from "../../models/types";
import { permissionStore } from "../../stores/permission-store";
import { workingBubbleStore } from "../../stores/working-bubble-store";
import { tokenUsageStore } from "../../stores/token-usage-store";
import TokenPanel from "./TokenPanel";
import { overlayPositionStore } from "../../stores/overlay-position-store";
import { telegramStore } from "../../stores/telegram-store";
import { log, error } from "../../services/log";
import PermissionPrompt from "./PermissionPrompt";
import WorkingBubble from "./WorkingBubble";
import { TAIL_SIZE, type TailDir } from "./BubbleTail";
import { Send, ChartNoAxesColumn } from "lucide-solid";

// ─── Context Menu ─────────────────────────────────────────────────────────────

type SliderType = "size" | "opacity" | "telegram" | "token";

function ContextMenu(props: {
  x: number;
  y: number;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = createSignal<SliderType | null>(null);

  const toggleSlider = (type: SliderType) =>
    setExpanded((prev) => (prev === type ? null : type));

  function openDashboard() {
    props.onClose();
    WebviewWindow.getByLabel("main").then((win) => {
      win?.show().catch(() => { });
      win?.setFocus().catch(() => { });
    }).catch(() => { });
  }

  function openDevTools() {
    props.onClose();
    invoke("open_devtools").catch(() => { });
  }

  function quitApp() {
    props.onClose();
    invoke("quit_app").catch(() => { });
  }

  const telegramConfigured = () => {
    const s = telegramStore.status;
    return s.configured && !s.error;
  };

  const tokenPanelEnabled = () => workingBubbleStore.settings.tokenPanel.enabled;
  const toggleTokenPanel = () => {
    const cur = workingBubbleStore.settings;
    const next = !cur.tokenPanel.enabled;
    workingBubbleStore.updateSettings({
      tokenPanel: { ...cur.tokenPanel, enabled: next },
    });
    emit("bubble-settings-changed", {
      ...cur,
      tokenPanel: { ...cur.tokenPanel, enabled: next },
    }).catch(() => {});
  };

  async function openTokenPanelConfig() {
    props.onClose();
    try {
      const win = await WebviewWindow.getByLabel("main");
      await win?.show();
      await win?.setFocus();
      await emit("navigate", "settings");
      setTimeout(() => emit("navigate-section", "token-panel").catch(() => {}), 120);
    } catch { /* ignore */ }
  }

  async function openTelegramSettings() {
    props.onClose();
    try {
      const win = await WebviewWindow.getByLabel("main");
      await win?.show();
      await win?.setFocus();
      await emit("navigate", "telegram");
    } catch { /* ignore */ }
  }

  async function togglePolling() {
    try {
      await telegramStore.setPollingEnabled(!telegramStore.status.polling_enabled);
    } catch { /* ignore */ }
  }

  async function toggleSending() {
    try {
      await telegramStore.setSendingEnabled(!telegramStore.status.sending_enabled);
    } catch { /* ignore */ }
  }

  // Menu position: flip left/up if near screen edge
  const MENU_W = 200;
  const menuX = () => {
    const x = props.x + 8;
    return x + MENU_W > window.innerWidth ? props.x - MENU_W - 8 : x;
  };
  const menuY = () => {
    // Approximate max height including sliders ~220px
    const y = props.y + 8;
    return y + 220 > window.innerHeight ? props.y - 220 : y;
  };

  return (
    <>
      {/* Backdrop — click outside to close */}
      <div
        class="fixed inset-0"
        style={{ "z-index": 98 }}
        onMouseDown={(e) => { e.stopPropagation(); props.onClose(); }}
        onContextMenu={(e) => { e.preventDefault(); props.onClose(); }}
      />

      {/* Menu panel */}
      <div
        class="fixed rounded-xl shadow-2xl border border-white/10 overflow-hidden select-none"
        style={{
          "z-index": 99,
          left: `${menuX()}px`,
          top: `${menuY()}px`,
          width: `${MENU_W}px`,
          background: "rgba(24, 24, 28, 1)",
          "backdrop-filter": "blur(16px)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Size */}
        <MenuRow
          label="Size"
          icon="⬜"
          hasArrow
          active={expanded() === "size"}
          onClick={() => toggleSlider("size")}
        />
        <Show when={expanded() === "size"}>
          <SliderRow
            value={overlayPositionStore.mascotSize}
            min={80}
            max={400}
            step={10}
            label={`${overlayPositionStore.mascotSize}px`}
            onChange={(v) => overlayPositionStore.setMascotSize(v)}
          />
        </Show>

        {/* Opacity */}
        <MenuRow
          label="Opacity"
          icon="◐"
          hasArrow
          active={expanded() === "opacity"}
          onClick={() => toggleSlider("opacity")}
        />
        <Show when={expanded() === "opacity"}>
          <SliderRow
            value={overlayPositionStore.mascotOpacity * 100}
            min={10}
            max={100}
            step={5}
            label={`${Math.round(overlayPositionStore.mascotOpacity * 100)}%`}
            onChange={(v) => overlayPositionStore.setMascotOpacity(v / 100)}
          />
        </Show>

        {/* Flip Y */}
        <MenuRow
          label="Flip"
          icon="↔"
          onClick={() => { overlayPositionStore.toggleFlipX(); props.onClose(); }}
        />

        {/* Telegram */}
        <Show
          when={telegramConfigured()}
          fallback={
            <MenuRow
              label="Telegram: Disabled"
              icon="○"
              onClick={openTelegramSettings}
            />
          }
        >
          <MenuRow
            label="Telegram"
            iconEl={<Send size={13} />}
            hasArrow
            active={expanded() === "telegram"}
            onClick={() => toggleSlider("telegram")}
          />
          <Show when={expanded() === "telegram"}>
            <CheckboxRow
              label="Bot Active"
              checked={telegramStore.status.polling_enabled}
              onChange={togglePolling}
            />
            <CheckboxRow
              label="Notifications"
              checked={telegramStore.status.sending_enabled}
              disabled={!telegramStore.status.polling_enabled}
              onChange={toggleSending}
            />
            <button
              class="w-full flex items-center gap-2.5 py-2 text-sm transition-colors text-left hover:bg-white/10 bg-white/5"
              style={{ "padding-left": "22px", "padding-right": "12px" }}
              onClick={openTelegramSettings}
            >
              <span class="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>⚙</span>
              <span style={{ "font-size": "13px", "font-family": "system-ui, sans-serif", color: "rgba(255,255,255,0.55)" }}>Config</span>
            </button>
          </Show>
        </Show>

        {/* Token panel */}
        <MenuRow
          label="Token"
          iconEl={<ChartNoAxesColumn size={13} />}
          hasArrow
          active={expanded() === "token"}
          onClick={() => toggleSlider("token")}
        />
        <Show when={expanded() === "token"}>
          <CheckboxRow
            label="Show"
            checked={tokenPanelEnabled()}
            onChange={toggleTokenPanel}
          />
          <button
            class="w-full flex items-center gap-2.5 py-2 text-sm transition-colors text-left hover:bg-white/10 bg-white/5"
            style={{ "padding-left": "22px", "padding-right": "12px" }}
            onClick={openTokenPanelConfig}
          >
            <span class="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>⚙</span>
            <span style={{ "font-size": "13px", "font-family": "system-ui, sans-serif", color: "rgba(255,255,255,0.55)" }}>Config</span>
          </button>
        </Show>

        <div class="h-px bg-white/10 mx-2" />

        {/* Open dashboard */}
        <MenuRow label="Open Dashboard" icon="⊞" onClick={openDashboard} />

        {/* Inspect */}
        <MenuRow label="Inspect" icon="🔍" onClick={openDevTools} />

        <div class="h-px bg-white/10 mx-2" />

        {/* Quit app */}
        <MenuRow label="Quit" icon="✕" onClick={quitApp} danger />
      </div>
    </>
  );
}

function MenuRow(props: {
  label: string;
  icon?: string;
  iconEl?: JSX.Element;
  danger?: boolean;
  hasArrow?: boolean;
  active?: boolean;
  checked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      class="w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left"
      classList={{
        "text-red-400 hover:bg-red-500/15": !!props.danger,
        "text-white/80 hover:bg-white/10": !props.danger,
        "bg-white/10": !!props.active,
      }}
      onClick={props.onClick}
    >
      <span class="w-4 flex items-center justify-center text-xs opacity-90">
        {props.iconEl ?? props.icon}
      </span>
      <span class="flex-1 font-medium" style={{ "font-size": "13px", "font-family": "system-ui, sans-serif" }}>
        {props.label}
      </span>
      <Show when={props.hasArrow}>
        <span class="opacity-40 text-xs">{props.active ? "▲" : "▼"}</span>
      </Show>
      <Show when={props.checked !== undefined && !props.hasArrow}>
        <span class="text-xs" style={{ color: props.checked ? "#fb923c" : "rgba(255,255,255,0.3)" }}>
          {props.checked ? "●" : "○"}
        </span>
      </Show>
    </button>
  );
}

function SliderRow(props: {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  onChange: (v: number) => void;
}) {
  return (
    <div class="px-3 py-2 flex items-center gap-2 bg-white/5">
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        class="flex-1 h-1 accent-orange-400 cursor-pointer"
        onInput={(e) => props.onChange(Number(e.currentTarget.value))}
        style={{ "accent-color": "#fb923c" }}
      />
      <span
        class="text-white/50 tabular-nums"
        style={{ "font-size": "11px", "font-family": "system-ui, sans-serif", "min-width": "36px", "text-align": "right" }}
      >
        {props.label}
      </span>
    </div>
  );
}

function CheckboxRow(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      class="w-full flex items-center gap-2.5 py-2 text-sm transition-colors text-left bg-white/5"
      style={{ "padding-left": "25px", "padding-right": "12px" }}
      classList={{
        "opacity-40 cursor-not-allowed": !!props.disabled,
        "hover:bg-white/10": !props.disabled,
      }}
      onClick={() => { if (!props.disabled) props.onChange(); }}
    >
      <span
        class="w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0"
        style={{
          border: props.checked ? "none" : "1.5px solid rgba(255,255,255,0.35)",
          background: props.checked ? "#fb923c" : "transparent",
        }}
      >
        <Show when={props.checked}>
          <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
            <path d="M1 3.5L3.5 6L8 1" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </Show>
      </span>
      <span style={{ "font-size": "13px", "font-family": "system-ui, sans-serif", "color": "rgba(255,255,255,0.8)" }}>
        {props.label}
      </span>
    </button>
  );
}

// ─── Tool detail extraction ──────────────────────────────────────────────────

/** Extract a short detail string from tool_input for the working bubble.
 *  - Bash → beginning of command: "git add ..."
 *  - Read/Edit/Write/Glob/Grep → end of value: "...long_file_name.txt"
 */
function extractToolDetail(toolName?: string, toolInput?: Record<string, any>): string {
  if (!toolName || !toolInput) return "";
  const name = toolName.toLowerCase();
  const MAX = 25;

  if (name === "bash") {
    const cmd = toolInput.command;
    if (typeof cmd !== "string") return "";
    const trimmed = cmd.trim();
    return trimmed.length > MAX ? trimmed.slice(0, MAX - 3) + "..." : trimmed;
  }

  // File-oriented tools — show the tail of the value
  if (["read", "edit", "multiedit", "write", "glob", "grep"].includes(name)) {
    const raw = toolInput.file_path || toolInput.path || toolInput.pattern || "";
    if (typeof raw !== "string" || !raw) return "";
    return raw.length > MAX ? "..." + raw.slice(-(MAX - 3)) : raw;
  }

  return "";
}

// ─── Main component ───────────────────────────────────────────────────────────

function MascotOverlay() {
  const [stateMachine, setStateMachine] = createSignal<OverlayStateMachine | null>(null);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isHovering, setIsHovering] = createSignal(false);
  const [contextMenu, setContextMenu] = createSignal<{ x: number; y: number } | null>(null);
  const [mascotDisabled, setMascotDisabled] = createSignal(
    localStorage.getItem("masko_mascot_disabled") === "true",
  );

  // Track agent state so we can restore it when switching mascots
  const agentState = {
    isWorking: false,
    isIdle: true,
    isAlert: false,
    isCompacting: false,
  };

  // A/B double-buffer: two video elements, swap opacity when new video is ready
  const [videoRefA, setVideoRefA] = createSignal<HTMLVideoElement | undefined>();
  const [videoRefB, setVideoRefB] = createSignal<HTMLVideoElement | undefined>();
  const [activeSlot, setActiveSlot] = createSignal<"A" | "B">("A");
  let isFirstLoad = true;
  // Idle timeout: if no hook event in 2min, assume agent stopped (e.g. user interrupted)
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      agentState.isWorking = false;
      agentState.isIdle = true;
      agentState.isAlert = false;
      workingBubbleStore.hide();
      const sm = stateMachine();
      if (sm) {
        sm.setAgentStateInputs([
          ["isWorking", conditionBool(false)],
          ["isIdle", conditionBool(true)],
          ["isAlert", conditionBool(false)],
        ]);
      }
    }, 300_000); // 5 minutes
  };
  // Track current video src to avoid reloading the same URL
  let currentVideoSrc = "";

  // Load mascot config from a slug (fetches the bundled JSON)
  async function loadMascotBySlug(slug: string) {
    try {
      const resp = await fetch(`/mascots/${slug}.json`);
      if (!resp.ok) return;
      const raw = await resp.json();
      applyMascotConfig(parseMascotConfig(raw));
    } catch (e) {
      error(`Failed to load mascot "${slug}":`, e);
    }
  }

  // Apply a parsed mascot config — creates new state machine, restores agent state
  function applyMascotConfig(config: ReturnType<typeof parseMascotConfig>) {
    const sm = new OverlayStateMachine(config);
    setStateMachine(sm);
    // Set agent state BEFORE start() so initial evaluation uses correct state
    sm.setAgentStateInput("isWorking", conditionBool(agentState.isWorking));
    sm.setAgentStateInput("isIdle", conditionBool(agentState.isIdle));
    sm.setAgentStateInput("isAlert", conditionBool(agentState.isAlert));
    sm.setAgentStateInput("isCompacting", conditionBool(agentState.isCompacting));
    sm.start(); // arriveAtNode → evaluateAndFire with correct inputs
    log("Mascot switched — restored state:", JSON.stringify(agentState));
  }

  // Load persisted mascot on startup, fallback to clippy
  onMount(async () => {
    // Record the time the overlay opened — token usage is only counted from this point forward
    tokenUsageStore.setMascotOpenTime(new Date().toISOString());

    // Restore mascot position within the fullscreen overlay
    await overlayPositionStore.restorePosition();

    // If starting in disabled mode, sync hit zone with the small icon size
    if (mascotDisabled()) {
      overlayPositionStore.updatePosition(overlayPositionStore.x, overlayPositionStore.y, DISABLED_ICON_SIZE);
    }

    const storedId = localStorage.getItem("overlay_mascot_slug");
    const slug = storedId || "clippy";
    await loadMascotBySlug(slug);
  });

  // Listen for mascot changes from dashboard window
  onMount(async () => {
    const unlisten = await listen<{ slug?: string; config?: any }>("mascot-changed", (e) => {
      const { slug, config } = e.payload;
      if (config) {
        // Dashboard sent the full config — use it directly
        applyMascotConfig(parseMascotConfig(config));
        if (slug) localStorage.setItem("overlay_mascot_slug", slug);
      } else if (slug) {
        loadMascotBySlug(slug);
        localStorage.setItem("overlay_mascot_slug", slug);
      }
    });
    onCleanup(unlisten);
  });

  // Sync state machine → video element reactively using A/B double-buffer.
  // Two <video> elements exist. On URL change, load into the inactive slot;
  // swap opacity only after a frame is actually painted (requestVideoFrameCallback)
  // so the old video stays visible until the new one is truly on-screen — no flicker.
  //
  // Two-phase swap: show the new video FIRST (via direct DOM manipulation),
  // then hide the old video ONE FRAME LATER. This means for exactly one frame
  // both videos overlap (slightly "thicker" mascot with transparent bg) which is
  // nearly invisible, instead of a one-frame gap (flash to nothing) which is very visible.
  const waitForFrameThenSwap = (
    newEl: HTMLVideoElement,
    oldEl: HTMLVideoElement,
    newSlot: "A" | "B",
  ) => {
    const doSwap = () => {
      // Phase 1: Show new video immediately via direct DOM
      newEl.style.opacity = "1";
      // Phase 2: Wait 3 frames for new video to fully stabilize, then hide old
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            oldEl.style.opacity = "0";
            oldEl.pause();
            setActiveSlot(newSlot);
          });
        });
      });
    };

    // requestVideoFrameCallback is supported in Chromium (Tauri/WebView2) —
    // it fires after a video frame is actually presented to the compositor.
    if ("requestVideoFrameCallback" in newEl) {
      (newEl as any).requestVideoFrameCallback(() => doSwap());
    } else {
      requestAnimationFrame(() => requestAnimationFrame(() => doSwap()));
    }
  };

  // When re-enabling mascot, reset video tracking so the loading effect does a fresh load
  // (Show unmounts/remounts video elements, but currentVideoSrc still holds the old URL)
  createEffect(() => {
    if (!mascotDisabled()) {
      currentVideoSrc = "";
      isFirstLoad = true;
    }
  });

  createEffect(() => {
    const sm = stateMachine();
    const elA = videoRefA();
    const elB = videoRefB();
    if (!sm || !elA || !elB) return;
    const url = sm.currentVideoUrl;
    const loop = sm.isLoopVideo;
    const rate = sm.playbackRate;
    if (!url) {
      // No video for this state — keep the last frame visible instead of hiding mascot.
      // Pause the active video so it freezes on its last frame.
      const active = activeSlot() === "A" ? elA : elB;
      active.loop = false;
      active.pause();
      return;
    }

    // Same URL — just update loop/rate on active element
    if (url === currentVideoSrc) {
      const active = activeSlot() === "A" ? elA : elB;
      active.loop = loop;
      active.playbackRate = rate;
      return;
    }
    currentVideoSrc = url;

    if (isFirstLoad) {
      // First load — go directly into slot A, no swap needed
      isFirstLoad = false;
      elA.loop = loop;
      elA.playbackRate = rate;
      elA.src = url;
      elA.load();
      elA.addEventListener("canplay", () => {
        elA.play().catch(() => { });
        elA.style.opacity = "1";
        setActiveSlot("A");
      }, { once: true });
      return;
    }

    // Subsequent loads — load into inactive slot, swap only after frame is painted
    const currentActive = activeSlot();
    const inactiveEl = currentActive === "A" ? elB : elA;
    const activeEl = currentActive === "A" ? elA : elB;
    const inactiveSlot = currentActive === "A" ? "B" as const : "A" as const;

    inactiveEl.loop = loop;
    inactiveEl.playbackRate = rate;
    inactiveEl.src = url;
    inactiveEl.load();
    inactiveEl.addEventListener("canplay", () => {
      // Start playback so the compositor gets a frame
      inactiveEl.play().catch(() => { });
      // Wait for the frame to actually render before swapping
      waitForFrameThenSwap(inactiveEl, activeEl, inactiveSlot);
    }, { once: true });
  });

  // Reset alert state when all permissions are resolved
  createEffect(() => {
    const _count = permissionStore.pendingCountChanged;
    const hasPending = permissionStore.pending.filter((p) => !p.collapsed).length > 0;
    if (!hasPending && agentState.isAlert) {
      agentState.isAlert = false;
      stateMachine()?.setAgentStateInput("isAlert", conditionBool(false));
    }
  });

  // Sync permission visibility to Rust hit-test zone
  createEffect(() => {
    const visible = permissionStore.pending.some((p) => !p.collapsed);
    invoke("set_overlay_permission_visible", { visible }).catch(() => { });
  });

  // Sync working bubble visibility to Rust hit-test zone
  createEffect(() => {
    const visible = workingBubbleStore.state.visible;
    invoke("set_overlay_working_bubble_visible", { visible }).catch(() => { });
  });

  // Sync working bubble bounding box to Rust (handles left/right layout too)
  createEffect(() => {
    const visible = workingBubbleStore.state.visible;
    if (!visible) {
      invoke("update_working_bubble_zone", { x: -1, y: -1, w: 0, h: 0 }).catch(() => { });
      return;
    }
    const l = bubbleLayout(176, 80);
    invoke("update_working_bubble_zone", { x: l.x, y: l.y, w: 176, h: 80 }).catch(() => { });
  });

  // Sync permission bubble bounding box to Rust (handles left/right layout too)
  createEffect(() => {
    const perm = permissionStore.pending.find((p) => !p.collapsed) || null;
    if (!perm) {
      invoke("update_permission_zone", { x: -1, y: -1, w: 0, h: 0 }).catch(() => { });
      return;
    }
    const w = permW();
    const h = permH();
    const l = bubbleLayout(w, h);
    invoke("update_permission_zone", { x: l.x, y: l.y, w, h }).catch(() => { });
  });

  // Click-through: Rust polls cursor and emits zone changes.
  // WM_STYLECHANGING on Rust side prevents frame flash from setIgnoreCursorEvents.
  onMount(async () => {
    const win = getCurrentWindow();
    // Start in click-through mode immediately — don't wait for first cursor zone event
    win.setIgnoreCursorEvents(true).catch(() => { });
    const unlisten = await listen<boolean>("overlay-cursor-zone", (e) => {
      // Don't go click-through while context menu is open
      if (contextMenu()) return;
      const shouldIgnore = e.payload;
      if (shouldIgnore) {
        // Dismiss any open context menu before going click-through
        window.getSelection()?.removeAllRanges();
        (document.activeElement as HTMLElement)?.blur();
      }
      win.setIgnoreCursorEvents(shouldIgnore).catch(() => { });
    });
    onCleanup(unlisten);
  });

  // Listen for hook events → state machine
  onMount(async () => {
    const unlisten = await listen<any>("hook-event", (e) => {
      const sm = stateMachine();
      const event = parseAgentEvent(e.payload);
      const eventType = getEventType(event);
      if (!eventType) return;
      if (eventType === HookEventType.PermissionRequest) return;

      // Reset idle timer on every hook event (detects interrupt → idle after 20s)
      resetIdleTimer();

      // PostToolUse means CLI already accepted — dismiss matching permission
      if (eventType === HookEventType.PostToolUse && event.session_id && event.tool_name) {
        permissionStore.dismissIfCliAccepted(event.session_id, event.tool_name, event.tool_input);
      }

      if (!sm) return;
      switch (eventType) {
        case HookEventType.SessionStart: {
          agentState.isWorking = true;
          agentState.isIdle = false;
          sm.setAgentStateInputs([
            ["isWorking", conditionBool(true)],
            ["isIdle", conditionBool(false)],
          ]);
          const startProject = event.cwd ? event.cwd.replace(/\\/g, "/").split("/").pop() || "" : "";
          workingBubbleStore.showSessionStart(startProject, event.session_id || "");
          break;
        }
        case HookEventType.PreToolUse: {
          agentState.isWorking = true;
          agentState.isIdle = false;
          agentState.isCompacting = false; // tool use and compacting are mutually exclusive
          sm.setAgentStateInputs([
            ["isWorking", conditionBool(true)],
            ["isIdle", conditionBool(false)],
            ["isCompacting", conditionBool(false)],
          ]);
          sm.setAgentEventTrigger(eventType);
          // Show working bubble with tool detail
          const projectName = event.cwd ? event.cwd.replace(/\\/g, "/").split("/").pop() || "" : "";
          const toolDetail = extractToolDetail(event.tool_name, event.tool_input);
          workingBubbleStore.show(
            event.tool_name || "Working",
            projectName,
            event.session_id || "",
            toolDetail,
          );
          break;
        }
        case HookEventType.PostToolUse:
        case HookEventType.PostToolUseFailure: {
          agentState.isWorking = true;
          agentState.isIdle = false;
          agentState.isCompacting = false; // tool use and compacting are mutually exclusive
          // PostToolUse means tool executed — refresh isAlert from actual pending state
          const hasUncollapsed = permissionStore.pending.some((p) => !p.collapsed);
          if (!hasUncollapsed) agentState.isAlert = false;
          sm.setAgentStateInputs([
            ["isWorking", conditionBool(true)],
            ["isIdle", conditionBool(false)],
            ["isCompacting", conditionBool(false)],
            ["isAlert", conditionBool(agentState.isAlert)],
          ]);
          sm.setAgentEventTrigger(eventType);
          // Hide working bubble — tool finished
          workingBubbleStore.hide();
          break;
        }
        case HookEventType.UserPromptSubmit:
          agentState.isWorking = true;
          agentState.isIdle = false;
          sm.setAgentStateInputs([
            ["isWorking", conditionBool(true)],
            ["isIdle", conditionBool(false)],
          ]);
          sm.setAgentEventTrigger(eventType);
          break;
        case HookEventType.Stop:
        case HookEventType.SessionEnd: {
          // Only affect state if the stopped session is the one currently shown
          const activeSessionId = workingBubbleStore.state.sessionId;
          if (activeSessionId && event.session_id && activeSessionId !== event.session_id) break;
          if (idleTimer) clearTimeout(idleTimer);
          agentState.isWorking = false;
          agentState.isIdle = true;
          agentState.isAlert = false;
          const doneProject = event.cwd ? event.cwd.replace(/\\/g, "/").split("/").pop() || "" : "";
          workingBubbleStore.showDone(doneProject);
          sm.setAgentStateInputs([
            ["isWorking", conditionBool(false)],
            ["isIdle", conditionBool(true)],
            ["isAlert", conditionBool(false)],
          ]);
          break;
        }
        case HookEventType.PreCompact:
          agentState.isCompacting = true;
          sm.setAgentStateInput("isCompacting", conditionBool(true));
          break;
        case HookEventType.PostCompact:
          agentState.isCompacting = false;
          sm.setAgentStateInput("isCompacting", conditionBool(false));
          break;
        default:
          sm.setAgentEventTrigger(eventType);
          break;
      }

      // Token usage refresh
      if (event.session_id) {
        const projectNameForToken = event.cwd
          ? event.cwd.replace(/\\/g, "/").split("/").pop() || ""
          : "";
        switch (eventType) {
          case HookEventType.SessionStart:
          case HookEventType.PostToolUse:
          case HookEventType.PostToolUseFailure:
          case HookEventType.Stop:
            tokenUsageStore.refreshSession(
              event.session_id,
              event.transcript_path ?? undefined,
              projectNameForToken,
            );
            break;
          case HookEventType.SessionEnd:
            tokenUsageStore.removeSession(event.session_id);
            break;
        }
      }
    });
    onCleanup(unlisten);
  });

  // Listen for debug state changes from dashboard
  onMount(async () => {
    const unlisten = await listen<string>("debug-set-state", (e) => {
      const sm = stateMachine();
      if (!sm) return;
      const state = e.payload;
      switch (state) {
        case "idle":
          agentState.isWorking = false;
          agentState.isIdle = true;
          agentState.isAlert = false;
          agentState.isCompacting = false;
          workingBubbleStore.hide();
          sm.setAgentStateInputs([
            ["isWorking", conditionBool(false)],
            ["isIdle", conditionBool(true)],
            ["isAlert", conditionBool(false)],
            ["isCompacting", conditionBool(false)],
          ]);
          break;
        case "working":
          agentState.isWorking = true;
          agentState.isIdle = false;
          agentState.isAlert = false;
          agentState.isCompacting = false;
          sm.setAgentStateInputs([
            ["isWorking", conditionBool(true)],
            ["isIdle", conditionBool(false)],
            ["isAlert", conditionBool(false)],
            ["isCompacting", conditionBool(false)],
          ]);
          break;
        case "attention":
          agentState.isWorking = true;
          agentState.isIdle = false;
          agentState.isAlert = true;
          agentState.isCompacting = false;
          sm.setAgentStateInputs([
            ["isWorking", conditionBool(true)],
            ["isIdle", conditionBool(false)],
            ["isAlert", conditionBool(true)],
            ["isCompacting", conditionBool(false)],
          ]);
          break;
        case "thinking":
          agentState.isWorking = true;
          agentState.isIdle = false;
          agentState.isAlert = false;
          agentState.isCompacting = true;
          sm.setAgentStateInputs([
            ["isWorking", conditionBool(true)],
            ["isIdle", conditionBool(false)],
            ["isAlert", conditionBool(false)],
            ["isCompacting", conditionBool(true)],
          ]);
          break;
      }
    });
    onCleanup(unlisten);
  });

  // Listen for permission requests
  onMount(async () => {
    const unlisten = await listen<any>("permission-request", (e) => {
      const event = parseAgentEvent(e.payload);
      if (event.request_id) {
        permissionStore.add(event, event.request_id);
        workingBubbleStore.hide();
        agentState.isAlert = true;
        stateMachine()?.setAgentStateInput("isAlert", conditionBool(true));
        stateMachine()?.setAgentEventTrigger("PermissionRequest");
      }
    });
    onCleanup(unlisten);
  });

  // Listen for mascot disabled toggle from dashboard
  onMount(async () => {
    const unlisten = await listen<{ disabled: boolean }>("mascot-disabled", (e) => {
      const disabled = e.payload.disabled;
      if (disabled === mascotDisabled()) return;
      setMascotDisabled(disabled);
      // Only sync hit zone to Rust — don't change position
      const size = disabled ? DISABLED_ICON_SIZE : overlayPositionStore.mascotSize;
      invoke("update_mascot_position", {
        x: overlayPositionStore.x,
        y: overlayPositionStore.y,
        w: size,
        h: size,
      }).catch(() => {});
    });
    onCleanup(unlisten);
  });

  // Listen for bubble settings changes from dashboard
  onMount(async () => {
    const unlisten = await listen<any>("bubble-settings-changed", (e) => {
      workingBubbleStore.updateSettings(e.payload);
    });
    onCleanup(unlisten);
  });

  // Listen for custom input events
  onMount(async () => {
    const unlisten = await listen<any>("input-event", (e) => {
      const sm = stateMachine();
      if (!sm) return;
      const { name, value } = e.payload;
      if (typeof value === "boolean") sm.setInput(name, conditionBool(value));
      else if (typeof value === "number") sm.setInput(name, conditionNumber(value));
    });
    onCleanup(unlisten);
  });

  // Listen for permission dismissals from backend (timeout / CLI accepted)
  onMount(async () => {
    const unlisten = await listen<{ request_id: string }>("permission-dismissed", (e) => {
      permissionStore.dismissByRequestId(e.payload.request_id);
    });
    onCleanup(unlisten);
  });

  const DRAG_THRESHOLD = 3;

  const handleMouseDown = (e: MouseEvent) => {
    if (e.buttons !== 1) return;
    e.preventDefault();

    // All drag state is local to this gesture — prevents cross-gesture clobber
    const startX = e.clientX;
    const startY = e.clientY;
    const offsetX = e.clientX - overlayPositionStore.x;
    const offsetY = e.clientY - overlayPositionStore.y;
    let moved = false;

    // Force interactive during drag so fast mouse movement doesn't trigger click-through
    invoke("set_overlay_dragging", { dragging: true }).catch(() => { });
    getCurrentWindow().setIgnoreCursorEvents(false).catch(() => { });

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      moved = true;
      if (!isDragging()) setIsDragging(true);
      // When disabled, clamp and sync using the small icon size
      const sizeOverride = mascotDisabled() ? DISABLED_ICON_SIZE : undefined;
      overlayPositionStore.updatePosition(ev.clientX - offsetX, ev.clientY - offsetY, sizeOverride);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setIsDragging(false);
      invoke("set_overlay_dragging", { dragging: false }).catch(() => { });

      if (moved) {
        overlayPositionStore.persistPosition();
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
    // Keep window interactive while menu is open
    invoke("set_overlay_dragging", { dragging: true }).catch(() => { });
    getCurrentWindow().setIgnoreCursorEvents(false).catch(() => { });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
    invoke("set_overlay_dragging", { dragging: false }).catch(() => { });
  };

  const handleClick = () => stateMachine()?.handleClick();
  const handleMouseEnter = () => { setIsHovering(true); stateMachine()?.handleMouseOver(true); };
  const handleMouseLeave = () => { setIsHovering(false); stateMachine()?.handleMouseOver(false); };
  const handleVideoEnded = (el: HTMLVideoElement) => {
    // Only handle ended for the currently active video
    const active = activeSlot() === "A" ? videoRefA() : videoRefB();
    if (el !== active) return;
    const sm = stateMachine();
    if (sm && !sm.isLoopVideo) sm.handleVideoEnded();
  };

  // When disabled, use a fixed small icon size for layout calculations
  const DISABLED_ICON_SIZE = 44;
  const effectiveSize = () => mascotDisabled() ? DISABLED_ICON_SIZE : overlayPositionStore.mascotSize;

  // Popup layout: depends on mascot position within the screen
  const GAP = 4;

  const bubbleLayout = (popupW: number, popupH: number): { x: number; y: number; tail: TailDir } => {
    const mx = overlayPositionStore.x;
    const my = overlayPositionStore.y;
    const MASCOT = effectiveSize();
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    // Try bubble above first — only fall back to side if it would hit the ceiling
    const fitsAbove = my - GAP - popupH >= 0;

    if (fitsAbove) {
      const x = Math.max(8, Math.min(mx + MASCOT / 2 - popupW / 2, screenW - popupW - 8));
      const y = my - popupH - GAP;
      return { x, y, tail: "down" };
    }

    // Not enough room above → place to the side
    const inLeftHalf = mx + MASCOT / 2 < screenW / 2;
    if (inLeftHalf) {
      const x = Math.min(mx + MASCOT, screenW - popupW - TAIL_SIZE - 8);
      const y = Math.max(8, Math.min(my + MASCOT / 2 - popupH / 2, screenH - popupH - 8));
      return { x, y, tail: "left" };
    } else {
      const x = Math.max(8, mx - popupW - TAIL_SIZE);
      const y = Math.max(8, Math.min(my + MASCOT / 2 - popupH / 2, screenH - popupH - 8));
      return { x, y, tail: "right" };
    }
  };

  // Token panel is pinned directly below the mascot, horizontally centered.
  // The outer wrapper uses a CSS transform so we don't need to measure the
  // panel's actual width — translateX(-50%) centers any width.
  const TOKEN_PANEL_GAP = -10;

  // Token panel element ref (for hit-test zone registration so the panel
  // receives mouse events through the overlay's click-through layer).
  const [tokenPanelEl, setTokenPanelEl] = createSignal<HTMLDivElement | null>(null);

  createEffect(() => {
    const el = tokenPanelEl();
    if (!el) {
      invoke("set_overlay_token_panel_visible", { visible: false }).catch(() => { });
      invoke("update_token_panel_zone", { x: -1, y: -1, w: 0, h: 0 }).catch(() => { });
      return;
    }
    const push = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        invoke("set_overlay_token_panel_visible", { visible: false }).catch(() => { });
        invoke("update_token_panel_zone", { x: -1, y: -1, w: 0, h: 0 }).catch(() => { });
        return;
      }
      invoke("set_overlay_token_panel_visible", { visible: true }).catch(() => { });
      invoke("update_token_panel_zone", {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      }).catch(() => { });
    };
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    onCleanup(() => {
      ro.disconnect();
      invoke("set_overlay_token_panel_visible", { visible: false }).catch(() => { });
      invoke("update_token_panel_zone", { x: -1, y: -1, w: 0, h: 0 }).catch(() => { });
    });
  });

  // Re-push token panel zone when mascot moves (wrapper position changes
  // but its own size hasn't, so ResizeObserver won't fire).
  createEffect(() => {
    const _x = overlayPositionStore.x;
    const _y = overlayPositionStore.y;
    const _s = effectiveSize();
    const el = tokenPanelEl();
    if (!el) return;
    // Defer to next frame so the CSS transform/left/top have been applied
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      invoke("update_token_panel_zone", {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      }).catch(() => { });
    });
  });

  // Permission expand/collapse state
  const [permExpanded, setPermExpanded] = createSignal(false);
  const togglePermExpanded = () => setPermExpanded((prev) => !prev);

  // Reset expanded state when permission changes
  createEffect(() => {
    const _perm = permissionStore.pending.find((p) => !p.collapsed);
    setPermExpanded(false);
  });

  // Permission bubble dimensions — defaults used until ResizeObserver reports actual rendered size
  const PERM_W_NORMAL = 288;
  const PERM_W_EXPANDED = PERM_W_NORMAL * 1.5;  // 1.5x
  const PERM_H_NORMAL = 280;
  const PERM_H_EXPANDED = PERM_H_NORMAL * 2;  // 2x
  // Actual measured size (CSS px) of the rendered permission bubble — overrides defaults when > 0
  const [permActualW, setPermActualW] = createSignal(0);
  const [permActualH, setPermActualH] = createSignal(0);
  const permW = () => permActualW() > 0 ? permActualW() : (permExpanded() ? PERM_W_EXPANDED : PERM_W_NORMAL);
  const permH = () => permActualH() > 0 ? permActualH() : (permExpanded() ? PERM_H_EXPANDED : PERM_H_NORMAL);

  // Queue: show only the first uncollapsed permission
  const currentPermission = () =>
    permissionStore.pending.find((p) => !p.collapsed) || null;
  const queueCount = () =>
    permissionStore.pending.filter((p) => !p.collapsed).length;

  return (
    <div
      class="fixed inset-0 select-none"
      style={{ background: "transparent" }}
    >
      {/* Working bubble — floats near mascot */}
      <Show when={workingBubbleStore.state.visible && !currentPermission()}>
        {(() => {
          const l = () => bubbleLayout(176, 80);
          return (
            <div class="absolute flex"
              classList={{ "flex-col justify-end": l().tail === "down" }}
              style={{
                "z-index": 15,
                left: `${l().x}px`,
                top: `${l().y}px`,
                ...(l().tail === "down" ? { height: `${overlayPositionStore.y - l().y}px` } : {}),
              }}
            >
              <WorkingBubble tailDir={l().tail} />
            </div>
          );
        })()}
      </Show>

      {/* Token usage panel — pinned directly below the mascot */}
      <Show when={workingBubbleStore.settings.tokenPanel.enabled}>
        <div
          class="absolute"
          ref={(el) => setTokenPanelEl(el)}
          style={{
            "z-index": 14,
            left: `${overlayPositionStore.x + effectiveSize() / 2}px`,
            top: `${overlayPositionStore.y + effectiveSize() + TOKEN_PANEL_GAP}px`,
            transform: "translateX(-50%)",
          }}
        >
          <TokenPanel
            appearance={workingBubbleStore.settings.appearance}
            tokenSettings={workingBubbleStore.settings.tokenPanel}
          />
        </div>
      </Show>

      {/* Permission bubble — floats near mascot */}
      <Show when={currentPermission()}>
        {(perm) => {
          const l = () => bubbleLayout(permW(), permH());
          let promptRef: HTMLDivElement | undefined;
          // Reset measurements whenever permission changes (different content size)
          setPermActualW(0);
          setPermActualH(0);
          onMount(() => {
            if (!promptRef) return;
            const ro = new ResizeObserver((entries) => {
              for (const entry of entries) {
                const rect = entry.contentRect;
                if (rect.width > 0 && rect.height > 0) {
                  setPermActualW(Math.ceil(rect.width));
                  setPermActualH(Math.ceil(rect.height));
                }
              }
            });
            ro.observe(promptRef);
            onCleanup(() => ro.disconnect());
          });
          return (
            <div class="absolute flex"
              classList={{ "flex-col justify-end": l().tail === "down" }}
              style={{
                "z-index": 20,
                left: `${l().x}px`,
                top: `${l().y}px`,
                ...(l().tail === "down" ? { height: `${overlayPositionStore.y - l().y}px` } : {}),
              }}
            >
              <div ref={(el) => { promptRef = el; }}>
              <PermissionPrompt
                permission={perm()}
                tailDir={l().tail}
                expanded={permExpanded()}
                onToggleExpand={togglePermExpanded}
              />
              </div>

              <Show when={queueCount() > 1}>
                <div class="absolute top-1 right-3 bg-orange-primary text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {queueCount()}
                </div>
              </Show>
            </div>
          );
        }}
      </Show>

      {/* Mascot — either full video or small icon when disabled */}
      <Show
        when={!mascotDisabled()}
        fallback={
          /* Disabled: small fixed-size icon — bubbles stay close */
          <div
            class="absolute cursor-grab flex items-center justify-center rounded-xl"
            classList={{ "cursor-grabbing": isDragging() }}
            style={{
              left: `${overlayPositionStore.x}px`,
              top: `${overlayPositionStore.y}px`,
              width: `${DISABLED_ICON_SIZE}px`,
              height: `${DISABLED_ICON_SIZE}px`,
              opacity: String(overlayPositionStore.mascotOpacity),
              background: isHovering() ? (workingBubbleStore.settings.appearance.hoverColor || "rgba(255,176,72,0.45)") : "transparent",
              transition: "background 0.15s",
            }}
            onMouseDown={handleMouseDown}
            onContextMenu={handleContextMenu}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            <img
              src="/logo.png"
              alt="Masko"
              style={{
                width: "28px",
                height: "28px",
                "object-fit": "contain",
                opacity: isHovering() ? "1" : "1",
                transition: "opacity 0.15s",
                "pointer-events": "none",
                "user-select": "none",
              }}
            />
          </div>
        }
      >
        {/* Mascot video — dynamically positioned and sized */}
        <div
          class="absolute cursor-grab rounded-2xl transition-colors duration-200"
          classList={{ "cursor-grabbing": isDragging() }}
          style={{
            left: `${overlayPositionStore.x}px`,
            top: `${overlayPositionStore.y}px`,
            width: `${overlayPositionStore.mascotSize}px`,
            height: `${overlayPositionStore.mascotSize}px`,
            opacity: String(overlayPositionStore.mascotOpacity),
            background: isHovering() ? (workingBubbleStore.settings.appearance.hoverColor || "rgba(255,176,72,0.45)") : "transparent",
          }}
          onMouseDown={handleMouseDown}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* A/B double-buffer: two videos stacked, two-phase swap for flicker-free transitions.
               Opacity starts at 0 and is controlled purely by JS (waitForFrameThenSwap). */}
          <video
            ref={setVideoRefA}
            muted
            playsinline
            onEnded={(e) => handleVideoEnded(e.currentTarget)}
            style={{
              position: "absolute",
              inset: "0",
              width: "100%",
              height: "100%",
              "object-fit": "contain",
              background: "transparent",
              opacity: "0",
              transition: "none",
              "will-change": "opacity",
              "pointer-events": activeSlot() === "A" ? "auto" : "none",
              transform: overlayPositionStore.flipX ? "scaleX(-1)" : "none",
            }}
          />
          <video
            ref={setVideoRefB}
            muted
            playsinline
            onEnded={(e) => handleVideoEnded(e.currentTarget)}
            style={{
              position: "absolute",
              inset: "0",
              width: "100%",
              height: "100%",
              "object-fit": "contain",
              background: "transparent",
              opacity: "0",
              transition: "none",
              "will-change": "opacity",
              "pointer-events": activeSlot() === "B" ? "auto" : "none",
              transform: overlayPositionStore.flipX ? "scaleX(-1)" : "none",
            }}
          />
        </div>
      </Show>

      {/* Context menu */}
      <Show when={contextMenu()}>
        {(menu) => (
          <ContextMenu
            x={menu().x}
            y={menu().y}
            onClose={closeContextMenu}
          />
        )}
      </Show>
    </div>
  );
}

export default MascotOverlay;
