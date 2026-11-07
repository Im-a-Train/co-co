//! Tauri commands (all async, so none runs on the main thread – required for
//! the WebView2 cookie APIs). Each command rejects calls from any webview
//! other than "main".

use coco_core::types::{AuthLog, InstanceInfo, SessionInfo};
use tauri::{AppHandle, Runtime, State, Webview};

use crate::error::AppResult;
use crate::session::{ensure_main, log, AppState};

#[tauri::command]
pub async fn discover_instance<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, AppState>,
    base_url: String,
) -> AppResult<InstanceInfo> {
    ensure_main(&webview)?;
    let instance = crate::instance::discover(&app, &state, &base_url).await?;
    Ok(instance.info)
}

#[tauri::command]
pub async fn open_login_window<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, AppState>,
    base_url: String,
) -> AppResult<()> {
    ensure_main(&webview)?;
    crate::login_window::open_login_window(&app, &state, &base_url).await
}

#[tauri::command]
pub async fn password_login<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, AppState>,
    base_url: String,
    identifier: String,
    password: String,
) -> AppResult<SessionInfo> {
    ensure_main(&webview)?;
    crate::auth::password_login(&app, &state, &base_url, &identifier, &password).await
}

#[tauri::command]
pub async fn session_status<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, AppState>,
) -> AppResult<Option<SessionInfo>> {
    ensure_main(&webview)?;
    Ok(state.current().await.map(|s| s.info))
}

#[tauri::command]
pub async fn refresh_session<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, AppState>,
) -> AppResult<SessionInfo> {
    ensure_main(&webview)?;
    crate::auth::refresh_session(&app, &state).await
}

#[tauri::command]
pub async fn api_get<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, AppState>,
    path: String,
) -> AppResult<serde_json::Value> {
    ensure_main(&webview)?;
    match crate::api::api_get(&app, &state, &path).await {
        Ok(v) => Ok(v),
        Err(e) => {
            log(&app, AuthLog::fail("api-get", Some(format!("{}: {e}", path_for_log(&path)))));
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn logout<R: Runtime>(app: AppHandle<R>, webview: Webview<R>, state: State<'_, AppState>) -> AppResult<()> {
    ensure_main(&webview)?;
    crate::auth::logout(&app, &state).await
}

/// Path without query string (queries could contain user-entered data).
fn path_for_log(path: &str) -> String {
    let p = path.split(['?', '#']).next().unwrap_or("");
    p.chars().take(200).collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn path_for_log_strips_query() {
        assert_eq!(super::path_for_log("/api/activities?camp=/api/camps/1"), "/api/activities");
        assert_eq!(super::path_for_log("/api/camps"), "/api/camps");
    }
}
