// src-tauri/src/telegram/mod.rs

pub mod client;
pub mod config;
pub mod formatter;
pub mod poller;
pub mod state;
pub mod types;

use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{watch, Mutex, RwLock};

use crate::models::AgentEvent;
use crate::telegram::client::TelegramClient;
use crate::telegram::state::{
    ActivePermission, PushOutcome, QueueState, QuestionState, RemoveOutcome,
};
use crate::telegram::types::{
    InlineKeyboardButton, InlineKeyboardMarkup, PollerCmd, TelegramConfig, TelegramConfigDto,
    TelegramError, TelegramStatus, TelegramTestResult,
};

/// The singleton that owns config, status, queue state, and the poller task.
pub struct TelegramManager {
    pub config: Arc<RwLock<TelegramConfig>>,
    pub status: Arc<RwLock<TelegramStatus>>,
    pub state: Arc<Mutex<QueueState>>,
    pub tx: Arc<Mutex<Option<watch::Sender<PollerCmd>>>>,
    pub app: AppHandle,
}

impl TelegramManager {
    pub async fn init(app: AppHandle) -> Arc<Self> {
        let path = config::config_path(&app).ok();
        let cfg = match &path {
            Some(p) => config::load_from(p).unwrap_or_default(),
            None => TelegramConfig::default(),
        };
        let status = TelegramStatus {
            configured: cfg.is_configured(),
            enabled: false,
            error: None,
            bot_username: None,
        };
        let manager = Arc::new(Self {
            config: Arc::new(RwLock::new(cfg.clone())),
            status: Arc::new(RwLock::new(status)),
            state: Arc::new(Mutex::new(QueueState::default())),
            tx: Arc::new(Mutex::new(None)),
            app: app.clone(),
        });

        // Auto-start poller if `enabled && configured`
        if cfg.enabled && cfg.is_configured() {
            let m = manager.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = m.start_poller().await {
                    mlog_err!("Telegram auto-start failed: {e}");
                }
            });
        }

        manager
    }

    pub async fn get_status(&self) -> TelegramStatus {
        self.status.read().await.clone()
    }

    pub async fn get_config_dto(&self) -> TelegramConfigDto {
        let c = self.config.read().await;
        TelegramConfigDto {
            bot_token: c.bot_token.clone(),
            chat_id: c.chat_id.clone(),
        }
    }

    pub async fn save_config(self: &Arc<Self>, token: String, chat_id: String) -> Result<(), String> {
        let mut c = self.config.write().await;
        let token_changed = c.bot_token != token;
        let chat_changed = c.chat_id != chat_id;
        c.bot_token = token;
        c.chat_id = chat_id;
        let snapshot = c.clone();
        drop(c);

        if let Ok(path) = config::config_path(&self.app) {
            config::save_to(&path, &snapshot)?;
        }

        // Clear any recorded error — Save is treated as acknowledging it.
        {
            let mut s = self.status.write().await;
            s.error = None;
            s.configured = snapshot.is_configured();
        }
        self.emit_status().await;

        // If config changed and the persisted `enabled` flag is true, ensure
        // a fresh poller is running with the new config. Also drop queue state
        // because message_ids belong to the old bot/chat.
        if (token_changed || chat_changed) && snapshot.enabled && snapshot.is_configured() {
            self.stop_poller().await;
            self.state.lock().await.clear();
            self.start_poller().await?;
        } else if snapshot.enabled && snapshot.is_configured() {
            // Not running yet (e.g. after fatal error) — try to start.
            let running = self.tx.lock().await.is_some();
            if !running {
                self.start_poller().await?;
            }
        }

        Ok(())
    }

    pub async fn test(
        &self,
        token: String,
        chat_id: Option<String>,
    ) -> Result<TelegramTestResult, String> {
        let client = TelegramClient::new(token);
        let bot = client.get_me().await.map_err(|e| e.to_string())?;
        let mut chat_tested = false;
        if let Some(cid) = chat_id.filter(|c| !c.trim().is_empty()) {
            client
                .send_message(&cid, "🏓 Masko Code test message", None)
                .await
                .map_err(|e| e.to_string())?;
            chat_tested = true;
        }
        Ok(TelegramTestResult {
            bot_username: bot.username,
            bot_first_name: bot.first_name,
            chat_tested,
        })
    }

    pub async fn set_enabled(self: &Arc<Self>, enabled: bool) -> Result<(), String> {
        let mut c = self.config.write().await;
        if enabled && !c.is_configured() {
            return Err("Not configured".into());
        }
        c.enabled = enabled;
        let snapshot = c.clone();
        drop(c);
        if let Ok(path) = config::config_path(&self.app) {
            config::save_to(&path, &snapshot)?;
        }
        if enabled {
            self.start_poller().await?;
        } else {
            self.stop_poller().await;
            self.state.lock().await.clear();
            {
                let mut s = self.status.write().await;
                s.enabled = false;
                s.error = None;
            }
            self.emit_status().await;
        }
        Ok(())
    }

    pub async fn start_poller(self: &Arc<Self>) -> Result<(), String> {
        let mut tx_slot = self.tx.lock().await;
        if tx_slot.is_some() {
            return Ok(()); // already running
        }
        let cfg = self.config.read().await.clone();
        if !cfg.is_configured() {
            return Err("Not configured".into());
        }
        let (tx, rx) = watch::channel(PollerCmd::ConfigChanged);
        *tx_slot = Some(tx);
        drop(tx_slot);

        let state = self.state.clone();
        let status = self.status.clone();
        let app = self.app.clone();
        let tx_holder = self.tx.clone();

        tauri::async_runtime::spawn(async move {
            poller::run_poller(cfg, state, status, app, rx).await;
            *tx_holder.lock().await = None;
        });

        Ok(())
    }

    pub async fn stop_poller(&self) {
        let mut tx_slot = self.tx.lock().await;
        if let Some(tx) = tx_slot.take() {
            let _ = tx.send(PollerCmd::Stop);
        }
    }

    pub async fn emit_status(&self) {
        let snapshot = self.status.read().await.clone();
        self.app.emit("telegram://status-changed", snapshot).ok();
    }

    /// Called by server.rs when a permission request arrives from the hook.
    pub async fn push_permission(self: &Arc<Self>, event: AgentEvent, request_id: String) {
        let enabled = self.status.read().await.enabled;
        if !enabled {
            return;
        }
        let outcome = {
            let mut s = self.state.lock().await;
            s.push(event.clone(), request_id.clone())
        };
        if matches!(outcome, PushOutcome::ShouldSendNow) {
            self.send_now(event, request_id).await;
        }
    }

    /// Called by commands.rs after the HTTP response is sent to the hook.
    pub async fn on_local_resolved(self: &Arc<Self>, request_id: &str, decision: &str) {
        let outcome = {
            let mut s = self.state.lock().await;
            s.remove_by_request_id(request_id)
        };
        match outcome {
            RemoveOutcome::WasActive { previous, next } => {
                let cfg = self.config.read().await.clone();
                let decision_label = pretty_decision(decision).to_string();
                let client = TelegramClient::new(cfg.bot_token.clone());
                let chat_id = cfg.chat_id.clone();
                let manager = self.clone();

                tauri::async_runtime::spawn(async move {
                    let _ = client
                        .edit_message_reply_markup(&chat_id, previous.message_id, None)
                        .await;
                    let text = format!("✓ Đã xử lý ở máy local ({decision_label})");
                    let _ = client.send_message(&chat_id, &text, None).await;

                    if let Some(queued) = next {
                        manager.send_now(queued.event, queued.request_id).await;
                    }
                });
            }
            RemoveOutcome::RemovedFromQueue | RemoveOutcome::NotFound => {
                // nothing to do
            }
        }
    }

    /// Build inline keyboard + call sendMessage + cache active permission.
    pub(crate) async fn send_now(self: &Arc<Self>, event: AgentEvent, request_id: String) {
        let cfg = self.config.read().await.clone();
        if !cfg.is_configured() {
            return;
        }

        // Branch on AskUserQuestion vs regular permission.
        if formatter::is_question(&event) {
            self.send_question_now(event, request_id, &cfg).await;
            return;
        }

        let html = formatter::build_html(&event);
        let suggestions = event
            .permission_suggestions
            .as_ref()
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let first = suggestions.first().cloned();
        let markup = build_keyboard(first.as_ref());
        let client = TelegramClient::new(cfg.bot_token.clone());

        let send_res = retry_send(&client, &cfg.chat_id, &html, Some(&markup)).await;
        match send_res {
            Ok(sent) => {
                let mut s = self.state.lock().await;
                s.set_active(ActivePermission {
                    request_id,
                    message_id: sent.message_id,
                    suggestion: first,
                    question: None,
                });
            }
            Err(e) => {
                mlog_err!("Telegram sendMessage failed: {e}");
                self.app
                    .emit(
                        "telegram://send-failed",
                        json!({ "request_id": request_id, "error": e.to_string() }),
                    )
                    .ok();
            }
        }
    }

    /// Send the first question of an AskUserQuestion. Subsequent questions
    /// are sent by `send_next_question` after each answer.
    async fn send_question_now(
        self: &Arc<Self>,
        event: AgentEvent,
        request_id: String,
        cfg: &TelegramConfig,
    ) {
        let questions = formatter::parse_questions(&event);
        if questions.is_empty() {
            // Fall back to regular render if the payload is malformed.
            let html = formatter::build_html(&event);
            let markup = build_keyboard(None);
            let client = TelegramClient::new(cfg.bot_token.clone());
            if let Ok(sent) = retry_send(&client, &cfg.chat_id, &html, Some(&markup)).await {
                let mut s = self.state.lock().await;
                s.set_active(ActivePermission {
                    request_id,
                    message_id: sent.message_id,
                    suggestion: None,
                    question: None,
                });
            }
            return;
        }

        let total = questions.len();
        let first_q = &questions[0];
        let html = formatter::build_question_html(&event, first_q, 0, total);
        let markup = build_question_keyboard(first_q.options.len());
        let client = TelegramClient::new(cfg.bot_token.clone());
        let cwd = event.cwd.clone();

        let send_res = retry_send(&client, &cfg.chat_id, &html, markup.as_ref()).await;
        match send_res {
            Ok(sent) => {
                let mut s = self.state.lock().await;
                s.set_active(ActivePermission {
                    request_id,
                    message_id: sent.message_id,
                    suggestion: None,
                    question: Some(QuestionState {
                        questions,
                        current_index: 0,
                        collected: Vec::new(),
                        cwd,
                    }),
                });
            }
            Err(e) => {
                mlog_err!("Telegram sendMessage failed (question): {e}");
                self.app
                    .emit(
                        "telegram://send-failed",
                        json!({ "request_id": request_id, "error": e.to_string() }),
                    )
                    .ok();
            }
        }
    }
}

