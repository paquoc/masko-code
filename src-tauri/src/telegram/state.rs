// src-tauri/src/telegram/state.rs

use std::collections::VecDeque;

use serde_json::Value;

use crate::models::AgentEvent;

/// A single option on an AskUserQuestion question.
#[derive(Debug, Clone)]
pub struct ParsedOption {
    pub label: String,
    #[allow(dead_code)]
    pub description: Option<String>,
}

/// A parsed question from AskUserQuestion.tool_input.questions.
#[derive(Debug, Clone)]
pub struct ParsedQuestion {
    pub question: String,
    pub options: Vec<ParsedOption>,
    #[allow(dead_code)]
    pub multi_select: bool,
}

/// State tracked for an active AskUserQuestion permission.
#[derive(Debug, Clone)]
pub struct QuestionState {
    pub questions: Vec<ParsedQuestion>,
    /// Index of the question currently being shown to the user.
    pub current_index: usize,
    /// Answers collected so far, one per question already answered.
    pub collected: Vec<String>,
    /// Original event.cwd, cached so follow-up question messages can keep
    /// the same project folder header.
    pub cwd: Option<String>,
}

/// Permission that is currently shown in Telegram and awaiting a response.
#[derive(Debug, Clone)]
pub struct ActivePermission {
    pub request_id: String,
    /// Telegram message_id of the posted permission message. Used to clear
    /// the inline keyboard when the permission is resolved.
    pub message_id: i64,
    /// The raw suggestion that was used as the middle button (if any).
    /// Preserved here so the callback handler can emit it back to the frontend.
    pub suggestion: Option<Value>,
    /// Set when the active permission is an AskUserQuestion. Holds the
    /// parsed questions, current index, and collected answers.
    pub question: Option<QuestionState>,
}

#[derive(Debug, Clone)]
pub struct Queued {
    pub event: AgentEvent,
    pub request_id: String,
}

#[derive(Debug, Default)]
pub struct QueueState {
    pub active: Option<ActivePermission>,
    pub queue: VecDeque<Queued>,
}

/// Result of pushing a new permission into the queue.
#[derive(Debug, PartialEq, Eq)]
pub enum PushOutcome {
    /// Queue was idle — caller should `send_now`.
    ShouldSendNow,
    /// Another permission is active — this one is queued.
    Queued,
}

/// Result of removing a request_id that was resolved locally.
#[derive(Debug)]
pub enum RemoveOutcome {
    /// Nothing found with this request_id.
    NotFound,
    /// Removed from the pending queue (no Telegram message was ever sent).
    RemovedFromQueue,
    /// The active permission was removed. The caller should edit the Telegram
    /// message to clear the keyboard and then `send_next` if the returned
    /// `ActivePermission` has meaningful data. `next` is the next queued
    /// entry to send, if any.
    WasActive {
        previous: ActivePermission,
        next: Option<Queued>,
    },
}

impl QueueState {
    pub fn push(&mut self, event: AgentEvent, request_id: String) -> PushOutcome {
        if self.active.is_none() && self.queue.is_empty() {
            // The caller will set `active` once send_now returns a message_id.
            PushOutcome::ShouldSendNow
        } else if self.active.is_none() {
            // Shouldn't normally happen, but be defensive: treat as queued.
            self.queue.push_back(Queued { event, request_id });
            PushOutcome::Queued
        } else {
            self.queue.push_back(Queued { event, request_id });
            PushOutcome::Queued
        }
    }

    /// Called after a successful send_now — register the new active permission.
    pub fn set_active(&mut self, active: ActivePermission) {
        self.active = Some(active);
    }

    /// Clear the active permission and pop the next queued one, if any.
    /// Returns the popped entry.
    pub fn resolve_active(&mut self) -> Option<Queued> {
        self.active = None;
        self.queue.pop_front()
    }

