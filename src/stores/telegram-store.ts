// src/stores/telegram-store.ts
import { createStore } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { permissionStore } from "./permission-store";
import { log, error } from "../services/log";

export interface TelegramStatus {
  configured: boolean;
  enabled: boolean;
  error: string | null;
  bot_username: string | null;
}

export interface TelegramTestResult {
  bot_username: string;
  bot_first_name: string;
  chat_tested: boolean;
}

export interface TelegramConfigDto {
  bot_token: string;
  chat_id: string;
}

const [status, setStatus] = createStore<TelegramStatus>({
  configured: false,
  enabled: false,
  error: null,
  bot_username: null,
});

let initialized = false;

export async function initTelegramStore(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const s = await invoke<TelegramStatus>("telegram_get_status");
    setStatus(s);
  } catch (e) {
    error("telegram_get_status failed:", e);
  }

  await listen<TelegramStatus>("telegram://status-changed", (e) => {
    setStatus(e.payload);
  });

  await listen<{
    request_id: string;
    decision: "allow" | "deny";
    suggestion?: any;
    feedback_text?: string;
  }>("telegram://permission-response", (e) => {
    const { request_id, decision, suggestion, feedback_text } = e.payload;
    log("[telegram] permission-response", request_id, decision);
    const payloadSuggestion = feedback_text
      ? { type: "feedback", reason: feedback_text }
      : suggestion;
    permissionStore.resolve(request_id, decision, payloadSuggestion);
  });

  await listen<{ request_id: string; error: string }>(
    "telegram://send-failed",
    (e) => {
      error("[telegram] sendMessage failed", e.payload);
    },
  );
}

export const telegramStore = {
  get status() {
    return status;
  },

  async getConfig(): Promise<TelegramConfigDto> {
    return invoke<TelegramConfigDto>("telegram_get_config");
  },

  async saveConfig(token: string, chatId: string): Promise<void> {
    await invoke("telegram_save_config", { token, chatId });
    const s = await invoke<TelegramStatus>("telegram_get_status");
    setStatus(s);
  },

  async test(token: string, chatId: string | null): Promise<TelegramTestResult> {
    return invoke<TelegramTestResult>("telegram_test", { token, chatId });
  },

  async setEnabled(enabled: boolean): Promise<void> {
    await invoke("telegram_set_enabled", { enabled });
    const s = await invoke<TelegramStatus>("telegram_get_status");
    setStatus(s);
  },
};
