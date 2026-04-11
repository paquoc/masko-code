// src/components/overlay/TokenPanel.tsx

import { createMemo, For, Show, createSignal } from "solid-js";
import type { BubbleAppearance, TokenMetricKey, TokenPanelSettings } from "../../stores/working-bubble-store";
import { tokenUsageStore, type SessionTokenUsage } from "../../stores/token-usage-store";

const METRIC_ICON: Record<TokenMetricKey, string> = {
  read: "↓",
  write: "↑",
  total: "Σ",
  input: "→",
  output: "←",
  cache_read: "⇣",
  cache_creation: "⇡",
};

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
      // Preview always renders when enabled so users see style changes
      return true;
    }
    return tokenUsageStore.hasAnyUsage();
  });

  const [hovering, setHovering] = createSignal(false);

  return (
    <Show when={shouldRender()}>
      <div
        class="rounded-lg shadow-md select-none relative"
        style={{
          background: props.appearance.bgColor,
          color: props.appearance.textColor,
          "font-size": `${props.appearance.fontSize}px`,
          "font-family": "system-ui, sans-serif",
          padding: "6px 10px",
          "min-width": "78px",
          "pointer-events": "auto",
        }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClick={(e) => { e.stopPropagation(); /* no-op */ }}
      >
        <div class="flex flex-col gap-0.5">
          <For each={metrics()}>
            {(k) => (
              <div class="flex items-center gap-1.5 tabular-nums">
                <span style={{ color: props.appearance.mutedColor, width: "0.9em", "text-align": "center" }}>
                  {METRIC_ICON[k]}
                </span>
                <span class="flex-1 text-right">{formatShort(computed(k))}</span>
              </div>
            )}
          </For>
        </div>

        <Show when={hovering() && sessionsList().length > 0}>
          <div
            class="absolute rounded-lg shadow-lg"
            style={{
              "z-index": 60,
              background: props.appearance.bgColor,
              color: props.appearance.textColor,
              "font-size": `${Math.max(10, props.appearance.fontSize - 1)}px`,
              "font-family": "system-ui, sans-serif",
              padding: "8px 10px",
              "min-width": "200px",
              "max-height": "80vh",
              "overflow-y": "auto",
              left: "calc(100% + 8px)",
              top: "0",
              "pointer-events": "none",
              "white-space": "nowrap",
            }}
          >
            <For each={sessionsList()}>
              {(s, i) => (
                <div>
                  <Show when={i() > 0}>
                    <div style={{ height: "1px", background: props.appearance.mutedColor, opacity: "0.25", margin: "6px 0" }} />
                  </Show>
                  <div style={{ "font-weight": "600", "margin-bottom": "2px" }}>
                    {s.projectName || s.sessionId.slice(0, 8)}
                  </div>
                  <TooltipRow label="input"        value={s.input}         muted={props.appearance.mutedColor} />
                  <TooltipRow label="output"       value={s.output}        muted={props.appearance.mutedColor} />
                  <TooltipRow label="cache read"   value={s.cacheRead}     muted={props.appearance.mutedColor} />
                  <TooltipRow label="cache create" value={s.cacheCreation} muted={props.appearance.mutedColor} />
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

export { formatShort, formatFull };
