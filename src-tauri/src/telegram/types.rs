//! Wire + internal types for the Telegram module.
//!
//! These are intentionally minimal — only the fields we actually read are
//! deserialized. Extra fields from the Bot API are ignored via serde default.


use serde::{Deserialize, Serialize};

/// Persisted config (mirrors `telegram.json` on disk).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TelegramConfig {
    #[serde(default)]
    pub polling_enabled: bool,
    #[serde(default)]
    pub sending_enabled: bool,
    #[serde(default)]
    pub bot_token: String,
    #[serde(default)]
    pub chat_id: String,
}

impl TelegramConfig {
    /// True iff both bot_token and chat_id are non-empty (trimmed).
    pub fn is_configured(&self) -> bool {
        !self.bot_token.trim().is_empty() && !self.chat_id.trim().is_empty()
    }
}

/// Status emitted to the frontend (never contains bot_token).
#[derive(Debug, Clone, Default, Serialize)]
pub struct TelegramStatus {
    pub configured: bool,
    pub polling_enabled: bool,
    pub sending_enabled: bool,
    pub error: Option<String>,
    pub bot_username: Option<String>,
}

/// DTO returned by `telegram_get_config` — token IS included here per spec.
#[derive(Debug, Clone, Serialize)]
pub struct TelegramConfigDto {
    pub bot_token: String,
    pub chat_id: String,
}

/// Result of `telegram_test` command.
#[derive(Debug, Clone, Serialize)]
pub struct TelegramTestResult {
    pub bot_username: String,
    pub bot_first_name: String,
    pub chat_tested: bool,
}

// ----- Bot API wire types (minimal) -----

#[derive(Debug, Clone, Deserialize)]
pub struct Update {
    pub update_id: i64,
    #[serde(default)]
    pub message: Option<Message>,
    #[serde(default)]
    pub callback_query: Option<CallbackQuery>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Message {
    pub message_id: i64,
    pub chat: Chat,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Chat {
    pub id: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct User {
    pub id: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CallbackQuery {
    pub id: String,
    pub from: User,
    #[serde(default)]
    pub message: Option<Message>,
    #[serde(default)]
    pub data: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BotUser {
    pub username: String,
    pub first_name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SentMessage {
    pub message_id: i64,
}

// ----- Inline keyboard (outgoing) -----

#[derive(Debug, Clone, Serialize)]
pub struct InlineKeyboardMarkup {
    pub inline_keyboard: Vec<Vec<InlineKeyboardButton>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InlineKeyboardButton {
    pub text: String,
    pub callback_data: String,
}

// ----- Poller control + errors -----

#[derive(Debug, Clone)]
pub enum PollerCmd {
    Stop,
    ConfigChanged,
}

#[derive(Debug, thiserror::Error)]
pub enum TelegramError {
    #[error("unauthorized (invalid bot token)")]
    Unauthorized,
    #[error("too many requests (retry after {0}s)")]
    TooManyRequests(u64),
    #[error("conflict (another getUpdates instance)")]
    Conflict,
    #[error("server error: {0}")]
    Server(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("bot api error: {0}")]
    Api(String),
}
