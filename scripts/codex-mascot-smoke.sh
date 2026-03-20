#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---manual}"
case "$MODE" in
  --manual|--auto) ;;
  *)
    echo "Usage: $0 [--manual|--auto]"
    exit 1
    ;;
esac

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required for this smoke test"
    exit 1
  fi
}

need_cmd codex
need_cmd jq
need_cmd rg
need_cmd expect

CODEX_SESSIONS_DIR="${CODEX_HOME:-$HOME/.codex}/sessions"
EVENTS_FILE="$HOME/Library/Application Support/masko-desktop/events.json"
TMP_DIR="${TMPDIR:-/tmp}/codex-mascot-smoke"
mkdir -p "$TMP_DIR"

QUESTION_MARKER="[SMOKE_QUESTION]"
APPROVAL_MARKER="SMOKE_APPROVAL: approve persistent ls-remote check?"
DONE_MARKER="[SMOKE_DONE]"
ANSWER_TEXT="${MASKO_SMOKE_ANSWER:-fork}"
EXPECT_LOG="$TMP_DIR/interactive.log"
PID_FILE="$TMP_DIR/interactive.pid"

PROMPT=$(
  cat <<EOF
We are running a Masko integration smoke test.

Follow this exact flow:
1. Ask exactly this as a commentary message, then stop and wait for my answer:
   $QUESTION_MARKER Which remote should I use for the ls-remote check? [question-issued]
2. After I answer, run \`git status --short --branch\`.
3. Then request approval before running \`git ls-remote --heads origin\`.
4. Use the exact justification text "$APPROVAL_MARKER".
5. Set \`prefix_rule\` to ["git","ls-remote"].
6. If approval is granted, run the command.
7. Finish with exactly "$DONE_MARKER".
EOF
)

latest_session_file_since() {
  local min_epoch="$1"
  find "$CODEX_SESSIONS_DIR" -type f -name "*.jsonl" -print0 2>/dev/null \
    | xargs -0 stat -f '%m %N' 2>/dev/null \
    | awk -v min_epoch="$min_epoch" '$1 >= min_epoch { $1=""; sub(/^ /, ""); print }' \
    | tail -n 1
}

extract_session_id() {
  local session_file="$1"
  rg -m1 '"type":"session_meta"' "$session_file" \
    | sed -E 's/.*"id":"([^"]+)".*/\1/'
}

wait_for_pid_file() {
  local timeout="${1:-30}"
  local waited=0
  while [[ ! -s "$PID_FILE" ]]; do
    if (( waited >= timeout )); then
      echo "Timed out waiting for Codex pid file"
      return 1
    fi
    sleep 1
    ((waited += 1))
  done
}

wait_for_session_file() {
  local start_epoch="$1"
  local timeout="${2:-30}"
  local waited=0
  local session_file=""
  while [[ -z "$session_file" ]]; do
    session_file="$(latest_session_file_since "$start_epoch")"
    if [[ -n "$session_file" ]]; then
      echo "$session_file"
      return 0
    fi
    if (( waited >= timeout )); then
      echo "Timed out waiting for a new Codex session file"
      return 1
    fi
    sleep 1
    ((waited += 1))
  done
}

wait_for_jq_event() {
  local session_id="$1"
  local jq_filter="$2"
  local timeout="${3:-90}"
  local waited=0

  while true; do
    if [[ -f "$EVENTS_FILE" ]] \
      && jq -e --arg sid "$session_id" "$jq_filter" "$EVENTS_FILE" >/dev/null 2>&1; then
      return 0
    fi
    if (( waited >= timeout )); then
      return 1
    fi
    sleep 1
    ((waited += 1))
  done
}

print_event_summary() {
  local session_id="$1"
  jq --arg sid "$session_id" '
    [
      .[]
      | select(.session_id == $sid)
      | {
          hook_event_name,
          tool_name,
          message,
          task_subject,
          reason,
          source
        }
    ] | .[0:20]
  ' "$EVENTS_FILE"
}

start_auto_expect() {
  rm -f "$EXPECT_LOG" "$PID_FILE"
  MASKO_SMOKE_PROMPT="$PROMPT" \
  MASKO_SMOKE_LOG="$EXPECT_LOG" \
  MASKO_SMOKE_PIDFILE="$PID_FILE" \
  MASKO_SMOKE_ANSWER="$ANSWER_TEXT" \
  expect <<'EOF' &
set timeout 240
log_user 0
match_max 200000
log_file -noappend $env(MASKO_SMOKE_LOG)
spawn codex --no-alt-screen $env(MASKO_SMOKE_PROMPT)
set fd [open $env(MASKO_SMOKE_PIDFILE) "w"]
puts $fd [exp_pid]
close $fd
set answered 0
set approved 0
expect {
  -re {\[SMOKE_QUESTION\] Which remote should I use for the ls-remote check\? \[question-issued\]} {
    if {!$answered} {
      send -- "$env(MASKO_SMOKE_ANSWER)\r"
      set answered 1
    }
    exp_continue
  }
  -re {SMOKE_APPROVAL: approve persistent ls-remote check\?} {
    if {!$approved} {
      send -- "p\r"
      set approved 1
    }
    exp_continue
  }
  -re {\[SMOKE_DONE\]} { exit 0 }
  timeout {
    send_user "Timed out waiting for \\[SMOKE_DONE\\]\n"
    exit 1
  }
  eof {
    send_user "Codex exited before \\[SMOKE_DONE\\]\n"
    exit 1
  }
}
EOF
  echo $!
}

cleanup_auto() {
  local expect_pid="${1:-}"
  if [[ -n "$expect_pid" ]] && kill -0 "$expect_pid" >/dev/null 2>&1; then
    kill "$expect_pid" >/dev/null 2>&1 || true
  fi
  if [[ -s "$PID_FILE" ]]; then
    local codex_pid
    codex_pid="$(tr -d '\n' < "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$codex_pid" ]] && kill -0 "$codex_pid" >/dev/null 2>&1; then
      kill "$codex_pid" >/dev/null 2>&1 || true
    fi
  fi
}

if [[ "$MODE" == "--manual" ]]; then
  echo "Starting manual Codex mascot smoke test."
  echo "Make sure Masko is already running, then use the mascot to answer the question and approve the ls-remote request."
  echo ""
  codex --no-alt-screen "$PROMPT"

  if [[ -f "$EVENTS_FILE" ]]; then
    echo ""
    echo "Latest Codex events in Masko:"
    latest_file="$(latest_session_file_since 0 || true)"
    if [[ -n "${latest_file:-}" ]]; then
      latest_sid="$(extract_session_id "$latest_file" || true)"
      if [[ -n "${latest_sid:-}" ]]; then
        print_event_summary "$latest_sid" || true
      fi
    fi
  fi
  exit 0
fi

if [[ ! -f "$EVENTS_FILE" ]]; then
  echo "Masko events file not found at:"
  echo "  $EVENTS_FILE"
  echo "Start the app first with: swift run masko-code"
  exit 1
fi

START_EPOCH="$(date +%s)"
EXPECT_PID="$(start_auto_expect)"
trap 'cleanup_auto "$EXPECT_PID"' EXIT

wait_for_pid_file
CODEX_PID="$(tr -d '\n' < "$PID_FILE")"
if [[ -z "$CODEX_PID" ]]; then
  echo "Failed to read Codex pid from $PID_FILE"
  exit 1
fi

SESSION_FILE="$(wait_for_session_file "$START_EPOCH" 45)"
SESSION_ID="$(extract_session_id "$SESSION_FILE")"
if [[ -z "$SESSION_ID" ]]; then
  echo "Failed to extract session id from $SESSION_FILE"
  exit 1
fi

echo "Auto smoke session: $SESSION_ID"
echo "Codex session file: $SESSION_FILE"
echo "Codex pid: $CODEX_PID"

QUESTION_FILTER='any(.[]; .session_id == $sid and .hook_event_name == "PermissionRequest" and .tool_name == "AskUserQuestion" and ((.message // "") | contains("[SMOKE_QUESTION]")))'
APPROVAL_FILTER='any(.[]; .session_id == $sid and .hook_event_name == "PermissionRequest" and .tool_name == "exec_command" and (.message // "") == "SMOKE_APPROVAL: approve persistent ls-remote check?" and ((.permission_suggestions // []) | length > 0))'
FINAL_FILTER='any(.[]; .session_id == $sid and .hook_event_name == "TaskCompleted" and (.task_subject // "") == "[SMOKE_DONE]")'
QUESTION_TASK_FILTER='any(.[]; .session_id == $sid and .hook_event_name == "TaskCompleted" and ((.task_subject // "") | contains("[SMOKE_QUESTION]")))'
BLANK_NOTIFICATION_FILTER='any(.[]; .session_id == $sid and .hook_event_name == "Notification" and ((.message // "") | gsub("\\s+"; "") == ""))'

if ! wait_for_jq_event "$SESSION_ID" "$QUESTION_FILTER" 90; then
  echo "Timed out waiting for Masko to ingest the Codex question prompt"
  exit 1
fi
echo "Observed Codex question prompt in Masko"

if ! wait_for_jq_event "$SESSION_ID" "$APPROVAL_FILTER" 90; then
  echo "Timed out waiting for Masko to ingest the Codex approval prompt"
  exit 1
fi
echo "Observed Codex approval prompt in Masko"

if ! wait "$EXPECT_PID"; then
  echo "Interactive Codex smoke run did not complete cleanly"
  echo "Expect log: $EXPECT_LOG"
  exit 1
fi
trap - EXIT

if ! wait_for_jq_event "$SESSION_ID" "$FINAL_FILTER" 30; then
  echo "Masko did not record the final task completion marker"
  exit 1
fi

if jq -e --arg sid "$SESSION_ID" "$QUESTION_TASK_FILTER" "$EVENTS_FILE" >/dev/null 2>&1; then
  echo "Unexpected TaskCompleted event for the question-only turn"
  exit 1
fi

if jq -e --arg sid "$SESSION_ID" "$BLANK_NOTIFICATION_FILTER" "$EVENTS_FILE" >/dev/null 2>&1; then
  echo "Unexpected blank notification was recorded for the smoke session"
  exit 1
fi

echo ""
echo "Masko event summary:"
print_event_summary "$SESSION_ID"

echo ""
echo "Auto Codex mascot smoke test passed."
echo "Expect log: $EXPECT_LOG"
