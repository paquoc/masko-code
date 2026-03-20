# Codex Parity Status

This branch closes the main ingestion and UI-parity gaps between the existing Claude flow and Codex session logs. The remaining gap is reply transport back into a live Codex terminal session.

## Completed

- Question turns that Codex emits as plain commentary are surfaced as local `AskUserQuestion` prompts.
- Empty Codex agent messages are ignored so Masko does not create blank notifications.
- Question-only turns no longer create misleading completion notifications or completion toasts.
- Custom tool calls read `input` payloads correctly, including escalated permission metadata.
- Tool failures are detected from exit metadata and output text even when `status` is missing.
- Tool outputs preserve the originating tool name across follow-up records.
- Codex approval prompts surface persistent approval suggestions from `prefix_rule`.
- Codex decision mappings match the current terminal UI for:
  - allow once
  - allow with persistent execpolicy amendment
- Token usage notifications fall back to absolute totals when rate-limit percentages are absent.
- The smoke harness now supports:
  - manual mascot testing
  - automated ingestion verification for question, approval, and completion flows

## Missing For Full Claude Parity

- Background replies into an already-running Codex TUI session. macOS tty-device writes do not inject input into the Codex process, and `TIOCSTI` is blocked with `EPERM` on the tested machine.
- A supported Codex-side control transport for approvals and question answers. The likely path is the experimental app-server protocol, not terminal-device writes.
- A live end-to-end mascot-button test that proves overlay answers resolve a Codex approval without focusing the terminal.

## Current UX

- Masko surfaces Codex questions and approval prompts in the overlay.
- For Codex prompts, the overlay now directs the user to open the terminal instead of pretending it can silently answer in the background.
- Claude behavior remains unchanged.
