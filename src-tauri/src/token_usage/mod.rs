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
    let _ = (line, totals);
}