fn pretty_decision(decision: &str) -> &str {
    match decision {
        "" => "Resolved",
        "allow" => "Approved",
        "deny" => "Denied",
        other => other,
    }
}

fn build_keyboard(suggestion: Option<&Value>) -> InlineKeyboardMarkup {
    let mut rows: Vec<Vec<InlineKeyboardButton>> = vec![vec![InlineKeyboardButton {
        text: "✅ Approve".into(),
        callback_data: "approve".into(),
    }]];
    if let Some(s) = suggestion {
        let label = formatter::display_label_for(s);
        rows.push(vec![InlineKeyboardButton {
            text: format!("⚡ {label}"),
            callback_data: "allow_suggestion".into(),
        }]);
    }
    rows.push(vec![InlineKeyboardButton {
        text: "❌ Deny".into(),
        callback_data: "deny".into(),
    }]);
    InlineKeyboardMarkup { inline_keyboard: rows }
}

/// Build an inline keyboard for an AskUserQuestion with numbered buttons
/// "1", "2", ..., wrapping to a new row every 8 buttons. No "Other" button —
/// the user types free text to provide a custom answer.
fn build_question_keyboard(num_options: usize) -> Option<InlineKeyboardMarkup> {
    if num_options == 0 {
        return None;
    }
    const PER_ROW: usize = 8;
    let mut rows: Vec<Vec<InlineKeyboardButton>> = Vec::new();
    let mut row: Vec<InlineKeyboardButton> = Vec::with_capacity(PER_ROW);
    for i in 0..num_options {
        row.push(InlineKeyboardButton {
            text: format!("{}", i + 1),
            callback_data: format!("q:{}", i + 1),
        });
        if row.len() == PER_ROW {
            rows.push(std::mem::take(&mut row));
        }
    }
    if !row.is_empty() {
        rows.push(row);
    }
    Some(InlineKeyboardMarkup { inline_keyboard: rows })
}

