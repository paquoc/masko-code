#!/bin/bash
# Test Claude Hook Script
# Logs all hook events to a file for verification

LOG_FILE="d:/project/other/masko-code/hook-log.txt"

# Read stdin (hook input JSON)
INPUT=$(cat)

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Extract tool_name using grep/sed (no jq needed)
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | sed 's/"tool_name":"//;s/"//')
TOOL_NAME=${TOOL_NAME:-unknown}

# Detect event type
HOOK_EVENT=$(echo "$INPUT" | grep -o '"hook_event_name":"[^"]*"' | sed 's/"hook_event_name":"//;s/"//')
HOOK_EVENT=${HOOK_EVENT:-unknown}

echo "[$TIMESTAMP] Hook fired! Event: $HOOK_EVENT, Tool: $TOOL_NAME" >> "$LOG_FILE"
echo "  Raw input: $INPUT" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"

# Output JSON so Claude sees feedback
echo "{\"hookSpecificOutput\":{\"hookEventName\":\"$HOOK_EVENT\",\"additionalContext\":\"Hook test: tool usage logged to hook-log.txt\"}}"
