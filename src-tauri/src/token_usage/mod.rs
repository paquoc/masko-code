use std::collections::{HashMap, HashSet};
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
    /// Only count lines whose `timestamp` field is >= this value (ISO 8601 string, lexicographic compare)
    since: Option<String>,
    /// Dedup set: keys are "{message.id}:{requestId}" — both must be present to form a key
    seen: HashSet<String>,
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
        since_rfc3339: Option<&str>,
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
                since: since_rfc3339.map(String::from),
                seen: HashSet::new(),
            });

        // Reset on path change or truncation/rotation
        if entry.path != path || file_len < entry.offset {
            entry.path = path.to_path_buf();
            entry.offset = 0;
            entry.totals = RawUsage::default();
            entry.seen.clear();
        }
        // Update since filter if caller provides one and entry doesn't have one yet
        if entry.since.is_none() {
            if let Some(s) = since_rfc3339 {
                entry.since = Some(s.to_string());
            }
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
            parse_usage_into(&buf, &mut entry.totals, entry.since.as_deref(), &mut entry.seen);
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
/// - `since`: skip lines whose top-level `timestamp` < `since` (ISO 8601, lexicographic compare).
/// - `seen`: dedup set keyed by `{message.id}:{requestId}`; if either field is absent the line is counted without dedup.
fn parse_usage_into(line: &str, totals: &mut RawUsage, since: Option<&str>, seen: &mut HashSet<String>) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    let value: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return,
    };
    // Timestamp filter: skip lines older than mascot open time
    if let Some(since_ts) = since {
        match value.get("timestamp").and_then(|v| v.as_str()) {
            Some(ts) if ts >= since_ts => {} // within range, proceed
            _ => return,                     // missing or too old — skip
        }
    }
    let Some(message) = value.get("message") else { return };
    let Some(usage) = message.get("usage") else { return };

    // Dedup: key = "{message.id}:{requestId}" — if either is missing, count without dedup
    let message_id = message.get("id").and_then(|v| v.as_str());
    let request_id = value.get("requestId").and_then(|v| v.as_str());
    if let (Some(mid), Some(rid)) = (message_id, request_id) {
        let key = format!("{mid}:{rid}");
        if !seen.insert(key) {
            return; // already counted this message
        }
    }

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

    // Two sample lines with distinct requestId + message.id — same usage values
    const SAMPLE_LINE_A: &str = r#"{"requestId":"req-aaaa","message":{"id":"msg-aaaa","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":30,"cache_read_input_tokens":200}}}"#;
    const SAMPLE_LINE_B: &str = r#"{"requestId":"req-bbbb","message":{"id":"msg-bbbb","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":30,"cache_read_input_tokens":200}}}"#;

    #[test]
    fn parse_usage_into_well_formed_line_adds_all_fields() {
        let mut totals = RawUsage::default();
        parse_usage_into(SAMPLE_LINE_A, &mut totals, None, &mut HashSet::new());
        assert_eq!(
            totals,
            RawUsage { input: 100, output: 50, cache_read: 200, cache_creation: 30 }
        );
    }

    #[test]
    fn parse_usage_into_no_usage_field_is_noop() {
        let mut totals = RawUsage { input: 5, ..Default::default() };
        parse_usage_into(r#"{"type":"user","message":{"content":"hi"}}"#, &mut totals, None, &mut HashSet::new());
        assert_eq!(totals.input, 5);
        assert_eq!(totals.output, 0);
    }

    #[test]
    fn parse_usage_into_malformed_json_is_noop() {
        let mut totals = RawUsage::default();
        parse_usage_into("{not json", &mut totals, None, &mut HashSet::new());
        assert_eq!(totals, RawUsage::default());
    }

    #[test]
    fn parse_usage_into_null_hash_counts_without_dedup() {
        let mut seen = HashSet::new();
        let mut totals = RawUsage::default();
        // Both missing → count (no dedup key)
        parse_usage_into(r#"{"message":{"usage":{"input_tokens":7}}}"#, &mut totals, None, &mut seen);
        assert_eq!(totals.input, 7, "missing both ids should still count");
        // Only requestId missing → count
        parse_usage_into(r#"{"message":{"id":"msg-x","usage":{"input_tokens":3}}}"#, &mut totals, None, &mut seen);
        assert_eq!(totals.input, 10, "missing requestId should still count");
        // Only message.id missing → count
        parse_usage_into(r#"{"requestId":"req-x","message":{"usage":{"input_tokens":2}}}"#, &mut totals, None, &mut seen);
        assert_eq!(totals.input, 12, "missing message.id should still count");
    }

    #[test]
    fn parse_usage_into_accumulates_across_different_messages() {
        let mut totals = RawUsage::default();
        let mut seen = HashSet::new();
        parse_usage_into(SAMPLE_LINE_A, &mut totals, None, &mut seen);
        parse_usage_into(SAMPLE_LINE_B, &mut totals, None, &mut seen);
        assert_eq!(totals.input, 200);
        assert_eq!(totals.output, 100);
        assert_eq!(totals.cache_read, 400);
        assert_eq!(totals.cache_creation, 60);
    }

    #[test]
    fn parse_usage_into_dedup_skips_duplicate_message() {
        let mut totals = RawUsage::default();
        let mut seen = HashSet::new();
        parse_usage_into(SAMPLE_LINE_A, &mut totals, None, &mut seen);
        parse_usage_into(SAMPLE_LINE_A, &mut totals, None, &mut seen); // same key — skip
        assert_eq!(totals.input, 100, "duplicate message should not be double-counted");
    }

    #[test]
    fn parse_usage_into_since_filter_skips_old_lines() {
        const LINE_WITH_OLD_TS: &str = r#"{"requestId":"req-old","message":{"id":"msg-old","usage":{"input_tokens":99,"output_tokens":99,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"timestamp":"2026-01-01T00:00:00.000Z"}"#;
        const LINE_WITH_NEW_TS: &str = r#"{"requestId":"req-new","message":{"id":"msg-new","usage":{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"timestamp":"2026-06-01T00:00:00.000Z"}"#;
        let since = "2026-04-01T00:00:00.000Z";
        let mut totals = RawUsage::default();
        let mut seen = HashSet::new();
        parse_usage_into(LINE_WITH_OLD_TS, &mut totals, Some(since), &mut seen);
        assert_eq!(totals.input, 0, "old line should be skipped");
        parse_usage_into(LINE_WITH_NEW_TS, &mut totals, Some(since), &mut seen);
        assert_eq!(totals.input, 10, "new line should be counted");
    }

    #[test]
    fn parse_usage_into_since_filter_skips_lines_without_timestamp() {
        let since = "2026-04-01T00:00:00.000Z";
        let mut totals = RawUsage::default();
        // SAMPLE_LINE_A has no timestamp — should be skipped when since filter is set
        parse_usage_into(SAMPLE_LINE_A, &mut totals, Some(since), &mut HashSet::new());
        assert_eq!(totals.input, 0, "line without timestamp should be skipped when since filter active");
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
                SAMPLE_LINE_A,
                SAMPLE_LINE_B, // different uuid+message.id → both counted
            ],
        );

        let state = TokenUsageState::new();
        let totals = state.read_session_usage("sid", &path, None);

        assert_eq!(totals.input, 200);
        assert_eq!(totals.output, 100);
        assert_eq!(totals.cache_read, 400);
        assert_eq!(totals.cache_creation, 60);
    }

    #[test]
    fn read_session_usage_incremental_second_call_only_reads_new_lines() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        write_jsonl(&path, &[SAMPLE_LINE_A]);

        let state = TokenUsageState::new();
        let first = state.read_session_usage("sid", &path, None);
        assert_eq!(first.input, 100);

        write_jsonl(&path, &[SAMPLE_LINE_B]); // different key — counts
        let second = state.read_session_usage("sid", &path, None);

        assert_eq!(second.input, 200);
        assert_eq!(second.output, 100);
    }

    #[test]
    fn read_session_usage_missing_file_returns_zero() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("not-there.jsonl");
        let state = TokenUsageState::new();
        let totals = state.read_session_usage("sid", &path, None);
        assert_eq!(totals, RawUsage::default());
    }

    #[test]
    fn read_session_usage_truncation_resets_and_reparses() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        write_jsonl(&path, &[SAMPLE_LINE_A, SAMPLE_LINE_B]);

        let state = TokenUsageState::new();
        let _ = state.read_session_usage("sid", &path, None);

        // Truncate the file; seen set is cleared on reset — SAMPLE_LINE_A counts again
        std::fs::write(&path, "").unwrap();
        write_jsonl(&path, &[SAMPLE_LINE_A]);

        let after = state.read_session_usage("sid", &path, None);
        assert_eq!(after.input, 100);
        assert_eq!(after.output, 50);
    }

    #[test]
    fn read_session_usage_partial_last_line_is_not_counted() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("session.jsonl");

        // Write SAMPLE_LINE_A complete, then SAMPLE_LINE_B partial (no trailing newline)
        {
            let mut f = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .unwrap();
            writeln!(f, "{}", SAMPLE_LINE_A).unwrap();
            write!(f, "{}", SAMPLE_LINE_B).unwrap(); // partial — no \n
        }

        let state = TokenUsageState::new();
        let first = state.read_session_usage("sid", &path, None);
        assert_eq!(first.input, 100, "partial line should not be counted");

        // Now finish the partial line
        {
            let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
            writeln!(f).unwrap();
        }
        let second = state.read_session_usage("sid", &path, None);
        assert_eq!(second.input, 200);
    }

    #[test]
    fn reset_session_removes_entry() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        write_jsonl(&path, &[SAMPLE_LINE_A]);
        let state = TokenUsageState::new();
        let _ = state.read_session_usage("sid", &path, None);
        state.reset_session("sid");
        // After reset, seen is cleared and offset resets — SAMPLE_LINE_A is counted again
        let again = state.read_session_usage("sid", &path, None);
        assert_eq!(again.input, 100);
    }
}
