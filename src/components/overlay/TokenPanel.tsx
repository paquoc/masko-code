// src/components/overlay/TokenPanel.tsx

import { createMemo, For, Show, createSignal, type Component } from "solid-js";
import { ArrowDown, ArrowUp, Sigma, LogIn, LogOut, DatabaseZap, DatabaseBackup, PencilLine, Eye } from "lucide-solid";
import type { BubbleAppearance, TokenMetricKey, TokenPanelSettings } from "../../stores/working-bubble-store";
import { tokenUsageStore, type SessionTokenUsage } from "../../stores/token-usage-store";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

const METRIC_ICON: Record<TokenMetricKey, Component<IconProps>> = {
  read: ArrowUp,
  write: ArrowDown,
  total: Sigma,
  input: LogIn,
  output: LogOut,
  cache_read: DatabaseZap,
  cache_creation: DatabaseBackup,
};

export const ALL_ICON_OPTIONS: { key: string; component: Component<IconProps> }[] = [
  { key: "ArrowUp",        component: ArrowUp },
  { key: "ArrowDown",      component: ArrowDown },
  { key: "Sigma",          component: Sigma },
  { key: "LogIn",          component: LogIn },
  { key: "LogOut",         component: LogOut },
  { key: "DatabaseZap",    component: DatabaseZap },
  { key: "DatabaseBackup", component: DatabaseBackup },
  { key: "PencilLine",     component: PencilLine },
  { key: "Eye",            component: Eye },
];

export const ICON_BY_KEY: Record<string, Component<IconProps>> = Object.fromEntries(
  ALL_ICON_OPTIONS.map(({ key, component }) => [key, component]),
);

const METRIC_LABEL: Record<TokenMetricKey, string> = {
  read: "read",
  write: "write",
  total: "total",
  input: "input",
  output: "output",
  cache_read: "cache r",
  cache_creation: "cache c",
};

// Derive muted/border variants from a base color by adjusting its alpha channel.
function withAlpha(color: string, alpha: number): string {
  const rgba = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgba) return `rgba(${rgba[1]},${rgba[2]},${rgba[3]},${alpha})`;
  const hex6 = color.match(/^#([0-9a-f]{6})$/i);
  if (hex6) {
    const r = parseInt(hex6[1].slice(0, 2), 16);
    const g = parseInt(hex6[1].slice(2, 4), 16);
    const b = parseInt(hex6[1].slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const hex3 = color.match(/^#([0-9a-f]{3})$/i);
  if (hex3) {
    const r = parseInt(hex3[1][0].repeat(2), 16);
    const g = parseInt(hex3[1][1].repeat(2), 16);
    const b = parseInt(hex3[1][2].repeat(2), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

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
  const panelBg   = () => props.tokenSettings.bgColor   ?? "rgba(12,16,12,0.85)";
  const panelText = () => props.tokenSettings.textColor ?? "rgba(74,222,128,1)";
  const panelMuted  = () => withAlpha(panelText(), 0.95);
  const panelBorder = () => withAlpha(panelText(), 0.18);

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
    return true; // Show immediately with 0 on mascot open; values increment as events arrive
  });

  const [hovering, setHovering] = createSignal(false);

  // Icon px derived from base font size so size scales with the rest of the UI
  const iconPx = () => Math.round(props.appearance.fontSize * 1.05);

  return (
    <Show when={shouldRender()}>
      <div
        class="relative select-none"
        style={{
          background: panelBg(),
          color: panelText(),
          border: `0.5px solid ${panelBorder()}`,
          "border-radius": "999px",
          "font-size": `${props.appearance.fontSize - 1}px`,
          "font-family": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          padding: "2px 5px",
          "pointer-events": "auto",
          "box-shadow": "0 2px 10px rgba(0,0,0,0.35)",
        }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div class="flex items-center gap-0.5 tabular-nums whitespace-nowrap">
          <For each={metrics()}>
            {(k, i) => (
              <>
                <Show when={i() > 0}>
                  <span style={{ color: panelBorder() }}>·</span>
                </Show>
                <span class="flex items-center gap-0.5" style={{ color: panelText() }}>
                  {(() => {
                    const I = (props.tokenSettings.icons?.[k] ? ICON_BY_KEY[props.tokenSettings.icons[k]] : undefined) ?? METRIC_ICON[k];
                    return <I size={iconPx()} color={panelMuted()} strokeWidth={2.25} />;
                  })()}
                  <span>{formatShort(computed(k))}</span>
                </span>
              </>
            )}
          </For>
        </div>

        <Show when={hovering() && sessionsList().length > 0}>
          <div
            class="absolute"
            style={{
              "z-index": 60,
              background: panelBg(),
              color: panelText(),
              border: `1px solid ${panelBorder()}`,
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
            }}
          >
            <For each={sessionsList()}>
              {(s, i) => (
                <div>
                  <Show when={i() > 0}>
                    <div style={{ height: "1px", background: panelBorder(), margin: "6px 0" }} />
                  </Show>
                  <div style={{ "font-weight": "600", "margin-bottom": "3px", color: panelText() }}>
                    {s.projectName || s.sessionId.slice(0, 8)}
                  </div>
                  <TooltipRow label="input"        value={s.input}        muted={panelMuted()} />
                  <TooltipRow label="output"       value={s.output}       muted={panelMuted()} />
                  <TooltipRow label="cache read"   value={s.cacheRead}    muted={panelMuted()} />
                  <TooltipRow label="cache create" value={s.cacheCreation} muted={panelMuted()} />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}

function TooltipRow(props: { label: string; value: number; muted: string }) {
  return (
    <div class="flex items-center justify-between gap-4 tabular-nums">
      <span style={{ color: props.muted }}>{props.label}</span>
      <span>{formatFull(props.value)}</span>
    </div>
  );
}

export { formatShort, formatFull, METRIC_ICON, METRIC_LABEL };