async fn retry_send(
    client: &TelegramClient,
    chat_id: &str,
    html: &str,
    markup: Option<&InlineKeyboardMarkup>,
) -> Result<crate::telegram::types::SentMessage, TelegramError> {
    let delays = [std::time::Duration::from_secs(1), std::time::Duration::from_secs(3)];
    let mut last_err = None;
    for attempt in 0..=delays.len() {
        match client.send_message(chat_id, html, markup).await {
            Ok(ok) => return Ok(ok),
            Err(e) => {
                last_err = Some(e);
                if attempt < delays.len() {
                    tokio::time::sleep(delays[attempt]).await;
                }
            }
        }
    }
    Err(last_err.unwrap())
}

// ===== Update dispatch (called from poller) =====

pub(crate) mod dispatch {
    use super::*;
    use crate::telegram::types::Update;

    pub async fn handle_update(
        update: Update,
        client: &TelegramClient,
        state: &Arc<Mutex<QueueState>>,
        config: &TelegramConfig,
        _status: &Arc<RwLock<TelegramStatus>>,
        app: &AppHandle,
    ) {
        if let Some(cb) = update.callback_query {
            handle_callback(cb, client, state, config, app).await;
            return;
        }
        if let Some(msg) = update.message {
            handle_message(msg, client, state, config, app).await;
        }
    }

