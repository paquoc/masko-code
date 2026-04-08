// src-tauri/src/telegram/client.rs

use reqwest::StatusCode;
use serde::Serialize;
use serde_json::{json, Value};

use crate::telegram::types::{
    BotUser, InlineKeyboardMarkup, SentMessage, TelegramError, Update,
};

#[derive(Clone)]
pub struct TelegramClient {
    http: reqwest::Client,
    token: String,
}

impl TelegramClient {
    pub fn new(token: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("reqwest client");
        Self { http, token }
    }

    fn url(&self, method: &str) -> String {
        format!("https://api.telegram.org/bot{}/{}", self.token, method)
    }

    /// GET /getMe
    pub async fn get_me(&self) -> Result<BotUser, TelegramError> {
        let resp = self
            .http
            .get(self.url("getMe"))
            .send()
            .await
            .map_err(|e| TelegramError::Network(e.to_string()))?;
        classify_and_parse::<BotUser>(resp).await
    }

    /// Long-poll getUpdates. `offset` is the update_id to start from (+1 past
    /// last seen). `timeout` is the long-poll timeout in seconds. The HTTP
    /// timeout is set generously above so the server can hold this open.
    pub async fn get_updates(
        &self,
        offset: i64,
        timeout_secs: u64,
    ) -> Result<Vec<Update>, TelegramError> {
        let body = json!({
            "offset": offset,
            "timeout": timeout_secs,
            "allowed_updates": ["message", "callback_query"],
        });
        let resp = self
            .http
            .post(self.url("getUpdates"))
            .json(&body)
            .send()
            .await
            .map_err(|e| TelegramError::Network(e.to_string()))?;
        classify_and_parse::<Vec<Update>>(resp).await
    }

    /// POST /sendMessage with HTML parse_mode and optional inline keyboard.
    pub async fn send_message(
        &self,
        chat_id: &str,
        html: &str,
        reply_markup: Option<&InlineKeyboardMarkup>,
    ) -> Result<SentMessage, TelegramError> {
        #[derive(Serialize)]
        struct Body<'a> {
            chat_id: &'a str,
            text: &'a str,
            parse_mode: &'static str,
            #[serde(skip_serializing_if = "Option::is_none")]
            reply_markup: Option<&'a InlineKeyboardMarkup>,
        }
        let body = Body {
            chat_id,
            text: html,
            parse_mode: "HTML",
            reply_markup,
        };
        let resp = self
            .http
            .post(self.url("sendMessage"))
            .json(&body)
            .send()
            .await
            .map_err(|e| TelegramError::Network(e.to_string()))?;
        classify_and_parse::<SentMessage>(resp).await
    }

    /// POST /editMessageReplyMarkup to clear or replace the inline keyboard.
    /// Passing `None` clears the keyboard entirely.
    pub async fn edit_message_reply_markup(
        &self,
        chat_id: &str,
        message_id: i64,
        markup: Option<&InlineKeyboardMarkup>,
    ) -> Result<(), TelegramError> {
        // NOTE: to clear an inline keyboard we must send an explicit
        // `reply_markup: { inline_keyboard: [] }` — omitting the field is a
        // no-op on the Telegram Bot API.
        let body = match markup {
            Some(m) => json!({ "chat_id": chat_id, "message_id": message_id, "reply_markup": m }),
            None => json!({
                "chat_id": chat_id,
                "message_id": message_id,
                "reply_markup": { "inline_keyboard": [] }
            }),
        };
        let resp = self
            .http
            .post(self.url("editMessageReplyMarkup"))
            .json(&body)
            .send()
            .await
            .map_err(|e| TelegramError::Network(e.to_string()))?;
        let _ = classify_and_parse::<Value>(resp).await?;
        Ok(())
    }

    /// POST /answerCallbackQuery for inline button toast.
    pub async fn answer_callback_query(
        &self,
        callback_query_id: &str,
        text: &str,
    ) -> Result<(), TelegramError> {
        let body = json!({
            "callback_query_id": callback_query_id,
            "text": text,
            "show_alert": false,
        });
        let resp = self
            .http
            .post(self.url("answerCallbackQuery"))
            .json(&body)
            .send()
            .await
            .map_err(|e| TelegramError::Network(e.to_string()))?;
        let _ = classify_and_parse::<Value>(resp).await?;
        Ok(())
    }
}

/// Classify HTTP status + Telegram response envelope into either the inner
/// `result` field or a typed error.
async fn classify_and_parse<T: for<'de> serde::Deserialize<'de>>(
    resp: reqwest::Response,
) -> Result<T, TelegramError> {
    let status = resp.status();
    let retry_after = resp
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());

    let body = resp
        .text()
        .await
        .map_err(|e| TelegramError::Network(e.to_string()))?;

    let envelope: Value = serde_json::from_str(&body)
        .map_err(|e| TelegramError::Api(format!("parse envelope: {e}: {body}")))?;

    let ok = envelope.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);

    if status == StatusCode::UNAUTHORIZED {
        return Err(TelegramError::Unauthorized);
    }
    if status == StatusCode::CONFLICT {
        return Err(TelegramError::Conflict);
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        let envelope_retry = envelope
            .get("parameters")
            .and_then(|p| p.get("retry_after"))
            .and_then(|v| v.as_u64());
        let wait = envelope_retry.or(retry_after).unwrap_or(5);
        return Err(TelegramError::TooManyRequests(wait));
    }
    if status.is_server_error() {
        return Err(TelegramError::Server(format!("{status}: {body}")));
    }

    if !ok {
        let desc = envelope
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown api error");
        return Err(TelegramError::Api(desc.to_string()));
    }

    let result = envelope
        .get("result")
        .cloned()
        .ok_or_else(|| TelegramError::Api("missing result".into()))?;

    serde_json::from_value::<T>(result)
        .map_err(|e| TelegramError::Api(format!("deserialize result: {e}")))
}
