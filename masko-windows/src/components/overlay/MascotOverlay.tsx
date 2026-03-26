import { createSignal, createEffect, onMount, onCleanup, Show, For } from "solid-js";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { OverlayStateMachine } from "../../services/state-machine";
import { parseMascotConfig } from "../../models/mascot-config";
import { parseAgentEvent, HookEventType, getEventType } from "../../models/agent-event";
import { conditionBool, conditionNumber } from "../../models/types";
import { permissionStore } from "../../stores/permission-store";
import PermissionPrompt from "./PermissionPrompt";

function MascotOverlay() {
  const [stateMachine, setStateMachine] = createSignal<OverlayStateMachine | null>(null);
  const [videoUrl, setVideoUrl] = createSignal<string | null>(null);
  const [isLoop, setIsLoop] = createSignal(true);
  const [playbackRate, setPlaybackRate] = createSignal(1.0);
  const [isDragging, setIsDragging] = createSignal(false);

  let videoRef: HTMLVideoElement | undefined;
  // Track current video src to avoid reloading the same URL
  let currentVideoSrc = "";

  // Load default mascot config
  onMount(async () => {
    try {
      const resp = await fetch("/src/assets/mascots/clippy.json");
      if (!resp.ok) return;
      const raw = await resp.json();
      const config = parseMascotConfig(raw);
      const sm = new OverlayStateMachine(config);
      setStateMachine(sm);
      sm.start();
    } catch (e) {
      console.error("[masko] Failed to load mascot config:", e);
    }
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

  // Resize window when permissions appear/disappear
  createEffect(() => {
    const hasPending = permissionStore.pending.filter((p) => !p.collapsed).length > 0;
    const win = getCurrentWindow();
    if (hasPending) {
      win.setSize(new LogicalSize(320, 520)).catch(() => {});
    } else {
      win.setSize(new LogicalSize(200, 200)).catch(() => {});
    }
  });

  // Prevent window activation on click — re-strip focus when it happens
  onMount(async () => {
    const win = getCurrentWindow();
    const unlisten = await win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        // Window got focused (user clicked) — immediately unfocus
        // This prevents Windows from drawing the active title bar
        win.setFocus().catch(() => {}); // no-op but triggers internal state
        // Use blur trick: set to not-focusable
        win.setAlwaysOnTop(true).catch(() => {});
      }
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

      if (!sm) return;
      switch (eventType) {
        case HookEventType.SessionStart:
          sm.setAgentStateInput("isWorking", conditionBool(true));
          sm.setAgentStateInput("isIdle", conditionBool(false));
          break;
        case HookEventType.PreToolUse:
        case HookEventType.UserPromptSubmit:
          sm.setAgentStateInput("isWorking", conditionBool(true));
          sm.setAgentStateInput("isIdle", conditionBool(false));
          sm.setAgentEventTrigger(eventType);
          break;
        case HookEventType.Stop:
        case HookEventType.SessionEnd:
          sm.setAgentStateInput("isWorking", conditionBool(false));
          sm.setAgentStateInput("isIdle", conditionBool(true));
          sm.setAgentStateInput("isAlert", conditionBool(false));
          break;
        case HookEventType.PreCompact:
          sm.setAgentStateInput("isCompacting", conditionBool(true));
          break;
        case HookEventType.PostCompact:
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

  const visiblePermissions = () =>
    permissionStore.pending.filter((p) => !p.collapsed).slice().reverse();

  return (
    <div
      class="w-full h-full flex flex-col items-center justify-end select-none"
      style={{ background: "transparent" }}
    >
      {/* Permission bubbles — stacked above mascot */}
      <Show when={visiblePermissions().length > 0}>
        <div class="flex-1 flex flex-col justify-end items-center w-full px-2 pb-1 overflow-hidden">
          <For each={visiblePermissions().slice(0, 3)}>
            {(perm, idx) => (
              <div
                classList={{
                  "opacity-50 scale-95 -mb-2": idx() > 0,
                  "opacity-100": idx() === 0,
                }}
                style={{ transition: "all 0.2s ease" }}
              >
                <Show
                  when={idx() === 0}
                  fallback={
                    <div
                      class="w-64 h-6 bg-white rounded-t-lg border border-border opacity-60 mx-auto"
                      style={{ "box-shadow": "0 -1px 4px rgba(35,17,60,0.08)" }}
                    />
                  }
                >
                  <PermissionPrompt permission={perm} />
                </Show>
              </div>
            )}
          </For>

          <Show when={permissionStore.pending.length > 1}>
            <div class="absolute top-1 right-1 bg-orange-primary text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {permissionStore.pending.length}
            </div>
          </Show>
        </div>
      </Show>

      {/* Mascot video */}
      <div
        class="w-[200px] h-[200px] flex-shrink-0 cursor-grab"
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
      </div>
    </div>
  );
}

export default MascotOverlay;
