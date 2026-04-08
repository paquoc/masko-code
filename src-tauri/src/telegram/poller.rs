// src-tauri/src/telegram/poller.rs

use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::sync::{watch, Mutex, RwLock};

use crate::telegram::client::TelegramClient;
use crate::telegram::state::QueueState;
use crate::telegram::types::{
    PollerCmd, TelegramConfig, TelegramError, TelegramStatus,
};

/// The poller owns a tokio task that long-polls `getUpdates` and dispatches
/// updates to the manager. It stops when it receives `PollerCmd::Stop` or
/// `PollerCmd::ConfigChanged` — in both cases the caller is responsible for
/// respawning if desired.
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
    const MAX_BACKOFF: Duration = Duration::from_secs(10);
    const LONG_POLL_SECS: u64 = 30;

    // Set status = Running, clear error.
    {
        let mut s = status.write().await;
        s.enabled = true;
        s.error = None;
    }
    emit_status(&app, &status).await;

    loop {
        tokio::select! {
            _ = rx.changed() => {
                let cmd = rx.borrow().clone();
                match cmd {
                    PollerCmd::Stop | PollerCmd::ConfigChanged => break,
                }
            }
            result = client.get_updates(offset, LONG_POLL_SECS) => {
                match result {
                    Ok(updates) => {
                        backoff = Duration::from_secs(1);
                        for u in updates {
                            offset = u.update_id + 1;
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
                        s.enabled = false;
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
                        tokio::time::sleep(Duration::from_secs(5)).await;
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

    // Task exit — set enabled=false unless an error has been recorded with a
    // distinct "reason to resume" semantic. We only clear enabled here to
    // reflect that the task is no longer running.
    {
        let mut s = status.write().await;
        s.enabled = false;
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
