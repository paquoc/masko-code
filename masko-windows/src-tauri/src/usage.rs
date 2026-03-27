use serde::{Deserialize, Serialize};
use std::fs;

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
    let home = dirs::home_dir();
    if home.is_none() {
        eprintln!("[masko-usage] home_dir() returned None");
        return None;
    }
    let cred_path = home.unwrap().join(".claude").join(".credentials.json");
    eprintln!("[masko-usage] cred_path: {}", cred_path.display());

    let cred_text = match fs::read_to_string(&cred_path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[masko-usage] read credentials failed: {e}");
            return None;
        }
    };

    let cred: serde_json::Value = match serde_json::from_str(&cred_text) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[masko-usage] parse credentials failed: {e}");
            return None;
        }
    };

    // Token may be at top-level "accessToken" or nested under "claudeAiOauth.accessToken"
    let token = match cred.get("accessToken").and_then(|v| v.as_str())
        .or_else(|| cred.pointer("/claudeAiOauth/accessToken").and_then(|v| v.as_str()))
    {
        Some(t) => t,
        None => {
            eprintln!("[masko-usage] no accessToken in credentials. Keys: {:?}",
                cred.as_object().map(|o| o.keys().collect::<Vec<_>>()));
            return None;
        }
    };
    eprintln!("[masko-usage] token found (len={})", token.len());

    let client = reqwest::Client::new();
    let resp = match client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", format!("Bearer {}", token))
        .header("anthropic-beta", "oauth-2025-04-20")
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(r) => {
            eprintln!("[masko-usage] API status: {}", r.status());
            r
        }
        Err(e) => {
            eprintln!("[masko-usage] API request failed: {e}");
            return None;
        }
    };

    let body: serde_json::Value = match resp.json().await {
        Ok(v) => {
            eprintln!("[masko-usage] API body: {v}");
            v
        }
        Err(e) => {
            eprintln!("[masko-usage] parse API response failed: {e}");
            return None;
        }
    };

    // API returns utilization as percentage (e.g. 15.0 = 15%), normalize to 0.0-1.0
    let normalize = |v: f64| if v > 1.0 { v / 100.0 } else { v };

    let session_percent = body
        .pointer("/five_hour/utilization")
        .and_then(|v| v.as_f64())
        .map(normalize);
    let session_resets_at = body
        .pointer("/five_hour/resets_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let weekly_percent = body
        .pointer("/seven_day/utilization")
        .and_then(|v| v.as_f64())
        .map(normalize);
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
