#![allow(dead_code)]

pub mod config;
pub mod types;
pub mod client;
pub mod formatter;
pub mod state;
pub mod poller;

// Public re-exports will be added as the module grows.

// Placeholder until Task 7 — delete then.
pub(crate) mod dispatch {
    use crate::telegram::client::TelegramClient;
    use crate::telegram::state::QueueState;
    use crate::telegram::types::{TelegramConfig, TelegramStatus, Update};
    use std::sync::Arc;
    use tauri::AppHandle;
    use tokio::sync::{Mutex, RwLock};

    pub async fn handle_update(
        _update: Update,
        _client: &TelegramClient,
        _state: &Arc<Mutex<QueueState>>,
        _config: &TelegramConfig,
        _status: &Arc<RwLock<TelegramStatus>>,
        _app: &AppHandle,
    ) {
        // noop
    }
}
