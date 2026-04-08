import { createSignal, onMount, Show } from "solid-js";
import { telegramStore, type TelegramTestResult } from "../../stores/telegram-store";
import { appendNotification } from "../../stores/notification-store";
import { createNotification } from "../../models/notification";
import { error } from "../../services/log";

export default function TelegramPanel() {
  const [token, setToken] = createSignal("");
  const [chatId, setChatId] = createSignal("");
  const [savedToken, setSavedToken] = createSignal("");
  const [savedChatId, setSavedChatId] = createSignal("");
  const [showToken, setShowToken] = createSignal(false);
  const [testing, setTesting] = createSignal(false);
  const [testResult, setTestResult] = createSignal<
    { ok: true; msg: string } | { ok: false; msg: string } | null
  >(null);
  const [saving, setSaving] = createSignal(false);

  onMount(async () => {
    try {
      const cfg = await telegramStore.getConfig();
      setToken(cfg.bot_token);
      setChatId(cfg.chat_id);
      setSavedToken(cfg.bot_token);
      setSavedChatId(cfg.chat_id);
    } catch (e) {
      error("[telegram] getConfig failed:", e);
    }
  });

  const hasUnsavedChanges = () =>
    token() !== savedToken() || chatId() !== savedChatId();

  const canEnable = () =>
    telegramStore.status.configured && !hasUnsavedChanges();

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res: TelegramTestResult = await telegramStore.test(
        token(),
        chatId().trim() === "" ? null : chatId(),
      );
      const suffix = res.chat_tested ? " · test message sent" : "";
      setTestResult({
        ok: true,
        msg: `✓ Bot: @${res.bot_username} (${res.bot_first_name})${suffix}`,
      });
    } catch (e: any) {
      setTestResult({ ok: false, msg: `✗ ${String(e)}` });
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 8000);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await telegramStore.saveConfig(token(), chatId());
      setSavedToken(token());
      setSavedChatId(chatId());
      appendNotification(
        createNotification(
          "Telegram",
          "Config đã lưu",
          "sessionLifecycle",
          "low",
        ),
      );
    } catch (e: any) {
      appendNotification(
        createNotification(
          "Telegram",
          `Lưu thất bại: ${String(e)}`,
          "toolFailed",
          "high",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEnabled() {
    const next = !telegramStore.status.enabled;
    try {
      await telegramStore.setEnabled(next);
    } catch (e: any) {
      appendNotification(
        createNotification(
          "Telegram",
          `Không thể ${next ? "bật" : "tắt"}: ${String(e)}`,
          "toolFailed",
          "high",
        ),
      );
    }
  }

  return (
    <div class="space-y-6">
      <div class="bg-surface rounded-card border border-border p-4">
        <h3 class="font-heading font-semibold text-sm text-text-primary mb-3">
          Bot Configuration
        </h3>
        <div class="space-y-3">
          {/* Enable toggle */}
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-body text-text-primary">Enabled</p>
              <p class="text-xs text-text-muted mt-0.5">
                {canEnable()
                  ? "Bấm để bật/tắt polling"
                  : hasUnsavedChanges()
                    ? "Lưu config trước khi bật"
                    : "Điền token và chat ID trước"}
              </p>
            </div>
            <button
              class="relative w-10 h-6 rounded-full transition-colors disabled:opacity-40"
              classList={{
                "bg-orange-primary": telegramStore.status.enabled,
                "bg-border": !telegramStore.status.enabled,
              }}
              disabled={!canEnable() && !telegramStore.status.enabled}
              onClick={handleToggleEnabled}
            >
              <div
                class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
                style={{
                  transform: telegramStore.status.enabled
                    ? "translateX(16px)"
                    : "translateX(0)",
                }}
              />
            </button>
          </div>

          {/* Bot token */}
          <div>
            <label class="block text-xs font-body text-text-muted mb-1">
              Bot token
            </label>
            <div class="flex gap-2">
              <input
                class="flex-1 px-3 py-1.5 text-sm font-body rounded-card-sm border border-border bg-background text-text-primary"
                type={showToken() ? "text" : "password"}
                value={token()}
                onInput={(e) => setToken(e.currentTarget.value)}
                placeholder="123456:ABC-DEF..."
              />
              <button
                class="px-2 py-1.5 text-sm rounded-card-sm border border-border hover:bg-surface"
                onClick={() => setShowToken(!showToken())}
                type="button"
                title={showToken() ? "Hide" : "Show"}
              >
                {showToken() ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {/* Chat ID */}
          <div>
            <label class="block text-xs font-body text-text-muted mb-1">
              Chat ID
            </label>
            <input
              class="w-full px-3 py-1.5 text-sm font-body rounded-card-sm border border-border bg-background text-text-primary"
              type="text"
              value={chatId()}
              onInput={(e) => setChatId(e.currentTarget.value)}
              placeholder="987654321"
            />
          </div>

          {/* Test + Save */}
          <div class="flex items-center gap-2">
            <button
              class="px-3 py-1.5 text-sm font-body font-medium rounded-card-sm border border-border hover:bg-surface disabled:opacity-50"
              onClick={handleTest}
              disabled={testing() || token().trim() === ""}
            >
              {testing() ? "Testing..." : "Test"}
            </button>
            <button
              class="px-3 py-1.5 text-sm font-body font-medium rounded-card-sm bg-orange-primary text-white hover:bg-orange-hover disabled:opacity-50"
              onClick={handleSave}
              disabled={saving() || !hasUnsavedChanges()}
            >
              {saving() ? "Saving..." : "Save"}
            </button>
          </div>

          {/* Test result inline */}
          <Show when={testResult()}>
            {(r) => (
              <p
                class="text-xs font-body"
                classList={{
                  "text-green-600": r().ok,
                  "text-red-600": !r().ok,
                }}
              >
                {r().msg}
              </p>
            )}
          </Show>

          {/* Runtime error */}
          <Show when={telegramStore.status.error}>
            <p class="text-xs font-body text-red-600">
              ⚠️ {telegramStore.status.error}
            </p>
          </Show>
        </div>
      </div>
    </div>
  );
}