    /// Remove a permission by request_id (used when the permission is
    /// resolved from the local UI while still pending in Telegram).
    pub fn remove_by_request_id(&mut self, request_id: &str) -> RemoveOutcome {
        if let Some(active) = &self.active {
            if active.request_id == request_id {
                let previous = self.active.take().unwrap();
                let next = self.queue.pop_front();
                return RemoveOutcome::WasActive { previous, next };
            }
        }
        let before = self.queue.len();
        self.queue.retain(|q| q.request_id != request_id);
        if self.queue.len() != before {
            RemoveOutcome::RemovedFromQueue
        } else {
            RemoveOutcome::NotFound
        }
    }

    /// Clear all state (used when config changes or polling is disabled).
    pub fn clear(&mut self) {
        self.active = None;
        self.queue.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_event() -> AgentEvent {
        AgentEvent {
            hook_event_name: "PermissionRequest".into(),
            session_id: None, cwd: None, permission_mode: None,
            transcript_path: None, tool_name: Some("Bash".into()),
            tool_input: None, tool_response: None, tool_use_id: None,
            message: None, title: None, notification_type: None,
            source: None, reason: None, model: None, stop_hook_active: None,
            last_assistant_message: None, agent_id: None, agent_type: None,
            task_id: None, task_subject: None, permission_suggestions: None,
        }
    }

    fn active(id: &str) -> ActivePermission {
        ActivePermission {
            request_id: id.into(),
            message_id: 1,
            suggestion: None,
            question: None,
        }
    }

    #[test]
    fn push_while_idle_says_send_now() {
        let mut s = QueueState::default();
        assert_eq!(s.push(dummy_event(), "a".into()), PushOutcome::ShouldSendNow);
        assert!(s.active.is_none()); // caller has not called set_active yet
        assert!(s.queue.is_empty());
    }

    #[test]
    fn push_while_busy_queues() {
        let mut s = QueueState::default();
        s.set_active(active("a"));
        assert_eq!(s.push(dummy_event(), "b".into()), PushOutcome::Queued);
        assert_eq!(s.queue.len(), 1);
    }

    #[test]
    fn resolve_active_pops_next() {
        let mut s = QueueState::default();
        s.set_active(active("a"));
        s.push(dummy_event(), "b".into());
        s.push(dummy_event(), "c".into());
        let popped = s.resolve_active().expect("should pop b");
        assert_eq!(popped.request_id, "b");
        assert!(s.active.is_none());
        assert_eq!(s.queue.len(), 1);
    }

    #[test]
    fn resolve_active_when_queue_empty_returns_none() {
        let mut s = QueueState::default();
        s.set_active(active("a"));
        assert!(s.resolve_active().is_none());
    }

    #[test]
    fn remove_active_by_id() {
        let mut s = QueueState::default();
        s.set_active(active("a"));
        s.push(dummy_event(), "b".into());
        match s.remove_by_request_id("a") {
            RemoveOutcome::WasActive { previous, next } => {
                assert_eq!(previous.request_id, "a");
                assert_eq!(next.unwrap().request_id, "b");
            }
            other => panic!("unexpected: {other:?}"),
        }
        assert!(s.active.is_none());
        assert!(s.queue.is_empty());
    }

    #[test]
    fn remove_queued_by_id() {
        let mut s = QueueState::default();
        s.set_active(active("a"));
        s.push(dummy_event(), "b".into());
        s.push(dummy_event(), "c".into());
        assert!(matches!(
            s.remove_by_request_id("b"),
            RemoveOutcome::RemovedFromQueue
        ));
        assert_eq!(s.queue.len(), 1);
        assert_eq!(s.queue[0].request_id, "c");
    }

    #[test]
    fn remove_unknown_id_is_notfound() {
        let mut s = QueueState::default();
        assert!(matches!(s.remove_by_request_id("zzz"), RemoveOutcome::NotFound));
    }

    #[test]
    fn clear_wipes_everything() {
        let mut s = QueueState::default();
        s.set_active(active("a"));
        s.push(dummy_event(), "b".into());
        s.clear();
        assert!(s.active.is_none());
        assert!(s.queue.is_empty());
    }
}