    async fn handle_callback(
        cb: crate::telegram::types::CallbackQuery,
        client: &TelegramClient,
        state: &Arc<Mutex<QueueState>>,
        config: &TelegramConfig,
        app: &AppHandle,
    ) {
        // Auth check.
        if cb.from.id.to_string() != config.chat_id {
            let _ = client.answer_callback_query(&cb.id, "Unauthorized").await;
            return;
        }

        let data = cb.data.clone().unwrap_or_default();

        // Question answer callback: "q:N" (1-based).
        if let Some(n_str) = data.strip_prefix("q:") {
            let n: usize = match n_str.parse() {
                Ok(n) if n >= 1 => n,
                _ => {
                    let _ = client.answer_callback_query(&cb.id, "Invalid").await;
                    return;
                }
            };
            // Resolve the answer label under lock so we can ack the callback
            // with useful text even if state advances.
            let answer_text = {
                let s = state.lock().await;
                s.active
                    .as_ref()
                    .and_then(|a| a.question.as_ref())
                    .and_then(|q| q.questions.get(q.current_index))
                    .and_then(|cur| cur.options.get(n - 1))
                    .map(|o| o.label.clone())
            };
            let Some(answer_text) = answer_text else {
                let _ = client.answer_callback_query(&cb.id, "No active question").await;
                return;
            };
            let _ = client
                .answer_callback_query(&cb.id, &format!("✓ {answer_text}"))
                .await;
            process_question_answer(answer_text, state, client, config, app).await;
            return;
        }

        // Regular permission callbacks.
        // Check active FIRST so we can show an accurate toast — a stale
        // button (from a message whose permission was already resolved or
        // dropped) must not fire a misleading "✓ Approved" toast.
        let tapped_msg_id = cb.message.as_ref().map(|m| m.message_id);
        let (active, next) = {
            let mut s = state.lock().await;
            // Only consume the active permission if the tapped button belongs
            // to the current active message. Otherwise treat as stale.
            let is_current = match (s.active.as_ref(), tapped_msg_id) {
                (Some(a), Some(mid)) => a.message_id == mid,
                (Some(_), None) => true, // no message on callback — assume current
                _ => false,
            };
            if is_current {
                let active = s.active.clone();
                let next = s.resolve_active();
                (active, next)
            } else {
                (None, None)
            }
        };

        let Some(active) = active else {
            // Stale button — either no active permission or the tapped
            // message is from a previous resolved/cleared permission.
            let _ = client
                .answer_callback_query(&cb.id, "⌛ Expired — request no longer pending")
                .await;
            // Also clear the orphaned keyboard so the user can't re-tap.
            if let Some(mid) = tapped_msg_id {
                let _ = client
                    .edit_message_reply_markup(&config.chat_id, mid, None)
                    .await;
            }
            return;
        };

        // Active matched — fire the real toast now.
        let toast = match data.as_str() {
            "approve" => "✓ Approved",
            "allow_suggestion" => "⚡ Applied suggestion",
            "deny" => "✗ Denied",
            _ => "?",
        };
        let _ = client.answer_callback_query(&cb.id, toast).await;

        // Edit keyboard away on the original message.
        if let Some(msg) = &cb.message {
            let _ = client
                .edit_message_reply_markup(&config.chat_id, msg.message_id, None)
                .await;
        } else {
            let _ = client
                .edit_message_reply_markup(&config.chat_id, active.message_id, None)
                .await;
        }

        // Send a follow-up message confirming the choice (in addition to the
        // brief toast from answerCallbackQuery, which is easy to miss).
        let followup = match data.as_str() {
            "approve" => Some("✓ Approved".to_string()),
            "deny" => Some("✗ Denied".to_string()),
            "allow_suggestion" => {
                let label = active
                    .suggestion
                    .as_ref()
                    .map(formatter::display_label_for)
                    .unwrap_or_else(|| "suggestion".to_string());
                Some(format!("⚡ Applied: {label}"))
            }
            _ => None,
        };
        if let Some(text) = followup {
            let _ = client.send_message(&config.chat_id, &text, None).await;
        }

        let (decision, suggestion) = match data.as_str() {
            "approve" => ("allow", None),
            "deny" => ("deny", None),
            "allow_suggestion" => ("allow", active.suggestion.clone()),
            _ => return,
        };

        let mut payload = json!({
            "request_id": active.request_id,
            "decision": decision,
        });
        if let Some(s) = suggestion {
            payload["suggestion"] = s;
        }
        app.emit("telegram://permission-response", payload).ok();

        // Pop next queued permission (if any) and send it.
        if let Some(next) = next {
            let manager = app.state::<Arc<TelegramManager>>().inner().clone();
            manager.send_now(next.event, next.request_id).await;
        }
    }

