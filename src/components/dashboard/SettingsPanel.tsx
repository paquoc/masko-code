import { createSignal, createEffect, onMount, onCleanup, Show, For } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { emit } from "@tauri-apps/api/event";
import { installHooks, uninstallHooks, isHooksRegistered, getServerStatus, getAutostart, setAutostart } from "../../services/ipc";
import type { WorkingBubbleSettings, BubbleAppearance } from "../../stores/working-bubble-store";
import WorkingBubble from "../overlay/WorkingBubble";
import PermissionPrompt from "../overlay/PermissionPrompt";
import type { PendingPermission } from "../../models/permission";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { error } from "../../services/log";
import { updateStore } from "../../stores/update-store";
import { hotkeyStore, eventToBinding, bindingToLabel, type HotkeyBinding, type HotkeySettings } from "../../stores/hotkey-store";
import { reloadHotkeys } from "../../stores/permission-store";
import { autoApproveStore, type RiskLevel } from "../../stores/auto-approve-store";

const SETTINGS_KEY = "masko_working_bubble_settings";

const defaultAppearance: BubbleAppearance = {
  fontSize: 11,
  bgColor: "rgba(255,255,255,0.95)",
  textColor: "#23113c",
  mutedColor: "rgba(35,17,60,0.55)",
  accentColor: "#f95d02",
  buttonTextColor: "#ffffff",
  hoverColor: "rgba(255,176,72,0.45)",
};

function loadBubbleSettings(): WorkingBubbleSettings {
  const defaults: WorkingBubbleSettings = {
    showToolBubble: true,
    showSessionStart: true,
    showSessionEnd: true,
    appearance: { ...defaultAppearance },
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...defaults,
        ...parsed,
        appearance: { ...defaults.appearance, ...parsed.appearance },
      };
    }
  } catch { /* ignore */ }
  return defaults;
}

