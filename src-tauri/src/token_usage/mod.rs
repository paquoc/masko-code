use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::Serialize;

#[derive(Debug, Default, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RawUsage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_creation: u64,
}

impl RawUsage {
    fn add(&mut self, other: &RawUsage) {
        self.input = self.input.saturating_add(other.input);
        self.output = self.output.saturating_add(other.output);
        self.cache_read = self.cache_read.saturating_add(other.cache_read);
        self.cache_creation = self.cache_creation.saturating_add(other.cache_creation);
    }
}

#[derive(Debug)]
struct SessionParseState {
    path: PathBuf,
    offset: u64,
    mtime: Option<SystemTime>,
    totals: RawUsage,
}

#[derive(Default)]
pub struct TokenUsageState {
    sessions: Mutex<HashMap<String, SessionParseState>>,
}

impl TokenUsageState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Incrementally parse the transcript for `session_id` at `path`.
    /// Returns the current cumulative raw usage.
    pub fn read_session_usage(
        &self,
        session_id: &str,
        path: &Path,
    ) -> RawUsage {
        let _ = (session_id, path);
        RawUsage::default()
    }

    pub fn reset_session(&self, session_id: &str) {
        let _ = session_id;
    }
}

/// Parse a single JSONL line. If it has `message.usage`, add its fields into `totals`.
/// Unknown or missing fields default to 0. Malformed JSON is silently skipped.
fn parse_usage_into(line: &str, totals: &mut RawUsage) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    let value: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return,
    };
    let Some(usage) = value.get("message").and_then(|m| m.get("usage")) else {
        return;
    };

    let pick = |key: &str| -> u64 {
        usage.get(key).and_then(|v| v.as_u64()).unwrap_or(0)
    };

    let delta = RawUsage {
        input: pick("input_tokens"),
        output: pick("output_tokens"),
        cache_read: pick("cache_read_input_tokens"),
        cache_creation: pick("cache_creation_input_tokens"),
    };
    totals.add(&delta);
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_ASSISTANT_LINE: &str = r#"{"type":"assistant","message":{"usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":30,"cache_read_input_tokens":200}}}"#;

    #[test]
    fn parse_usage_into_well_formed_line_adds_all_fields() {
        let mut totals = RawUsage::default();
        parse_usage_into(SAMPLE_ASSISTANT_LINE, &mut totals);
        assert_eq!(
            totals,
            RawUsage {
                input: 100,
                output: 50,
                cache_read: 200,
                cache_creation: 30,
            }
        );
    }

    #[test]
    fn parse_usage_into_no_usage_field_is_noop() {
        let mut totals = RawUsage { input: 5, ..Default::default() };
        parse_usage_into(r#"{"type":"user","message":{"content":"hi"}}"#, &mut totals);
        assert_eq!(totals.input, 5);
        assert_eq!(totals.output, 0);
    }

    #[test]
    fn parse_usage_into_malformed_json_is_noop() {
        let mut totals = RawUsage::default();
        parse_usage_into("{not json", &mut totals);
        assert_eq!(totals, RawUsage::default());
    }

    #[test]
    fn parse_usage_into_missing_fields_default_to_zero() {
        let mut totals = RawUsage::default();
        parse_usage_into(
            r#"{"message":{"usage":{"input_tokens":7}}}"#,
            &mut totals,
        );
        assert_eq!(
            totals,
            RawUsage { input: 7, output: 0, cache_read: 0, cache_creation: 0 }
        );
    }

    #[test]
    fn parse_usage_into_accumulates_across_calls() {
        let mut totals = RawUsage::default();
        parse_usage_into(SAMPLE_ASSISTANT_LINE, &mut totals);
        parse_usage_into(SAMPLE_ASSISTANT_LINE, &mut totals);
        assert_eq!(totals.input, 200);
        assert_eq!(totals.output, 100);
        assert_eq!(totals.cache_read, 400);
        assert_eq!(totals.cache_creation, 60);
    }
}
