use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Rate limit usage data emitted to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageData {
    /// 5-hour session utilization (0.0 - 1.0)
    pub session_percent: Option<f64>,
    /// 5-hour session reset time (ISO 8601)
    pub session_resets_at: Option<String>,
    /// 7-day weekly utilization (0.0 - 1.0)
    pub weekly_percent: Option<f64>,
    /// 7-day weekly reset time (ISO 8601)
    pub weekly_resets_at: Option<String>,
}

/// Fetch rate limit usage from the Anthropic OAuth Usage API.
/// Reads the access token from ~/.claude/.credentials.json
pub async fn fetch_usage() -> Option<UsageData> {
    let cred_path = dirs::home_dir()?.join(".claude").join(".credentials.json");
    let cred_text = fs::read_to_string(&cred_path).ok()?;
    let cred: serde_json::Value = serde_json::from_str(&cred_text).ok()?;
    let token = cred.get("accessToken")?.as_str()?;

    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", format!("Bearer {}", token))
        .header("anthropic-beta", "oauth-2025-04-20")
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .ok()?;

    let body: serde_json::Value = resp.json().await.ok()?;

    let session_percent = body
        .pointer("/five_hour/utilization")
        .and_then(|v| v.as_f64());
    let session_resets_at = body
        .pointer("/five_hour/resets_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let weekly_percent = body
        .pointer("/seven_day/utilization")
        .and_then(|v| v.as_f64());
    let weekly_resets_at = body
        .pointer("/seven_day/resets_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Some(UsageData {
        session_percent,
        session_resets_at,
        weekly_percent,
        weekly_resets_at,
    })
}
