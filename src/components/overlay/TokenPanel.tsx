// src/components/overlay/TokenPanel.tsx

import { createMemo, For, Show, createSignal, type Component } from "solid-js";
import { ArrowDown, ArrowUp, Sigma, LogIn, LogOut, DatabaseZap, DatabaseBackup } from "lucide-solid";
import type { BubbleAppearance, TokenMetricKey, TokenPanelSettings } from "../../stores/working-bubble-store";
import { tokenUsageStore, type SessionTokenUsage } from "../../stores/token-usage-store";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

const METRIC_ICON: Record<TokenMetricKey, Component<IconProps>> = {
  read: ArrowDown,
  write: ArrowUp,
  total: Sigma,
  input: LogIn,
  output: LogOut,
  cache_read: DatabaseZap,
  cache_creation: DatabaseBackup,
};

const METRIC_LABEL: Record<TokenMetricKey, string> = {
  read: "read",
  write: "write",
  total: "total",
  input: "input",
  output: "output",
  cache_read: "cache r",
  cache_creation: "cache c",
};

// Dark/green palette — fixed, independent of appearance so the panel has
// its own identity and stays legible against any desktop background.
const PANEL_BG = "rgba(12,16,12,0.85)";
const PANEL_TEXT = "#4ade80";      // green-400
const PANEL_MUTED = "rgba(74,222,128,0.55)";
const PANEL_BORDER = "rgba(74,222,128,0.18)";

function formatShort(n: number): string {
  if (n < 1_000) return n.toString();
  if (n < 1_000_000) return (n / 1_000).toFixed(1) + "K";
  if (n < 1_000_000_000) return (n / 1_000_000).toFixed(1) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

function formatFull(n: number): string {
  return n.toLocaleString("en-US");
}

export interface TokenPanelProps {
  appearance: BubbleAppearance;
  tokenSettings: TokenPanelSettings;
  previewSessions?: SessionTokenUsage[];  // preview in SettingsPanel
}

export default function TokenPanel(props: TokenPanelProps) {
  const metrics = createMemo(() =>
    props.tokenSettings.order.filter((k) => props.tokenSettings.visible[k]),
  );

  const totalsFromPreview = createMemo(() => {
    const list = props.previewSessions;
    if (!list) return null;
    const t = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    for (const s of list) {
      t.input += s.input;
      t.output += s.output;
      t.cacheRead += s.cacheRead;
      t.cacheCreation += s.cacheCreation;
    }
    return t;
  });

  const computed = (k: TokenMetricKey): number => {
    const pv = totalsFromPreview();
    if (pv) {
      switch (k) {
        case "read": return pv.input + pv.cacheRead;
        case "write": return pv.output + pv.cacheCreation;
        case "total": return pv.input + pv.output + pv.cacheRead + pv.cacheCreation;
        case "input": return pv.input;
        case "output": return pv.output;
        case "cache_read": return pv.cacheRead;
        case "cache_creation": return pv.cacheCreation;
      }
    }
    return tokenUsageStore.computed(k);
  };

  const sessionsList = (): SessionTokenUsage[] =>
    props.previewSessions ?? tokenUsageStore.sessions();

  const shouldRender = createMemo(() => {
    if (!props.tokenSettings.enabled) return false;
    if (metrics().length === 0) return false;
    if (props.previewSessions) {
      return true;
    }
    return tokenUsageStore.hasAnyUsage();
  });

  const [hovering, setHovering] = createSignal(false);

  // Icon px derived from base font size so size scales with the rest of the UI
  const iconPx = () => Math.round(props.appearance.fontSize * 1.05);

  return (
    <Show when={shouldRender()}>
      <div
        class="relative select-none"
        style={{
          background: PANEL_BG,
          color: PANEL_TEXT,
          border: `1px solid ${PANEL_BORDER}`,
          "border-radius": "999px",
          "font-size": `${props.appearance.fontSize}px`,
          "font-family": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          padding: "5px 12px",
          "pointer-events": "auto",
          "box-shadow": "0 2px 10px rgba(0,0,0,0.35)",
          "backdrop-filter": "blur(6px)",
          "-webkit-backdrop-filter": "blur(6px)",
        }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div class="flex items-center gap-3 tabular-nums whitespace-nowrap">
          <For each={metrics()}>
            {(k, i) => {
              const Icon = METRIC_ICON[k];
              return (
                <>
                  <Show when={i() > 0}>
                    <span style={{ color: PANEL_BORDER }}>·</span>
                  </Show>
                  <span class="flex items-center gap-1">
                    <Icon size={iconPx()} color={PANEL_MUTED} strokeWidth={2.25} />
                    <span>{formatShort(computed(k))}</span>
                  </span>
                </>
              );
            }}
          </For>
        </div>

        <Show when={hovering() && sessionsList().length > 0}>
          <div
            class="absolute"
            style={{
              "z-index": 60,
              background: PANEL_BG,
              color: PANEL_TEXT,
              border: `1px solid ${PANEL_BORDER}`,
              "border-radius": "10px",
              "font-size": `${Math.max(10, props.appearance.fontSize - 1)}px`,
              "font-family": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              padding: "8px 12px",
              "min-width": "220px",
              "max-height": "80vh",
              "overflow-y": "auto",
              top: "calc(100% + 6px)",
              left: "50%",
              transform: "translateX(-50%)",
              "pointer-events": "none",
              "white-space": "nowrap",
              "box-shadow": "0 6px 20px rgba(0,0,0,0.4)",
              "backdrop-filter": "blur(8px)",
              "-webkit-backdrop-filter": "blur(8px)",
            }}
          >
            <For each={sessionsList()}>
              {(s, i) => (
                <div>
                  <Show when={i() > 0}>
                    <div style={{ height: "1px", background: PANEL_BORDER, margin: "6px 0" }} />
                  </Show>
                  <div style={{ "font-weight": "600", "margin-bottom": "3px", color: PANEL_TEXT }}>
                    {s.projectName || s.sessionId.slice(0, 8)}
                  </div>
                  <TooltipRow label="input"        value={s.input} />
                  <TooltipRow label="output"       value={s.output} />
                  <TooltipRow label="cache read"   value={s.cacheRead} />
                  <TooltipRow label="cache create" value={s.cacheCreation} />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}

function TooltipRow(props: { label: string; value: number }) {
  return (
    <div class="flex items-center justify-between gap-4 tabular-nums">
      <span style={{ color: PANEL_MUTED }}>{props.label}</span>
      <span>{formatFull(props.value)}</span>
    </div>
  );
}

export { formatShort, formatFull, METRIC_ICON, METRIC_LABEL };
