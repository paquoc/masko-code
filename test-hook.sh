#!/bin/bash
# Test Claude Hook Script
# Logs tool usage info to a file for verification

LOG_FILE="d:/projects/others/test-claude-hook/hook-log.txt"

# Read stdin (hook input JSON)
INPUT=$(cat)

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Extract tool_name using grep/sed (no jq needed)
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | sed 's/"tool_name":"//;s/"//')
TOOL_NAME=${TOOL_NAME:-unknown}

# Detect event type
HOOK_EVENT=$(echo "$INPUT" | grep -o '"hook_event_name":"[^"]*"' | sed 's/"hook_event_name":"//;s/"//')
HOOK_EVENT=${HOOK_EVENT:-unknown}

if [ "$HOOK_EVENT" = "Stop" ]; then
  # Fetch rate limits from OAuth Usage API
  CRED_FILE="$HOME/.claude/.credentials.json"
  RATE_LIMITS=""
  if [ -f "$CRED_FILE" ]; then
    TOKEN=$(grep -o '"accessToken":"[^"]*"' "$CRED_FILE" | sed 's/"accessToken":"//;s/"//')
    if [ -n "$TOKEN" ]; then
      RATE_LIMITS=$(curl -s "https://api.anthropic.com/api/oauth/usage" \
        -H "Authorization: Bearer $TOKEN" \
        -H "anthropic-beta: oauth-2025-04-20" 2>/dev/null)
    fi
  fi

  # Parse rate limits
  FIVE_H=$(echo "$RATE_LIMITS" | grep -o '"five_hour":{[^}]*}' | grep -o '"utilization":[0-9.]*' | sed 's/"utilization"://')
  FIVE_H_RESET=$(echo "$RATE_LIMITS" | grep -o '"five_hour":{[^}]*}' | grep -o '"resets_at":"[^"]*"' | sed 's/"resets_at":"//;s/"//')
  SEVEN_D=$(echo "$RATE_LIMITS" | grep -o '"seven_day":{[^}]*}' | head -1 | grep -o '"utilization":[0-9.]*' | sed 's/"utilization"://')
  SEVEN_D_RESET=$(echo "$RATE_LIMITS" | grep -o '"seven_day":{[^}]*}' | head -1 | grep -o '"resets_at":"[^"]*"' | sed 's/"resets_at":"//;s/"//')

  LAST_MSG=$(echo "$INPUT" | grep -o '"last_assistant_message":"[^"]*"' | sed 's/"last_assistant_message":"//;s/"//')

  echo "[$TIMESTAMP] STOP event!" >> "$LOG_FILE"
  echo "  Message: $LAST_MSG" >> "$LOG_FILE"
  echo "  Rate Limits:" >> "$LOG_FILE"
  echo "    5-hour session: ${FIVE_H:-N/A}% (resets: ${FIVE_H_RESET:-N/A})" >> "$LOG_FILE"
  echo "    7-day weekly:   ${SEVEN_D:-N/A}% (resets: ${SEVEN_D_RESET:-N/A})" >> "$LOG_FILE"
  echo "  Raw rate_limits: $RATE_LIMITS" >> "$LOG_FILE"
  echo "---" >> "$LOG_FILE"
else
  echo "[$TIMESTAMP] Hook fired! Event: $HOOK_EVENT, Tool: $TOOL_NAME" >> "$LOG_FILE"
  echo "  Raw input: $INPUT" >> "$LOG_FILE"
  echo "---" >> "$LOG_FILE"
fi

# Output JSON so Claude sees feedback
echo "{\"hookSpecificOutput\":{\"hookEventName\":\"$HOOK_EVENT\",\"additionalContext\":\"Hook test: tool usage logged to hook-log.txt\"}}"
