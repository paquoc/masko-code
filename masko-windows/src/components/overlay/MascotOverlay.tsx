import { createSignal, createEffect, onMount, onCleanup, Show } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { OverlayStateMachine } from "../../services/state-machine";
import { parseMascotConfig } from "../../models/mascot-config";
import { parseAgentEvent, HookEventType, getEventType } from "../../models/agent-event";
import { conditionBool, conditionNumber } from "../../models/types";
import { permissionStore } from "../../stores/permission-store";
import { workingBubbleStore } from "../../stores/working-bubble-store";
import { overlayPositionStore } from "../../stores/overlay-position-store";
import { log, error } from "../../services/log";
import PermissionPrompt from "./PermissionPrompt";
import WorkingBubble from "./WorkingBubble";

function MascotOverlay() {
  const [stateMachine, setStateMachine] = createSignal<OverlayStateMachine | null>(null);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isHovering, setIsHovering] = createSignal(false);

  // Track agent state so we can restore it when switching mascots
  const agentState = {
    isWorking: false,
    isIdle: true,
    isAlert: false,
    isCompacting: false,
  };

  const [videoRef, setVideoRef] = createSignal<HTMLVideoElement | undefined>();
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
    }, 120_000);
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
    // Restore mascot position within the fullscreen overlay
    await overlayPositionStore.restorePosition();

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

  // Sync state machine → video element reactively (no polling)
  // State machine properties are Solid signals — reading them in createEffect
  // automatically tracks changes and re-runs only when values actually change.
  createEffect(() => {
    const sm = stateMachine();
    const el = videoRef();
    if (!sm || !el) return;
    const url = sm.currentVideoUrl;
    const loop = sm.isLoopVideo;
    const rate = sm.playbackRate;
    if (!url) return;
    if (url === currentVideoSrc) {
      el.loop = loop;
      el.playbackRate = rate;
      return;
    }
    currentVideoSrc = url;
    el.src = url;
    el.loop = loop;
    el.playbackRate = rate;
    el.play().catch(() => {});
  });

  // Reset alert state when all permissions are resolved
  // Use pendingCountChanged signal as explicit dependency — Solid store array
  // tracking can miss filter().length changes when array goes from 1→0 elements.
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
    invoke("set_overlay_permission_visible", { visible }).catch(() => {});
  });

  // Sync working bubble visibility to Rust hit-test zone
  createEffect(() => {
    const visible = workingBubbleStore.state.visible;
    invoke("set_overlay_working_bubble_visible", { visible }).catch(() => {});
  });

  // Click-through: Rust polls cursor and emits zone changes.
  // WM_STYLECHANGING on Rust side prevents frame flash from setIgnoreCursorEvents.
  onMount(async () => {
    const win = getCurrentWindow();
    const unlisten = await listen<boolean>("overlay-cursor-zone", (e) => {
      const shouldIgnore = e.payload;
      if (shouldIgnore) {
        // Dismiss any open context menu before going click-through
        window.getSelection()?.removeAllRanges();
        (document.activeElement as HTMLElement)?.blur();
      }
      win.setIgnoreCursorEvents(shouldIgnore).catch(() => {});
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
          sm.setAgentStateInputs([
            ["isWorking", conditionBool(true)],
            ["isIdle", conditionBool(false)],
          ]);
          sm.setAgentEventTrigger(eventType);
          // Show working bubble
          const projectName = event.cwd ? event.cwd.replace(/\\/g, "/").split("/").pop() || "" : "";
          workingBubbleStore.show(
            event.tool_name || "Working",
            projectName,
            event.session_id || "",
          );
          break;
        }
        case HookEventType.PostToolUse:
        case HookEventType.PostToolUseFailure: {
          agentState.isWorking = true;
          agentState.isIdle = false;
          // PostToolUse means tool executed — refresh isAlert from actual pending state
          const hasUncollapsed = permissionStore.pending.some((p) => !p.collapsed);
          if (!hasUncollapsed) agentState.isAlert = false;
          sm.setAgentStateInputs([
            ["isWorking", conditionBool(true)],
            ["isIdle", conditionBool(false)],
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
        case HookEventType.SessionEnd:
          if (idleTimer) clearTimeout(idleTimer);
          agentState.isWorking = false;
          agentState.isIdle = true;
          agentState.isAlert = false;
          workingBubbleStore.showDone();
          sm.setAgentStateInputs([
            ["isWorking", conditionBool(false)],
            ["isIdle", conditionBool(true)],
            ["isAlert", conditionBool(false)],
          ]);
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
        workingBubbleStore.hide();
        agentState.isAlert = true;
        stateMachine()?.setAgentStateInput("isAlert", conditionBool(true));
        stateMachine()?.setAgentEventTrigger("PermissionRequest");
      }
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
    invoke("set_overlay_dragging", { dragging: true }).catch(() => {});
    getCurrentWindow().setIgnoreCursorEvents(false).catch(() => {});

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      moved = true;
      if (!isDragging()) setIsDragging(true);
      overlayPositionStore.updatePosition(ev.clientX - offsetX, ev.clientY - offsetY);
    };

    const onUp = async () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setIsDragging(false);
      invoke("set_overlay_dragging", { dragging: false }).catch(() => {});

      if (moved) {
        overlayPositionStore.persistPosition();

        // Check if mascot moved to a different monitor
        const center = overlayPositionStore.screenCenter();
        try {
          const newBounds = await invoke<[number, number, number, number]>(
            "get_monitor_at_point", { x: center.x, y: center.y }
          );
          const [mx, my, mw, mh] = newBounds;
          if (mx !== overlayPositionStore.monitorX || my !== overlayPositionStore.monitorY) {
            // Snapshot screen coords before async invoke changes anything
            const snapScreenX = overlayPositionStore.monitorX + overlayPositionStore.x;
            const snapScreenY = overlayPositionStore.monitorY + overlayPositionStore.y;
            await invoke("move_overlay_to_monitor", { x: center.x, y: center.y });
            overlayPositionStore.setMonitorBounds(mx, my, mw, mh);
            overlayPositionStore.updatePosition(snapScreenX - mx, snapScreenY - my);
            overlayPositionStore.persistPosition();
          }
        } catch { /* ignore monitor detection errors */ }
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleClick = () => stateMachine()?.handleClick();
  const handleMouseEnter = () => { setIsHovering(true); stateMachine()?.handleMouseOver(true); };
  const handleMouseLeave = () => { setIsHovering(false); stateMachine()?.handleMouseOver(false); };
  const handleVideoEnded = () => {
    const sm = stateMachine();
    if (sm && !sm.isLoopVideo) sm.handleVideoEnded();
  };

  // Popup positioning: above mascot by default, below if near top edge
  const PERMISSION_BAND_PX = 280;
  const WORKING_BUBBLE_PX = 80;
  const popupTop = (popupHeight: number) => {
    const above = overlayPositionStore.y - popupHeight - 4;
    if (above >= 0) return above;
    // Flip below mascot
    return overlayPositionStore.y + overlayPositionStore.MASCOT_SIZE + 4;
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
      {/* Working bubble — floats above mascot when tool is running */}
      <Show when={workingBubbleStore.state.visible && !currentPermission()}>
        <div class="absolute pb-1 overflow-hidden"
          style={{
            "z-index": 15,
            left: `${overlayPositionStore.x}px`,
            top: `${popupTop(WORKING_BUBBLE_PX)}px`,
            width: "200px",
          }}
        >
          <WorkingBubble />
        </div>
      </Show>

      {/* Permission bubble — floats above mascot */}
      <Show when={currentPermission()}>
        {(perm) => (
          <div class="absolute px-2 pb-1 overflow-hidden"
            style={{
              "z-index": 20,
              left: `${Math.max(8, Math.min(overlayPositionStore.x - 40, window.innerWidth - 288))}px`,
              top: `${popupTop(PERMISSION_BAND_PX)}px`,
              width: "288px",
            }}
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

      {/* Mascot video — dynamically positioned */}
      <div
        class="absolute w-[200px] h-[200px] cursor-grab rounded-2xl transition-colors duration-200"
        classList={{ "cursor-grabbing": isDragging() }}
        style={{
          left: `${overlayPositionStore.x}px`,
          top: `${overlayPositionStore.y}px`,
          background: isHovering() ? "rgba(255, 176, 72, 0.45)" : "transparent",
        }}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Show
          when={stateMachine()?.currentVideoUrl}
          fallback={
            <div class="w-full h-full flex items-center justify-center">
              <div class="w-24 h-24 rounded-full bg-orange-primary/20 flex items-center justify-center animate-pulse">
                <span class="text-3xl">🦊</span>
              </div>
            </div>
          }
        >
          <video
            ref={setVideoRef}
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