const previewPermission: PendingPermission = {
  id: "preview",
  event: {
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    tool_input: { command: "npm run build -- --output-dir=dist/production" },
    permission_suggestions: [
      { type: "setMode", mode: "acceptEdits", destination: "session" },
      { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm run build/**" }], destination: "session", behavior: "allow" },
    ],
  } as any,
  requestId: "preview",
  receivedAt: new Date(),
  collapsed: false,
};

export default function SettingsPanel() {
  const [hooksInstalled, setHooksInstalled] = createSignal(false);
  const [serverPort, setServerPort] = createSignal(45832);
  const [loading, setLoading] = createSignal("");
  const [bubbleSettings, setBubbleSettings] = createStore<WorkingBubbleSettings>(loadBubbleSettings());
  const [autostartEnabled, setAutostartEnabled] = createSignal(false);

  onMount(async () => {
    try {
      setHooksInstalled(await isHooksRegistered());
      const status = await getServerStatus();
      setServerPort(status.port);

      setAutostartEnabled(await getAutostart());
    } catch (e) {
      error("Settings load error:", e);
    }
  });

  async function toggleAutostart() {
    const next = !autostartEnabled();
    try {
      await setAutostart(next);
      setAutostartEnabled(next);
    } catch (e) {
      error("Autostart toggle failed:", e);
    }
  }

  function persistAndEmit() {
    const data = JSON.parse(JSON.stringify(unwrap(bubbleSettings)));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    emit("bubble-settings-changed", data).catch(() => {});
  }

  function toggleBubbleSetting(key: "showToolBubble" | "showSessionStart" | "showSessionEnd") {
    setBubbleSettings(key, !bubbleSettings[key]);
    persistAndEmit();
  }

  function setAppearance(key: keyof BubbleAppearance, value: string | number) {
    setBubbleSettings("appearance", key, value as never);
    persistAndEmit();
  }

  function resetAppearance() {
    setBubbleSettings("appearance", { ...defaultAppearance });
    persistAndEmit();
  }

  async function handleInstallHooks() {
    setLoading("install");
    try {
      await installHooks();
      setHooksInstalled(true);
    } catch (e) {
      error("Hook install failed:", e);
    }
    setLoading("");
  }

  async function handleUninstallHooks() {
    setLoading("uninstall");
    try {
      await uninstallHooks();
      setHooksInstalled(false);
    } catch (e) {
      error("Hook uninstall failed:", e);
    }
    setLoading("");
  }

  return (
    <div class="space-y-6">
      {/* Server status */}
      <Section title="Server">
        <div class="flex items-center gap-3">
          <div class="w-2.5 h-2.5 rounded-full bg-green-500" />
          <span class="text-sm font-body text-text-primary">
            Running on port {serverPort()}
          </span>
        </div>
      </Section>

      {/* Startup */}
      <Section title="Startup">
        <ToggleRow
          label="Start with Windows"
          description="Launch Masko automatically when Windows starts"
          checked={autostartEnabled()}
          onChange={toggleAutostart}
        />
      </Section>

      {/* Hook management */}
      <Section title="Claude Code Hooks">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-body text-text-primary">
              {hooksInstalled() ? "Hooks installed" : "Hooks not installed"}
            </p>
            <p class="text-xs text-text-muted mt-0.5">
              Hooks connect Claude Code events to Masko's overlay and dashboard.
            </p>
          </div>
          <Show
            when={hooksInstalled()}
            fallback={
              <button
                class="px-3 py-1.5 text-sm font-body font-medium rounded-card-sm bg-orange-primary text-white hover:bg-orange-hover transition-colors disabled:opacity-50"
                onClick={handleInstallHooks}
                disabled={loading() === "install"}
              >
                {loading() === "install" ? "Installing..." : "Install"}
              </button>
            }
          >
            <button
              class="px-3 py-1.5 text-sm font-body font-medium rounded-card-sm border border-border text-text-muted hover:text-destructive hover:border-destructive transition-colors disabled:opacity-50"
              onClick={handleUninstallHooks}
              disabled={loading() === "uninstall"}
            >
              {loading() === "uninstall" ? "Removing..." : "Uninstall"}
            </button>
          </Show>
        </div>
      </Section>

      {/* Keyboard Shortcuts */}
      <Section title="Keyboard Shortcuts">
        <div class="space-y-3">
          <HotkeyRow
            label="Approve permission"
            action="approve"
          />
          <HotkeyRow
            label="Deny permission"
            action="deny"
          />
        </div>
      </Section>

      {/* Auto-approve Rules */}
      <Section title="Auto-approve Rules">
        <p class="text-xs text-text-muted mb-3">
          All commands in a script must match an auto-approve rule for the countdown to start. Comma-separated patterns (plain text or regex).
        </p>

        {/* Countdown setting */}
        <div class="flex items-center justify-between mb-3">
          <p class="text-sm font-body text-text-primary">Countdown</p>
          <div class="flex items-center gap-2">
            <input
              type="range"
              min="2"
              max="10"
              step="1"
              value={autoApproveStore.settings.countdownSeconds}
              onInput={(e) => autoApproveStore.setCountdown(Number(e.currentTarget.value))}
              class="w-20 accent-orange-primary"
            />
            <span class="text-xs text-text-muted w-6 text-right">{autoApproveStore.settings.countdownSeconds}s</span>
          </div>
        </div>

        {/* Rules table */}
        <div class="space-y-2">
          <For each={autoApproveStore.settings.rules}>
            {(rule) => (
              <div class="flex items-center gap-2 p-2 rounded-lg border border-border bg-bg-light">
                {/* Patterns textarea */}
                <textarea
                  value={rule.patterns}
                  onInput={(e) => autoApproveStore.updateRule(rule.id, { patterns: e.currentTarget.value })}
                  class="flex-1 min-w-0 px-2 py-1 text-xs font-mono rounded border border-border bg-surface text-text-primary focus:border-orange-primary focus:outline-none resize-none overflow-hidden"
                  rows={1}
                  style={{ "field-sizing": "content" }}
                  placeholder="ls, echo, pwd, git\\s+(status|log|diff)"
                  spellcheck={false}
                />

                {/* Risk level */}
                <select
                  value={rule.risk}
                  onChange={(e) => autoApproveStore.updateRule(rule.id, { risk: e.currentTarget.value as RiskLevel })}
                  class="px-1.5 py-1 text-xs rounded border border-border bg-surface focus:outline-none shrink-0"
                  classList={{
                    "text-green-600": rule.risk === "safe",
                    "text-yellow-600": rule.risk === "medium",
                    "text-red-500": rule.risk === "high",
                  }}
                >
                  <option value="safe" style={{ color: "#16a34a" }}>Safe</option>
                  <option value="medium" style={{ color: "#ca8a04" }}>Medium</option>
                  <option value="high" style={{ color: "#ef4444" }}>High</option>
                </select>

                {/* Auto approve toggle */}
                <button
                  class="relative w-8 h-5 rounded-full transition-colors duration-200 shrink-0"
                  classList={{
                    "bg-orange-primary": rule.autoApprove,
                    "bg-border": !rule.autoApprove,
                  }}
                  onClick={() => autoApproveStore.updateRule(rule.id, { autoApprove: !rule.autoApprove })}
                  title="Auto-approve"
                >
                  <span
                    class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
                    classList={{ "translate-x-3": rule.autoApprove }}
                  />
                </button>

                {/* Delete */}
                <button
                  class="text-base text-text-muted hover:text-destructive shrink-0 leading-none cursor-pointer"
                  onClick={() => autoApproveStore.removeRule(rule.id)}
                  title="Remove rule"
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>

        <button
          class="mt-2 w-full py-1.5 text-xs font-body text-text-muted hover:text-text-primary border border-dashed border-border rounded-lg transition-colors"
          onClick={() => autoApproveStore.addRule()}
        >
          + Add Rule
        </button>
      </Section>

      {/* Working Bubble */}
      <Section title="Working Bubble">
        <div class="space-y-3">
          <ToggleRow
            label="Tool activity"
            description="Show bubble when a tool is running"
            checked={bubbleSettings.showToolBubble}
            onChange={() => toggleBubbleSetting("showToolBubble")}
          />
          <ToggleRow
            label="Session start"
            description="Show bubble when a new session begins"
            checked={bubbleSettings.showSessionStart}
            onChange={() => toggleBubbleSetting("showSessionStart")}
          />
          <ToggleRow
            label="Session end"
            description="Show bubble when a session completes"
            checked={bubbleSettings.showSessionEnd}
            onChange={() => toggleBubbleSetting("showSessionEnd")}
          />
        </div>
      </Section>

      {/* Bubble Appearance */}
      <Section title="Bubble Appearance">
        <div class="space-y-3">
          {/* Previews */}
          <div class="flex items-end justify-center gap-3 py-2">
            <WorkingBubble
              appearance={bubbleSettings.appearance}
              previewState={{
                visible: true,
                status: "working",
                toolName: "Edit",
                toolDetail: "src/components/App.tsx",
                projectName: "my-project",
                sessionId: "",
              }}
            />
            <div style={{ transform: "scale(0.85)", "transform-origin": "bottom center" }}>
              <PermissionPrompt
                appearance={bubbleSettings.appearance}
                permission={previewPermission}
              />
            </div>
          </div>

          {/* Font size */}
          <div class="flex items-center justify-between">
            <p class="text-sm font-body text-text-primary">Font size</p>
            <div class="flex items-center gap-2">
              <input
                type="range"
                min="9"
                max="16"
                step="1"
                value={bubbleSettings.appearance.fontSize}
                onInput={(e) => setAppearance("fontSize", Number(e.currentTarget.value))}
                class="w-20 accent-orange-primary"
              />
              <span class="text-xs text-text-muted w-6 text-right">{bubbleSettings.appearance.fontSize}px</span>
            </div>
          </div>

          {/* Colors */}
          <ColorRow label="Background" value={bubbleSettings.appearance.bgColor} onChange={(v) => setAppearance("bgColor", v)} />
          <ColorRow label="Text" value={bubbleSettings.appearance.textColor} onChange={(v) => setAppearance("textColor", v)} />
          <ColorRow label="Muted text" value={bubbleSettings.appearance.mutedColor} onChange={(v) => setAppearance("mutedColor", v)} />
          <ColorRow label="Accent" value={bubbleSettings.appearance.accentColor} onChange={(v) => setAppearance("accentColor", v)} />
          <ColorRow label="Button text" value={bubbleSettings.appearance.buttonTextColor} onChange={(v) => setAppearance("buttonTextColor", v)} />
          <ColorRow label="Mascot hover" value={bubbleSettings.appearance.hoverColor || "rgba(255,176,72,0.45)"} onChange={(v) => setAppearance("hoverColor", v)} />

          {/* Reset */}
          <button
            class="w-full text-xs font-body text-text-muted hover:text-text-primary py-1 transition-colors"
            onClick={resetAppearance}
          >
            Reset to defaults
          </button>
        </div>
      </Section>

      {/* Updates */}
      <Section title="Updates">
        <div class="flex items-center justify-between">
          <div>
            <Show when={updateStore.status === "idle"}>
              <p class="text-sm font-body text-text-primary">You're up to date</p>
              <p class="text-xs text-text-muted mt-0.5">Current version: v1.24.0</p>
            </Show>
            <Show when={updateStore.status === "checking"}>
              <p class="text-sm font-body text-text-primary">Checking for updates...</p>
            </Show>
            <Show when={updateStore.status === "available"}>
              <p class="text-sm font-body text-text-primary">
                Update available: <span class="font-medium text-orange-primary">v{updateStore.version}</span>
              </p>
              <p class="text-xs text-text-muted mt-0.5">Ready to download and install</p>
            </Show>
            <Show when={updateStore.status === "downloading"}>
              <p class="text-sm font-body text-text-primary">Downloading update...</p>
              <div class="mt-1.5 w-48 h-1.5 rounded-full bg-border overflow-hidden">
                <div
                  class="h-full rounded-full bg-orange-primary transition-all duration-300"
                  style={{ width: `${updateStore.progress}%` }}
                />
              </div>
              <p class="text-xs text-text-muted mt-0.5">{updateStore.progress}%</p>
            </Show>
            <Show when={updateStore.status === "installing"}>
              <p class="text-sm font-body text-text-primary">Installing update, restarting shortly...</p>
            </Show>
            <Show when={updateStore.status === "error"}>
              <p class="text-sm font-body text-destructive">Update failed</p>
              <p class="text-xs text-text-muted mt-0.5">{updateStore.error}</p>
            </Show>
          </div>
          <Show when={updateStore.status === "available"}>
            <button
              class="px-3 py-1.5 text-sm font-body font-medium rounded-card-sm bg-orange-primary text-white hover:bg-orange-hover transition-colors"
              onClick={updateStore.downloadAndInstall}
            >
              Install
            </button>
          </Show>
          <Show when={updateStore.status === "idle" || updateStore.status === "error"}>
            <button
              class="px-3 py-1.5 text-sm font-body font-medium rounded-card-sm border border-border text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
              onClick={() => updateStore.checkForUpdates()}
            >
              Check
            </button>
          </Show>
        </div>
      </Section>

      {/* Debug */}
      <Section title="Debug">
        <button
          class="px-3 py-1.5 text-xs font-body font-medium rounded-card-sm bg-surface-hover text-text-primary hover:bg-border transition-colors"
          onClick={() => invoke("open_devtools").catch(() => {})}
        >
          Open Overlay DevTools
        </button>
      </Section>

      {/* About */}
      <Section title="About">
        <div class="space-y-1 text-sm text-text-muted font-body">
          <p><span class="text-text-primary font-medium">Masko Code</span> v1.24.0</p>
          <p>Your AI coding assistant companion for Windows.</p>
          <p class="text-xs mt-2">
            <button
              onClick={() => openUrl("https://masko.ai")}
              class="text-orange-primary hover:underline cursor-pointer bg-transparent border-none p-0 text-sm font-body"
            >
              masko.ai
            </button>
          </p>
        </div>
      </Section>
    </div>
  );
}

function Section(props: { title: string; children: any }) {
  return (
    <div class="bg-surface rounded-card border border-border p-4">
      <h3 class="font-heading font-semibold text-sm text-text-primary mb-3">{props.title}</h3>
      {props.children}
    </div>
  );
}

/** Resolve any CSS color to { hex, alpha } via the browser */
function parseColor(color: string): { hex: string; alpha: number } {
  // rgba(r,g,b,a)
  const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgbaMatch) {
    const hex = (n: string) => parseInt(n).toString(16).padStart(2, "0");
    return {
      hex: `#${hex(rgbaMatch[1])}${hex(rgbaMatch[2])}${hex(rgbaMatch[3])}`,
      alpha: rgbaMatch[4] != null ? parseFloat(rgbaMatch[4]) : 1,
    };
  }
  // #rrggbb or #rgb
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return { hex: color, alpha: 1 };
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    const [, r, g, b] = color.match(/^#(.)(.)(.)$/)!;
    return { hex: `#${r}${r}${g}${g}${b}${b}`, alpha: 1 };
  }
  // Fallback: resolve via browser computed style
  const tmp = document.createElement("div");
  tmp.style.color = color;
  document.body.appendChild(tmp);
  const computed = getComputedStyle(tmp).color;
  document.body.removeChild(tmp);
  return parseColor(computed);
}

/** Build rgba string from hex + alpha */
function buildRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (alpha >= 1) return hex;
  return `rgba(${r},${g},${b},${alpha})`;
}

function ColorRow(props: { label: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = createSignal(false);
  const parsed = () => parseColor(props.value);
  let popoverRef: HTMLDivElement | undefined;

  const onColorChange = (hex: string) => props.onChange(buildRgba(hex, parsed().alpha));
  const onAlphaChange = (alpha: number) => props.onChange(buildRgba(parsed().hex, alpha));

  // Close popover on outside click
  const handleClickOutside = (e: MouseEvent) => {
    if (popoverRef && !popoverRef.contains(e.target as Node)) setOpen(false);
  };
  createEffect(() => {
    if (open()) document.addEventListener("mousedown", handleClickOutside);
    else document.removeEventListener("mousedown", handleClickOutside);
  });

  return (
    <div class="flex items-center justify-between">
      <p class="text-sm font-body text-text-primary">{props.label}</p>
      <div class="relative" ref={popoverRef}>
        {/* Swatch button */}
        <button
          class="w-7 h-7 rounded-lg border border-border cursor-pointer transition-shadow hover:shadow-md"
          style={{
            background: `linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)`,
            "background-size": "8px 8px",
            "background-position": "0 0, 4px 4px",
          }}
          onClick={() => setOpen(!open())}
        >
          <div class="w-full h-full rounded-[7px]" style={{ background: props.value }} />
        </button>

        {/* Popover */}
        <Show when={open()}>
          <div
            class="absolute right-0 top-9 z-50 w-52 bg-surface rounded-xl border border-border p-3 space-y-3"
            style={{ "box-shadow": "0 4px 20px rgba(35,17,60,0.15)" }}
          >
            {/* Hidden native color picker triggered by the gradient area */}
            <div class="relative">
              <input
                type="color"
                value={parsed().hex}
                onInput={(e) => onColorChange(e.currentTarget.value)}
                class="absolute inset-0 w-full h-8 cursor-pointer opacity-0"
              />
              <div
                class="h-8 rounded-lg border border-border cursor-pointer"
                style={{ background: parsed().hex }}
              />
            </div>

            {/* Opacity */}
            <div class="space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-medium text-text-muted">Opacity</span>
                <span class="text-[10px] font-mono text-text-muted">{Math.round(parsed().alpha * 100)}%</span>
              </div>
              <div class="relative h-5 flex items-center">
                {/* Checkerboard + gradient track */}
                <div
                  class="absolute inset-x-0 h-2 rounded-full overflow-hidden border border-border"
                  style={{
                    background: `linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)`,
                    "background-size": "6px 6px",
                    "background-position": "0 0, 3px 3px",
                  }}
                >
                  <div
                    class="w-full h-full"
                    style={{ background: `linear-gradient(to right, transparent, ${parsed().hex})` }}
                  />
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={parsed().alpha}
                  onInput={(e) => onAlphaChange(parseFloat(e.currentTarget.value))}
                  class="relative w-full h-2 appearance-none bg-transparent cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-orange-primary [&::-webkit-slider-thumb]:shadow-sm"
                />
              </div>
            </div>

            {/* Hex input */}
            <input
              type="text"
              value={props.value}
              onChange={(e) => props.onChange(e.currentTarget.value)}
              class="w-full px-2 py-1 text-[11px] font-mono rounded-lg border border-border bg-bg-light text-text-primary focus:border-orange-primary focus:outline-none"
            />
          </div>
        </Show>
      </div>
    </div>
  );
}

function HotkeyRow(props: { label: string; action: keyof HotkeySettings }) {
  const [recording, setRecording] = createSignal(false);
  const binding = () => hotkeyStore.settings[props.action];

  async function startRecording() {
    // Pause global shortcuts so they don't steal the key combo
    await reloadHotkeys();
    setRecording(true);
  }

  function stopRecording() {
    setRecording(false);
    reloadHotkeys();
  }

  function handleKeyDown(e: KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { stopRecording(); return; }
    const b = eventToBinding(e);
    if (!b) return; // lone modifier, wait for actual key
    if (!b.ctrlKey && !b.shiftKey && !b.altKey && !b.metaKey) return;
    hotkeyStore.setHotkey(props.action, b);
    stopRecording();
  }

  return (
    <div class="flex items-center justify-between">
      <p class="text-sm font-body text-text-primary">{props.label}</p>
      <Show
        when={!recording()}
        fallback={
          <div
            tabIndex={0}
            class="px-3 py-1.5 text-sm font-mono rounded-card-sm border-2 border-orange-primary bg-orange-primary/10 text-orange-primary animate-pulse focus:outline-none cursor-default"
            onKeyDown={handleKeyDown}
            onBlur={() => stopRecording()}
            ref={(el) => requestAnimationFrame(() => el.focus())}
          >
            Press keys...
          </div>
        }
      >
        <button
          class="px-3 py-1.5 text-sm font-mono rounded-card-sm border border-border text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
          onClick={startRecording}
          title="Click to record new shortcut"
        >
          {bindingToLabel(binding())}
        </button>
      </Show>
    </div>
  );
}

function ToggleRow(props: { label: string; description: string; checked: boolean; onChange: () => void }) {
  return (
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm font-body text-text-primary">{props.label}</p>
        <p class="text-xs text-text-muted mt-0.5">{props.description}</p>
      </div>
      <button
        class="relative w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none"
        classList={{
          "bg-orange-primary": props.checked,
          "bg-border": !props.checked,
        }}
        onClick={props.onChange}
        role="switch"
        aria-checked={props.checked}
      >
        <span
          class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
          classList={{ "translate-x-4": props.checked }}
        />
      </button>
    </div>
  );
}

