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

    pub fn read_session_usage(
        &self,
        session_id: &str,
        path: &Path,
    ) -> RawUsage {
        let meta = match std::fs::metadata(path) {
            Ok(m) => m,
            Err(_) => return RawUsage::default(), // file not created yet
        };
        let file_len = meta.len();
        let mtime = meta.modified().ok();

        let mut sessions = self.sessions.lock().expect("token_usage mutex poisoned");
        let entry = sessions
            .entry(session_id.to_string())
            .or_insert_with(|| SessionParseState {
                path: path.to_path_buf(),
                offset: 0,
                mtime: None,
                totals: RawUsage::default(),
            });

        // Reset on path change or truncation/rotation
        if entry.path != path || file_len < entry.offset {
            entry.path = path.to_path_buf();
            entry.offset = 0;
            entry.totals = RawUsage::default();
        }
        entry.mtime = mtime;

        // Nothing new to read
        if file_len == entry.offset {
            return entry.totals;
        }

        let file = match File::open(path) {
            Ok(f) => f,
            Err(_) => return entry.totals,
        };
        let mut reader = BufReader::new(file);
        if reader.seek(SeekFrom::Start(entry.offset)).is_err() {
            return entry.totals;
        }

        let mut buf = String::new();
        loop {
            buf.clear();
            let n = match reader.read_line(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            if !buf.ends_with('\n') {
                // Partial last line — do not advance past it.
                break;
            }
            entry.offset = entry.offset.saturating_add(n as u64);
            parse_usage_into(&buf, &mut entry.totals);
        }

        entry.totals
    }

    pub fn reset_session(&self, session_id: &str) {
        let mut sessions = self.sessions.lock().expect("token_usage mutex poisoned");
        sessions.remove(session_id);
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

    use std::io::Write;
    use tempfile::tempdir;

    fn write_jsonl(path: &Path, lines: &[&str]) {
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        for line in lines {
            writeln!(f, "{}", line).unwrap();
        }
        f.flush().unwrap();
    }

    #[test]
    fn read_session_usage_parses_full_file_on_first_call() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        write_jsonl(
            &path,
            &[
                r#"{"type":"user","message":{}}"#,
                SAMPLE_ASSISTANT_LINE,
                SAMPLE_ASSISTANT_LINE,
            ],
        );

        let state = TokenUsageState::new();
        let totals = state.read_session_usage("sid", &path);

        assert_eq!(totals.input, 200);
        assert_eq!(totals.output, 100);
        assert_eq!(totals.cache_read, 400);
        assert_eq!(totals.cache_creation, 60);
    }

    #[test]
    fn read_session_usage_incremental_second_call_only_reads_new_lines() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        write_jsonl(&path, &[SAMPLE_ASSISTANT_LINE]);

        let state = TokenUsageState::new();
        let first = state.read_session_usage("sid", &path);
        assert_eq!(first.input, 100);

        write_jsonl(&path, &[SAMPLE_ASSISTANT_LINE]);
        let second = state.read_session_usage("sid", &path);

        assert_eq!(second.input, 200);
        assert_eq!(second.output, 100);
    }

    #[test]
    fn read_session_usage_missing_file_returns_zero() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("not-there.jsonl");
        let state = TokenUsageState::new();
        let totals = state.read_session_usage("sid", &path);
        assert_eq!(totals, RawUsage::default());
    }

    #[test]
    fn read_session_usage_truncation_resets_and_reparses() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        write_jsonl(&path, &[SAMPLE_ASSISTANT_LINE, SAMPLE_ASSISTANT_LINE]);

        let state = TokenUsageState::new();
        let _ = state.read_session_usage("sid", &path);

        // Truncate the file to a smaller size by rewriting
        std::fs::write(&path, "").unwrap();
        write_jsonl(&path, &[SAMPLE_ASSISTANT_LINE]);

        let after = state.read_session_usage("sid", &path);
        assert_eq!(after.input, 100);
        assert_eq!(after.output, 50);
    }

    #[test]
    fn read_session_usage_partial_last_line_is_not_counted() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("session.jsonl");

        // Write a complete line, then a partial (no trailing newline)
        {
            let mut f = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .unwrap();
            writeln!(f, "{}", SAMPLE_ASSISTANT_LINE).unwrap();
            write!(f, "{}", SAMPLE_ASSISTANT_LINE).unwrap(); // partial — no \n
        }

        let state = TokenUsageState::new();
        let first = state.read_session_usage("sid", &path);
        assert_eq!(first.input, 100, "partial line should not be counted");

        // Now finish the partial line
        {
            let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
            writeln!(f).unwrap();
        }
        let second = state.read_session_usage("sid", &path);
        assert_eq!(second.input, 200);
    }

    #[test]
    fn reset_session_removes_entry() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        write_jsonl(&path, &[SAMPLE_ASSISTANT_LINE]);
        let state = TokenUsageState::new();
        let _ = state.read_session_usage("sid", &path);
        state.reset_session("sid");
        // After reset, a new read re-parses from offset 0
        let again = state.read_session_usage("sid", &path);
        assert_eq!(again.input, 100);
    }
}
