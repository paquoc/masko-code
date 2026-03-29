import { createSignal, createEffect, onMount, Show } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { emit } from "@tauri-apps/api/event";
import { installHooks, uninstallHooks, isHooksRegistered, getServerStatus } from "../../services/ipc";
import type { WorkingBubbleSettings, BubbleAppearance } from "../../stores/working-bubble-store";
import { error } from "../../services/log";

const SETTINGS_KEY = "masko_working_bubble_settings";

const defaultAppearance: BubbleAppearance = {
  fontSize: 11,
  bgColor: "rgba(255,255,255,0.95)",
  textColor: "#23113c",
  mutedColor: "rgba(35,17,60,0.55)",
  accentColor: "#f95d02",
  buttonTextColor: "#ffffff",
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

export default function SettingsPanel() {
  const [hooksInstalled, setHooksInstalled] = createSignal(false);
  const [serverPort, setServerPort] = createSignal(45832);
  const [loading, setLoading] = createSignal("");
  const [bubbleSettings, setBubbleSettings] = createStore<WorkingBubbleSettings>(loadBubbleSettings());

  onMount(async () => {
    try {
      setHooksInstalled(await isHooksRegistered());
      const status = await getServerStatus();
      setServerPort(status.port);
    } catch (e) {
      error("Settings load error:", e);
    }
  });

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
                class="px-3 py-1.5 text-sm font-body font-medium rounded-[--radius-card-sm] bg-orange-primary text-white hover:bg-orange-hover transition-colors disabled:opacity-50"
                onClick={handleInstallHooks}
                disabled={loading() === "install"}
              >
                {loading() === "install" ? "Installing..." : "Install"}
              </button>
            }
          >
            <button
              class="px-3 py-1.5 text-sm font-body font-medium rounded-[--radius-card-sm] border border-border text-text-muted hover:text-destructive hover:border-destructive transition-colors disabled:opacity-50"
              onClick={handleUninstallHooks}
              disabled={loading() === "uninstall"}
            >
              {loading() === "uninstall" ? "Removing..." : "Uninstall"}
            </button>
          </Show>
        </div>
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
            <BubblePreview appearance={bubbleSettings.appearance} />
            <PermissionPreview appearance={bubbleSettings.appearance} />
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

          {/* Reset */}
          <button
            class="w-full text-xs font-body text-text-muted hover:text-text-primary py-1 transition-colors"
            onClick={resetAppearance}
          >
            Reset to defaults
          </button>
        </div>
      </Section>

      {/* About */}
      <Section title="About">
        <div class="space-y-1 text-sm text-text-muted font-body">
          <p><span class="text-text-primary font-medium">Masko Code</span> v0.1.0</p>
          <p>Your AI coding assistant companion for Windows.</p>
          <p class="text-xs mt-2">
            <a href="https://masko.ai" class="text-orange-primary hover:underline" target="_blank">
              masko.ai
            </a>
          </p>
        </div>
      </Section>
    </div>
  );
}

function Section(props: { title: string; children: any }) {
  return (
    <div class="bg-surface rounded-[--radius-card] border border-border p-4">
      <h3 class="font-heading font-semibold text-sm text-text-primary mb-3">{props.title}</h3>
      {props.children}
    </div>
  );
}

/** Live mini-preview of the working bubble */
function BubblePreview(props: { appearance: BubbleAppearance }) {
  const a = () => props.appearance;
  return (
    <div class="w-44 select-none" style={{ "font-family": "var(--font-body)" }}>
      <div
        class="rounded-xl px-3 py-2 overflow-hidden"
        style={{
          background: a().bgColor,
          "box-shadow": "0 2px 8px rgba(35,17,60,0.12), 0 0 0 1px rgba(35,17,60,0.06)",
        }}
      >
        <div class="truncate leading-tight" style={{ "font-size": `${a().fontSize - 2}px`, color: a().mutedColor }}>
          my-project
        </div>
        <div class="flex items-center gap-1.5 mt-0.5">
          <span class="relative flex h-1.5 w-1.5 shrink-0">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: a().accentColor }} />
            <span class="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: a().accentColor }} />
          </span>
          <span class="font-medium truncate" style={{ "font-size": `${a().fontSize}px`, color: a().textColor }}>
            Edit
          </span>
        </div>
      </div>
      <div class="flex justify-end pr-8">
        <div style={{
          width: "0", height: "0",
          "border-left": "6px solid transparent",
          "border-right": "6px solid transparent",
          "border-top": `6px solid ${a().bgColor}`,
        }} />
      </div>
    </div>
  );
}

/** Live mini-preview of the permission bubble */
function PermissionPreview(props: { appearance: BubbleAppearance }) {
  const a = () => props.appearance;
  // Match PermissionPrompt font scale: base = fontSize + 2
  const fs = () => a().fontSize + 2;
  const fsSm = () => a().fontSize + 1;
  const fsMono = () => a().fontSize;
  const fsMuted = () => a().fontSize - 1;
  return (
    <div class="w-44 select-none" style={{ "font-family": "var(--font-body)", transform: "scale(0.85)", "transform-origin": "bottom center" }}>
      <div
        class="rounded-[14px] overflow-hidden"
        style={{
          background: a().bgColor,
          "box-shadow": "0 2px 12px rgba(35,17,60,0.15), 0 0 0 1px rgba(35,17,60,0.06)",
        }}
      >
        {/* Header */}
        <div class="px-3 pt-2 pb-1">
          <div class="flex items-center gap-1.5">
            <span class="font-semibold" style={{ "font-size": `${fs()}px`, color: a().accentColor }}>Bash</span>
            <span class="ml-auto" style={{ "font-size": `${fsMuted()}px`, color: a().mutedColor }}>project</span>
          </div>
        </div>
        {/* Command */}
        <div class="px-3 pb-1.5">
          <div
            class="rounded-lg px-2 py-0.5 font-mono break-all leading-snug"
            style={{
              "font-size": `${fsMono()}px`,
              background: "rgba(35,17,60,0.04)",
              border: "1px solid rgba(35,17,60,0.06)",
              color: a().textColor,
            }}
          >
            npm test
          </div>
        </div>
        {/* Buttons */}
        <div class="px-3 pb-2 flex items-center gap-1.5">
          <button
            class="flex-1 px-2 py-0.5 rounded-lg font-semibold"
            style={{
              "font-size": `${fsSm()}px`,
              "font-family": "var(--font-heading)",
              background: a().accentColor,
              color: a().buttonTextColor,
            }}
          >
            Approve
          </button>
          <button
            class="px-2 py-0.5 rounded-lg font-medium border"
            style={{
              "font-size": `${fsSm()}px`,
              "font-family": "var(--font-heading)",
              "border-color": "rgba(35,17,60,0.12)",
              color: a().mutedColor,
            }}
          >
            Deny
          </button>
        </div>
      </div>
      <div class="flex justify-end pr-8">
        <div style={{
          width: "0", height: "0",
          "border-left": "8px solid transparent",
          "border-right": "8px solid transparent",
          "border-top": `8px solid ${a().bgColor}`,
        }} />
      </div>
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