    async fn handle_message(
        msg: crate::telegram::types::Message,
        client: &TelegramClient,
        state: &Arc<Mutex<QueueState>>,
        config: &TelegramConfig,
        app: &AppHandle,
    ) {
        if msg.chat.id.to_string() != config.chat_id {
            return; // silent ignore
        }
        let Some(text) = msg.text.clone() else {
            return; // ignore stickers, photos, etc.
        };

        // Check what the active permission is (or lack thereof) under lock.
        let is_question = {
            let s = state.lock().await;
            match s.active.as_ref() {
                None => None,
                Some(a) => Some(a.question.is_some()),
            }
        };

        let Some(is_question) = is_question else {
            let _ = client
                .send_message(&config.chat_id, "Hiện không có request nào đang chờ", None)
                .await;
            return;
        };

        if is_question {
            // Free-text answer to the current question.
            process_question_answer(text, state, client, config, app).await;
            return;
        }

        // Regular permission free-text → deny with feedback.
        let (active, next) = {
            let mut s = state.lock().await;
            let active = s.active.clone();
            let next = s.resolve_active();
            (active, next)
        };
        let Some(active) = active else { return };

        let _ = client
            .edit_message_reply_markup(&config.chat_id, active.message_id, None)
            .await;

        let payload = json!({
            "request_id": active.request_id,
            "decision": "deny",
            "feedback_text": text,
        });
        app.emit("telegram://permission-response", payload).ok();

        if let Some(next) = next {
            let manager = app.state::<Arc<TelegramManager>>().inner().clone();
            manager.send_now(next.event, next.request_id).await;
        }
    }

