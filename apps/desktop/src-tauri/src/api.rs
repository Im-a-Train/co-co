//! `api_get`: authenticated GET against the current session's eCamp API only.

use std::sync::Arc;

use coco_core::origin::resolve_api_path;
use coco_core::types::AuthLog;
use reqwest::StatusCode;
use tauri::{AppHandle, Runtime};
use url::Url;

use crate::error::{AppError, AppResult};
use crate::session::{log, read_body_capped, refresh_locked, AppState, Session};

const MAX_DETAIL_CHARS: usize = 300;
/// Upper bound for one API response (large embedded collections stay far below).
const MAX_API_BODY: usize = 16 * 1024 * 1024;

pub async fn api_get<R: Runtime>(app: &AppHandle<R>, state: &AppState, path: &str) -> AppResult<serde_json::Value> {
    let session = state.current().await.ok_or(AppError::NotLoggedIn)?;
    let url = resolve_api_path(path, &session.instance.api_root, &session.instance.origins())?;

    let resp = send(&session, &url).await?;
    if resp.status() != StatusCode::UNAUTHORIZED {
        let v = into_json(resp).await;
        ensure_still_current(state, &session).await?;
        return v;
    }

    // 401: refresh once (unless another task already refreshed), then retry once.
    log(app, AuthLog::fail("api-401", Some(format!("GET {} -> 401, versuche Token-Erneuerung", url.path()))));
    let retry_session = {
        let _guard = state.refresh_lock.lock().await;
        let current = state.current().await.ok_or(AppError::NotLoggedIn)?;
        if current.generation != session.generation {
            current
        } else {
            refresh_locked(app, state, current).await?;
            state.current().await.ok_or(AppError::NotLoggedIn)?
        }
    };
    // The session may have switched instance in between; re-validate.
    let url = resolve_api_path(path, &retry_session.instance.api_root, &retry_session.instance.origins())?;
    let resp = send(&retry_session, &url).await?;
    let ok = resp.status().is_success();
    log(
        app,
        AuthLog {
            step: "api-retry".into(),
            ok,
            detail: Some(format!("GET {} -> HTTP {}", url.path(), resp.status().as_u16())),
        },
    );
    let v = into_json(resp).await;
    ensure_still_current(state, &retry_session).await?;
    v
}

/// After a logout or a new login while the request was in flight, the data
/// belongs to a session that no longer exists: do not hand it out.
async fn ensure_still_current(state: &AppState, session: &Session) -> AppResult<()> {
    match state.current().await {
        Some(s) if Arc::ptr_eq(&s.jar, &session.jar) => Ok(()),
        _ => Err(AppError::NotLoggedIn),
    }
}

async fn send(session: &Session, url: &Url) -> AppResult<reqwest::Response> {
    Ok(session.client.get(url.clone()).send().await?)
}

async fn into_json(resp: reqwest::Response) -> AppResult<serde_json::Value> {
    let status = resp.status();
    let bytes = read_body_capped(resp, MAX_API_BODY).await?;
    if !status.is_success() {
        return Err(AppError::Status { status: status.as_u16(), detail: problem_detail(&bytes) });
    }
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Ok(serde_json::Value::Null);
    }
    serde_json::from_slice(&bytes).map_err(|e| AppError::Unexpected(format!("kein JSON: {e}")))
}

/// Extracts a short human-readable message from an API Platform / hydra /
/// problem+json error body.
pub(crate) fn problem_detail(body: &[u8]) -> Option<String> {
    let v: serde_json::Value = serde_json::from_slice(body).ok()?;
    let msg = ["detail", "hydra:description", "message", "title", "hydra:title"]
        .iter()
        .find_map(|k| v.get(*k).and_then(|m| m.as_str()).filter(|s| !s.trim().is_empty()))?;
    let mut s: String = msg.chars().take(MAX_DETAIL_CHARS).collect();
    if msg.chars().count() > MAX_DETAIL_CHARS {
        s.push('…');
    }
    Some(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_problem_details() {
        assert_eq!(problem_detail(br#"{"title":"Not Found","detail":"Camp not found"}"#).as_deref(), Some("Camp not found"));
        assert_eq!(problem_detail(br#"{"code":401,"message":"JWT Token not found"}"#).as_deref(), Some("JWT Token not found"));
        assert_eq!(problem_detail(br#"{"hydra:description":"x"}"#).as_deref(), Some("x"));
        assert_eq!(problem_detail(b"<html>"), None);
        assert_eq!(problem_detail(br#"{"detail":"  "}"#), None);
        let long = format!(r#"{{"detail":"{}"}}"#, "a".repeat(400));
        assert_eq!(problem_detail(long.as_bytes()).unwrap().chars().count(), MAX_DETAIL_CHARS + 1);
    }
}
