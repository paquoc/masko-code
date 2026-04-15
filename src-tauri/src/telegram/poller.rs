// src-tauri/src/telegram/poller.rs

use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use tokio::sync::{watch, Mutex, RwLock};

use crate::telegram::client::TelegramClient;
use crate::telegram::state::QueueState;
use crate::telegram::types::{
    PollerCmd, TelegramConfig, TelegramError, TelegramStatus,
};

/// The poller owns a tokio task that long-polls `getUpdates` and dispatches
/// updates to the manager. It stops when it receives `PollerCmd::Stop` or
/// `PollerCmd::ConfigChanged`. When `sending_enabled` is true the poller uses
/// long-poll (30s); when false it uses short-poll (5s) to stay responsive to
/// /on and /off commands without burning resources.
pub async fn run_poller(
    config: TelegramConfig,
    state: Arc<Mutex<QueueState>>,
    status: Arc<RwLock<TelegramStatus>>,
    app: AppHandle,
    mut rx: watch::Receiver<PollerCmd>,
) {
    let client = TelegramClient::new(config.bot_token.clone());
    let mut offset: i64 = 0;
    let mut backoff = Duration::from_secs(1);
    let mut first_success_at: Option<Instant> = None;
    let mut consecutive_conflicts: u32 = 0;
    const MAX_BACKOFF: Duration = Duration::from_secs(10);
    const MAX_CONSECUTIVE_CONFLICTS: u32 = 3;
    const MIN_ESTABLISHED_SECS: u64 = 60;
    const POLL_SECS: u64 = 30;

    mlog!(
        "[telegram] poller starting — chat_id={} token_len={}",
        config.chat_id,
        config.bot_token.len()
    );

    // Diagnose + unconditionally clear any lingering webhook. Webhook mode
    // (and sometimes stale webhook entries even after URL is cleared) causes
    // getUpdates to return 409 Conflict. deleteWebhook is idempotent.
    match client.get_webhook_info().await {
        Ok(info) => {
            let url = info
                .get("result")
                .and_then(|r| r.get("url"))
                .and_then(|u| u.as_str())
                .unwrap_or("");
            let pending = info
                .get("result")
                .and_then(|r| r.get("pending_update_count"))
                .and_then(|p| p.as_i64())
                .unwrap_or(-1);
            mlog!(
                "[telegram] getWebhookInfo url={:?} pending={}",
                url,
                pending
            );
        }
        Err(e) => mlog_err!("[telegram] getWebhookInfo failed: {:?}", e),
    }
    mlog!("[telegram] calling deleteWebhook (unconditional)");
    if let Err(e) = client.delete_webhook().await {
        mlog_err!("[telegram] deleteWebhook failed: {:?}", e);
    }

    // Set status = polling running, clear error.
    {
        let mut s = status.write().await;
        s.polling_enabled = true;
        s.error = None;
    }
    emit_status(&app, &status).await;

    loop {
        tokio::select! {
            _ = rx.changed() => {
                let cmd = rx.borrow().clone();
                mlog!("[telegram] poller received cmd={:?}", cmd);
                match cmd {
                    PollerCmd::Stop | PollerCmd::ConfigChanged => break,
                }
            }
            result = client.get_updates(offset, POLL_SECS) => {
                match result {
                    Ok(updates) => {
                        backoff = Duration::from_secs(1);
                        consecutive_conflicts = 0;
                        if first_success_at.is_none() {
                            first_success_at = Some(Instant::now());
                        }
                        mlog!(
                            "[telegram] getUpdates ok — offset={} count={} timeout={}",
                            offset,
                            updates.len(),
                            POLL_SECS,
                        );
                        for u in updates {
                            offset = u.update_id + 1;
                            mlog!(
                                "[telegram] update_id={} has_msg={} has_callback={}",
                                u.update_id,
                                u.message.is_some(),
                                u.callback_query.is_some()
                            );
                            super::dispatch::handle_update(
                                u,
                                &client,
                                &state,
                                &config,
                                &status,
                                &app,
                            )
                            .await;
                        }
                    }
                    Err(TelegramError::Unauthorized) => {
                        let mut s = status.write().await;
                        s.polling_enabled = false;
                        s.error = Some("Invalid bot token".into());
                        drop(s);
                        emit_status(&app, &status).await;
                        notify_fatal(&app, "Invalid bot token");
                        break;
                    }
                    Err(TelegramError::TooManyRequests(retry_after)) => {
                        tokio::time::sleep(Duration::from_secs(retry_after)).await;
                    }
                    Err(TelegramError::Conflict) => {
                        consecutive_conflicts += 1;
                        let is_established = first_success_at
                            .map(|t| t.elapsed().as_secs() >= MIN_ESTABLISHED_SECS)
                            .unwrap_or(false);
                        mlog_err!(
                            "[telegram] getUpdates CONFLICT — consecutive={} established={}",
                            consecutive_conflicts,
                            is_established,
                        );
                        if is_established && consecutive_conflicts >= MAX_CONSECUTIVE_CONFLICTS {
                            mlog_err!("[telegram] yielding to newer instance — stopping poller");
                            let mut s = status.write().await;
                            s.polling_enabled = false;
                            s.error = Some("Phát hiện instance khác đang chạy".into());
                            drop(s);
                            emit_status(&app, &status).await;
                            notify_fatal(&app, "Phát hiện instance khác đang chạy");
                            return;
                        }
                        if let Err(e) = client.delete_webhook().await {
                            mlog_err!("[telegram] deleteWebhook (on conflict) failed: {:?}", e);
                        }
                        // Not yet established = stale connection from previous session.
                        // Wait longer so Telegram has time to release it.
                        let wait = if is_established { 2 } else { 5 };
                        tokio::time::sleep(Duration::from_secs(wait)).await;
                    }
                    Err(TelegramError::Server(msg)) | Err(TelegramError::Network(msg)) => {
                        mlog_err!("Telegram poll error: {msg}");
                        tokio::time::sleep(backoff).await;
                        backoff = (backoff * 2).min(MAX_BACKOFF);
                    }
                    Err(TelegramError::Api(msg)) => {
                        mlog_err!("Telegram API error: {msg}");
                        tokio::time::sleep(backoff).await;
                        backoff = (backoff * 2).min(MAX_BACKOFF);
                    }
                }
            }
        }
    }

    // Task exit — clear polling_enabled to reflect that the task is no longer running.
    {
        let mut s = status.write().await;
        s.polling_enabled = false;
    }
    emit_status(&app, &status).await;
}

pub async fn emit_status(app: &AppHandle, status: &Arc<RwLock<TelegramStatus>>) {
    let snapshot = status.read().await.clone();
    app.emit("telegram://status-changed", snapshot).ok();
}

fn notify_fatal(app: &AppHandle, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title("Telegram Bot")
        .body(format!("Polling dừng: {body}. Mở Settings để kiểm tra."))
        .show();
}
