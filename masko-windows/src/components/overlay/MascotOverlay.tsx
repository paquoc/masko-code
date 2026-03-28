import { createSignal, createEffect, onMount, onCleanup, Show } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { OverlayStateMachine } from "../../services/state-machine";
import { parseMascotConfig } from "../../models/mascot-config";
import { parseAgentEvent, HookEventType, getEventType } from "../../models/agent-event";
import { conditionBool, conditionNumber } from "../../models/types";
import { permissionStore } from "../../stores/permission-store";
import PermissionPrompt from "./PermissionPrompt";

// interface UsageData {
//   session_percent: number | null;
//   session_resets_at: string | null;
//   weekly_percent: number | null;
//   weekly_resets_at: string | null;
// }

function MascotOverlay() {
  const [stateMachine, setStateMachine] = createSignal<OverlayStateMachine | null>(null);
  const [videoUrl, setVideoUrl] = createSignal<string | null>(null);
  const [isLoop, setIsLoop] = createSignal(true);
  const [playbackRate, setPlaybackRate] = createSignal(1.0);
  const [isDragging, setIsDragging] = createSignal(false);
  // const [usage, setUsage] = createSignal<UsageData | null>(null); // temporarily disabled

  // Track agent state so we can restore it when switching mascots
  const agentState = {
    isWorking: false,
    isIdle: true,
    isAlert: false,
    isCompacting: false,
  };

  let videoRef: HTMLVideoElement | undefined;
  // Idle timeout: if no hook event in 20s, assume agent stopped (e.g. user interrupted)
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      agentState.isWorking = false;
      agentState.isIdle = true;
      agentState.isAlert = false;
      const sm = stateMachine();
      if (sm) {
        sm.setAgentStateInput("isWorking", conditionBool(false));
        sm.setAgentStateInput("isIdle", conditionBool(true));
        sm.setAgentStateInput("isAlert", conditionBool(false));
      }
    }, 20_000);
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
      console.error(`[masko] Failed to load mascot "${slug}":`, e);
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
    console.log("[masko] Mascot switched — restored state:", JSON.stringify(agentState));
  }

  // Load persisted mascot on startup, fallback to clippy
  onMount(async () => {
    // Check if dashboard has stored a mascot slug preference
    // We can't access localStorage across windows, so read from the
    // mascot-changed event or fall back to stored slug
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

  // Sync state machine → video signals (only when changed)
  createEffect(() => {
    const sm = stateMachine();
    if (!sm) return;
    const interval = setInterval(() => {
      const newUrl = sm.currentVideoUrl;
      const newLoop = sm.isLoopVideo;
      const newRate = sm.playbackRate;
      // Only update signals when values actually change
      if (newUrl !== videoUrl()) setVideoUrl(newUrl);
      if (newLoop !== isLoop()) setIsLoop(newLoop);
      if (newRate !== playbackRate()) setPlaybackRate(newRate);
    }, 100);
    onCleanup(() => clearInterval(interval));
  });

  // Update video element ONLY when URL actually changes
  createEffect(() => {
    const url = videoUrl();
    if (!videoRef || !url) return;
    if (url === currentVideoSrc) {
      // URL same — just update loop/rate without restarting
      videoRef.loop = isLoop();
      videoRef.playbackRate = playbackRate();
      return;
    }
    // New URL — load it
    currentVideoSrc = url;
    videoRef.src = url;
    videoRef.loop = isLoop();
    videoRef.playbackRate = playbackRate();
    videoRef.play().catch(() => {});
  });

  // Window is always 320x520 — no resize needed, just show/hide bubble via CSS
  // Reset alert state when all permissions are resolved
  createEffect(() => {
    const hasPending = permissionStore.pending.filter((p) => !p.collapsed).length > 0;
    if (!hasPending) {
      agentState.isAlert = false;
      stateMachine()?.setAgentStateInput("isAlert", conditionBool(false));
    }
  });

  // Sync permission visibility to Rust hit-test zone
  createEffect(() => {
    const visible = permissionStore.pending.some((p) => !p.collapsed);
    invoke("set_overlay_permission_visible", { visible }).catch(() => {});
  });

  // Click-through: Rust polls cursor position and emits whether overlay should ignore events.
  onMount(async () => {
    const win = getCurrentWindow();
    const unlisten = await listen<boolean>("overlay-cursor-zone", (e) => {
      win.setIgnoreCursorEvents(e.payload).catch(() => {});
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
        permissionStore.dismissIfCliAccepted(event.session_id, event.tool_name);
      }

      if (!sm) return;
      switch (eventType) {
        case HookEventType.SessionStart:
          agentState.isWorking = true;
          agentState.isIdle = false;
          sm.setAgentStateInput("isWorking", conditionBool(true));
          sm.setAgentStateInput("isIdle", conditionBool(false));
          break;
        case HookEventType.PreToolUse:
        case HookEventType.UserPromptSubmit:
          agentState.isWorking = true;
          agentState.isIdle = false;
          sm.setAgentStateInput("isWorking", conditionBool(true));
          sm.setAgentStateInput("isIdle", conditionBool(false));
          sm.setAgentEventTrigger(eventType);
          break;
        case HookEventType.Stop:
        case HookEventType.SessionEnd:
          if (idleTimer) clearTimeout(idleTimer);
          agentState.isWorking = false;
          agentState.isIdle = true;
          agentState.isAlert = false;
          sm.setAgentStateInput("isWorking", conditionBool(false));
          sm.setAgentStateInput("isIdle", conditionBool(true));
          sm.setAgentStateInput("isAlert", conditionBool(false));
          break;
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
    });
    onCleanup(unlisten);
  });

  // Listen for permission requests
  onMount(async () => {
    const unlisten = await listen<any>("permission-request", (e) => {
      const event = parseAgentEvent(e.payload);
      if (event.request_id) {
        permissionStore.add(event, event.request_id);
        agentState.isAlert = true;
        stateMachine()?.setAgentStateInput("isAlert", conditionBool(true));
        stateMachine()?.setAgentEventTrigger("PermissionRequest");
      }
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

  // TODO: temporarily disabled — usage API not ready yet
  // onMount(async () => {
  //   const unlisten = await listen<UsageData>("usage-update", (e) => {
  //     console.log("[masko-overlay] usage-update received:", JSON.stringify(e.payload));
  //     setUsage(e.payload);
  //   });
  //   onCleanup(unlisten);
  //   invoke("fetch_usage").catch((e) => console.warn("[masko-overlay] fetch_usage failed:", e));
  // });

  // const formatPercent = (v: number | null) =>
  //   v != null ? `${Math.round(v * 100)}%` : "--";
  //
  // const usageColor = (v: number | null) => {
  //   if (v == null) return "#888";
  //   if (v >= 0.8) return "#ef4444"; // red
  //   if (v >= 0.5) return "#f59e0b"; // amber
  //   return "#22c55e"; // green
  // };

  const handleMouseDown = async (e: MouseEvent) => {
    if (e.buttons === 1) {
      setIsDragging(true);
      await getCurrentWindow().startDragging();
      setIsDragging(false);
    }
  };

  const handleClick = () => stateMachine()?.handleClick();
  const handleMouseEnter = () => stateMachine()?.handleMouseOver(true);
  const handleMouseLeave = () => stateMachine()?.handleMouseOver(false);
  const handleVideoEnded = () => {
    if (!isLoop()) stateMachine()?.handleVideoEnded();
  };

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
      {/* Permission bubble — floats above mascot */}
      <Show when={currentPermission()}>
        {(perm) => (
          <div class="absolute bottom-[200px] left-0 right-0 px-2 pb-1 overflow-hidden"
            style={{ "z-index": 20 }}
          >
            <PermissionPrompt permission={perm()} />

            <Show when={queueCount() > 1}>
              <div class="absolute top-1 right-3 bg-orange-primary text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {queueCount()}
              </div>
            </Show>
          </div>
        )}
      </Show>

      {/* Mascot video — pinned to bottom */}
      <div
        class="absolute bottom-0 left-1/2 -translate-x-1/2 w-[200px] h-[200px] cursor-grab"
        classList={{ "cursor-grabbing": isDragging() }}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Show
          when={videoUrl()}
          fallback={
            <div class="w-full h-full flex items-center justify-center">
              <div class="w-24 h-24 rounded-full bg-orange-primary/20 flex items-center justify-center animate-pulse">
                <span class="text-3xl">🦊</span>
              </div>
            </div>
          }
        >
          <video
            ref={videoRef}
            autoplay
            muted
            playsinline
            onEnded={handleVideoEnded}
            style={{
              width: "100%",
              height: "100%",
              "object-fit": "contain",
              background: "transparent",
            }}
          />
        </Show>

        {/* Usage bar — temporarily disabled */}
      </div>
    </div>
  );
}

export default MascotOverlay;
