import { createSignal, createEffect, onMount, onCleanup, Show } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { OverlayStateMachine } from "../../services/state-machine";
import { parseMascotConfig } from "../../models/mascot-config";
import { type AgentEvent, parseAgentEvent, HookEventType, getEventType } from "../../models/agent-event";
import { conditionBool, conditionNumber } from "../../models/types";

function MascotOverlay() {
  const [stateMachine, setStateMachine] = createSignal<OverlayStateMachine | null>(null);
  const [videoUrl, setVideoUrl] = createSignal<string | null>(null);
  const [isLoop, setIsLoop] = createSignal(true);
  const [playbackRate, setPlaybackRate] = createSignal(1.0);
  const [isDragging, setIsDragging] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);

  let videoRef: HTMLVideoElement | undefined;

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
      setLoaded(true);
    } catch (e) {
      console.error("[masko] Failed to load mascot config:", e);
    }
  });

  // Sync state machine signals → component signals
  createEffect(() => {
    const sm = stateMachine();
    if (!sm) return;

    // Poll reactive signals from state machine
    const interval = setInterval(() => {
      setVideoUrl(sm.currentVideoUrl);
      setIsLoop(sm.isLoopVideo);
      setPlaybackRate(sm.playbackRate);
    }, 50);

    onCleanup(() => clearInterval(interval));
  });

  // Update video element when URL changes
  createEffect(() => {
    const url = videoUrl();
    if (videoRef && url) {
      videoRef.src = url;
      videoRef.playbackRate = playbackRate();
      videoRef.loop = isLoop();
      videoRef.play().catch(() => {});
    }
  });

  // Listen for hook events → update state machine
  onMount(async () => {
    const unlisten = await listen<any>("hook-event", (e) => {
      const sm = stateMachine();
      if (!sm) return;

      const event = parseAgentEvent(e.payload);
      const eventType = getEventType(event);
      if (!eventType) return;

      // Update state machine inputs based on event type
      switch (eventType) {
        case HookEventType.SessionStart:
          sm.setAgentStateInput("isWorking", conditionBool(true));
          sm.setAgentStateInput("isIdle", conditionBool(false));
          sm.setAgentStateInput(
            "sessionCount",
            conditionNumber(
              1, // Will be updated by session store
            ),
          );
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
        case HookEventType.PermissionRequest:
          sm.setAgentStateInput("isAlert", conditionBool(true));
          sm.setAgentEventTrigger(eventType);
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

  // Listen for custom input events
  onMount(async () => {
    const unlisten = await listen<any>("input-event", (e) => {
      const sm = stateMachine();
      if (!sm) return;
      const { name, value } = e.payload;
      if (typeof value === "boolean") {
        sm.setInput(name, conditionBool(value));
      } else if (typeof value === "number") {
        sm.setInput(name, conditionNumber(value));
      }
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

  const handleClick = () => {
    stateMachine()?.handleClick();
  };

  const handleMouseEnter = () => {
    stateMachine()?.handleMouseOver(true);
  };

  const handleMouseLeave = () => {
    stateMachine()?.handleMouseOver(false);
  };

  const handleVideoEnded = () => {
    if (!isLoop()) {
      stateMachine()?.handleVideoEnded();
    }
  };

  const handleVideoLoop = () => {
    if (isLoop()) {
      stateMachine()?.handleLoopCycleCompleted();
    }
  };

  return (
    <div
      class="w-full h-full flex items-center justify-center cursor-grab select-none"
      classList={{ "cursor-grabbing": isDragging() }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ background: "transparent" }}
    >
      <Show
        when={videoUrl()}
        fallback={
          <div class="w-24 h-24 rounded-full bg-orange-primary/20 flex items-center justify-center animate-pulse">
            <span class="text-3xl">🦊</span>
          </div>
        }
      >
        <video
          ref={videoRef}
          autoplay
          muted
          playsinline
          onEnded={handleVideoEnded}
          onSeeked={handleVideoLoop}
          style={{
            width: "100%",
            height: "100%",
            "object-fit": "contain",
            background: "transparent",
          }}
        />
      </Show>
    </div>
  );
}

export default MascotOverlay;
