// src-tauri/src/telegram/formatter.rs
#![allow(dead_code)]

use serde_json::Value;

use crate::models::AgentEvent;

/// Build the HTML body for a Telegram permission message.
pub fn build_html(event: &AgentEvent) -> String {
    let folder = project_folder(event);
    let tool = event.tool_name.as_deref().unwrap_or("Unknown");
    let body = tool_body(tool, event.tool_input.as_ref());
    format!(
        "📁 <b>{folder}</b>\n🔧 <b>{tool}</b>\n{body}\n<i>💬 Chat để bảo tôi làm gì khác</i>",
        folder = html_escape(&folder),
        tool = html_escape(tool),
        body = body,
    )
}

/// Escape the three HTML-sensitive characters for Telegram HTML parse mode.
pub fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Truncate a string to `max` chars, appending "..." if truncated.
pub fn truncate_pre(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push_str("...");
        out
    }
}

fn project_folder(event: &AgentEvent) -> String {
    if let Some(cwd) = &event.cwd {
        if let Some(name) = std::path::Path::new(cwd).file_name() {
            return name.to_string_lossy().into_owned();
        }
        return cwd.clone();
    }
    "(unknown)".to_string()
}

fn tool_body(tool: &str, input: Option<&Value>) -> String {
    let input = match input {
        Some(v) => v,
        None => return format!("<code>{}</code>", html_escape(tool)),
    };
    match tool {
        "Bash" => {
            let cmd = input.get("command").and_then(|v| v.as_str()).unwrap_or("");
            let truncated = truncate_pre(cmd, 100);
            format!("<pre>{}</pre>", html_escape(&truncated))
        }
        "Edit" | "Write" | "Read" => {
            let path = input
                .get("file_path")
                .and_then(|v| v.as_str())
                .unwrap_or("(no path)");
            format!("{tool}: <code>{}</code>", html_escape(path))
        }
        "Grep" | "Glob" => {
            let pat = input
                .get("pattern")
                .and_then(|v| v.as_str())
                .unwrap_or("(no pattern)");
            format!("{tool}: <code>{}</code>", html_escape(pat))
        }
        _ => {
            let dumped = serde_json::to_string(input).unwrap_or_default();
            let short = truncate_pre(&dumped, 100);
            format!(
                "<code>{}</code> <code>{}</code>",
                html_escape(tool),
                html_escape(&short)
            )
        }
    }
}

/// Port of the display label logic from `src/models/permission.ts:21-59`.
/// Accepts a raw suggestion object (serde_json::Value) as received from the
/// Claude hook. Returns a short, human-readable label used as the middle
/// inline keyboard button.
pub fn display_label_for(suggestion: &Value) -> String {
    let typ = suggestion.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match typ {
        "addRules" => {
            let rules = suggestion.get("rules").and_then(|v| v.as_array());
            let first = rules.and_then(|r| r.first());
            if let Some(rule) = first {
                let tool_name = rule
                    .get("toolName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("tool");
                let rule_content = rule
                    .get("ruleContent")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if rule_content.contains("**") {
                    let folder = rule_content
                        .trim_end_matches("/**")
                        .rsplit('/')
                        .next()
                        .unwrap_or("");
                    return format!("Allow {tool_name} in {folder}/");
                }
                if !rule_content.is_empty() {
                    let short = if rule_content.chars().count() > 30 {
                        let s: String = rule_content.chars().take(27).collect();
                        format!("{s}...")
                    } else {
                        rule_content.to_string()
                    };
                    return format!("Always allow `{short}`");
                }
                return format!("Always allow {tool_name}");
            }
            "Add rule".into()
        }
        "setMode" => {
            let mode = suggestion.get("mode").and_then(|v| v.as_str()).unwrap_or("");
            match mode {
                "acceptEdits" => "Auto-accept edits".into(),
                "plan" => "Switch to plan mode".into(),
                other if !other.is_empty() => other.into(),
                _ => "Set mode".into(),
            }
        }
        other if !other.is_empty() => other.into(),
        _ => "Unknown".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn bash_event(cmd: &str) -> AgentEvent {
        AgentEvent {
            hook_event_name: "PermissionRequest".into(),
            session_id: None,
            cwd: Some("/tmp/masko-code".into()),
            permission_mode: None,
            transcript_path: None,
            tool_name: Some("Bash".into()),
            tool_input: Some(json!({ "command": cmd })),
            tool_response: None,
            tool_use_id: None,
            message: None,
            title: None,
            notification_type: None,
            source: None,
            reason: None,
            model: None,
            stop_hook_active: None,
            last_assistant_message: None,
            agent_id: None,
            agent_type: None,
            task_id: None,
            task_subject: None,
            permission_suggestions: None,
        }
    }

    #[test]
    fn build_html_bash_short_command() {
        let e = bash_event("npm test");
        let html = build_html(&e);
        assert!(html.contains("📁 <b>masko-code</b>"));
        assert!(html.contains("🔧 <b>Bash</b>"));
        assert!(html.contains("<pre>npm test</pre>"));
        assert!(html.contains("<i>💬 Chat để bảo tôi làm gì khác</i>"));
    }

    #[test]
    fn build_html_bash_truncates_long_command() {
        let long = "a".repeat(250);
        let e = bash_event(&long);
        let html = build_html(&e);
        assert!(html.contains(&format!("<pre>{}...</pre>", "a".repeat(100))));
    }

    #[test]
    fn html_escape_handles_special_chars() {
        let e = bash_event("echo <hi> & done");
        let html = build_html(&e);
        assert!(html.contains("<pre>echo &lt;hi&gt; &amp; done</pre>"));
        assert!(!html.contains("&amp;lt;"));
    }

    #[test]
    fn tool_body_edit_shows_file_path() {
        let mut e = bash_event("");
        e.tool_name = Some("Edit".into());
        e.tool_input = Some(json!({ "file_path": "src/main.rs" }));
        let html = build_html(&e);
        assert!(html.contains("Edit: <code>src/main.rs</code>"));
    }

    #[test]
    fn tool_body_unknown_tool_falls_back_to_json() {
        let mut e = bash_event("");
        e.tool_name = Some("ExoticTool".into());
        e.tool_input = Some(json!({ "a": 1, "b": "two" }));
        let html = build_html(&e);
        assert!(html.contains("<code>ExoticTool</code>"));
    }

    #[test]
    fn project_folder_fallback_when_cwd_missing() {
        let mut e = bash_event("ls");
        e.cwd = None;
        let html = build_html(&e);
        assert!(html.contains("(unknown)"));
    }

    #[test]
    fn display_label_set_mode_accept_edits() {
        let s = json!({ "type": "setMode", "mode": "acceptEdits" });
        assert_eq!(display_label_for(&s), "Auto-accept edits");
    }

    #[test]
    fn display_label_add_rules_with_glob() {
        let s = json!({
            "type": "addRules",
            "rules": [{ "toolName": "Bash", "ruleContent": "some/path/build/**" }]
        });
        assert_eq!(display_label_for(&s), "Allow Bash in build/");
    }

    #[test]
    fn display_label_add_rules_with_exact_content() {
        let s = json!({
            "type": "addRules",
            "rules": [{ "toolName": "Bash", "ruleContent": "git status" }]
        });
        assert_eq!(display_label_for(&s), "Always allow `git status`");
    }
}