    /// Process an answer (either from a "q:N" callback or free text) for the
    /// currently active question. Advances to the next question in the batch
    /// or finalizes with all collected answers and emits the response.
    async fn process_question_answer(
        answer: String,
        state: &Arc<Mutex<QueueState>>,
        client: &TelegramClient,
        config: &TelegramConfig,
        app: &AppHandle,
    ) {
        enum Step {
            Advance {
                old_msg_id: i64,
                next_q: crate::telegram::state::ParsedQuestion,
                next_index: usize,
                total: usize,
                event: AgentEvent,
            },
            Finalize {
                old_msg_id: i64,
                answers: Vec<String>,
                request_id: String,
                next: Option<crate::telegram::state::Queued>,
            },
        }

        let step = {
            let mut s = state.lock().await;
            let Some(active) = s.active.as_mut() else {
                return;
            };
            let Some(qstate) = active.question.as_mut() else {
                return;
            };
            qstate.collected.push(answer);
            let next_index = qstate.current_index + 1;
            if next_index < qstate.questions.len() {
                let old_msg_id = active.message_id;
                let next_q = qstate.questions[next_index].clone();
                let total = qstate.questions.len();
                // Rebuild a minimal event with just the cached cwd so the
                // follow-up question keeps the same project folder header.
                let event = placeholder_event_for_question(qstate.cwd.clone());
                Step::Advance {
                    old_msg_id,
                    next_q,
                    next_index,
                    total,
                    event,
                }
            } else {
                let old_msg_id = active.message_id;
                let answers = qstate.collected.clone();
                let request_id = active.request_id.clone();
                let next = s.resolve_active();
                Step::Finalize {
                    old_msg_id,
                    answers,
                    request_id,
                    next,
                }
            }
        };

        match step {
            Step::Advance {
                old_msg_id,
                next_q,
                next_index,
                total,
                event,
            } => {
                // Clear keyboard on the previous message.
                let _ = client
                    .edit_message_reply_markup(&config.chat_id, old_msg_id, None)
                    .await;
                // Send the next question.
                let html = formatter::build_question_html(&event, &next_q, next_index, total);
                let markup = build_question_keyboard(next_q.options.len());
                if let Ok(sent) = client
                    .send_message(&config.chat_id, &html, markup.as_ref())
                    .await
                {
                    // Update the active permission with the new message_id
                    // and advance the current_index.
                    let mut s = state.lock().await;
                    if let Some(active) = s.active.as_mut() {
                        if let Some(q) = active.question.as_mut() {
                            active.message_id = sent.message_id;
                            q.current_index = next_index;
                        }
                    }
                }
            }
            Step::Finalize {
                old_msg_id,
                answers,
                request_id,
                next,
            } => {
                // Clear keyboard and post a confirmation.
                let _ = client
                    .edit_message_reply_markup(&config.chat_id, old_msg_id, None)
                    .await;
                let summary = answers
                    .iter()
                    .enumerate()
                    .map(|(i, a)| format!("{}. {}", i + 1, a))
                    .collect::<Vec<_>>()
                    .join("\n");
                let text = if answers.len() == 1 {
                    format!("✓ Answered: {}", answers[0])
                } else {
                    format!("✓ Answered:\n{summary}")
                };
                let _ = client.send_message(&config.chat_id, &text, None).await;

                // Emit permission-response with updatedInput.answers.
                let payload = json!({
                    "request_id": request_id,
                    "decision": "allow",
                    "suggestion": {
                        "type": "updatedInput",
                        "answers": answers,
                    },
                });
                app.emit("telegram://permission-response", payload).ok();

                if let Some(next) = next {
                    let manager = app.state::<Arc<TelegramManager>>().inner().clone();
                    manager.send_now(next.event, next.request_id).await;
                }
            }
        }
    }

    /// Minimal placeholder AgentEvent used when re-rendering a follow-up
    /// question whose original event we no longer retain. Only `cwd` is
    /// carried through because `build_question_html` only reads that field.
    fn placeholder_event_for_question(cwd: Option<String>) -> AgentEvent {
        AgentEvent {
            hook_event_name: "PermissionRequest".into(),
            session_id: None,
            cwd,
            permission_mode: None,
            transcript_path: None,
            tool_name: Some("AskUserQuestion".into()),
            tool_input: None,
            tool_response: None,
            tool_use_id: None,
            message: None,
            title: None,
            notification_type: None,
            source: None,
            reason: None,
            model: None,
            stop_hook_active: None,
            last_assistant_message: None,
            agent_id: None,
            agent_type: None,
            task_id: None,
            task_subject: None,
            permission_suggestions: None,
        }
    }
}
