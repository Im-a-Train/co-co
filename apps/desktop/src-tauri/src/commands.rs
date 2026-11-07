//! Tauri commands (all async, so none runs on the main thread – required for
//! the WebView2 cookie APIs). Each command rejects calls from any webview
//! other than "main".

use coco_core::types::{AuthLog, InstanceInfo, SessionInfo};
use tauri::{AppHandle, Runtime, State, Webview};

use crate::files::{self, DocumentBytes, FileFilter, FileState, FolderEntry, TextFile};
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

// ---- M2: eCamp comments

#[tauri::command]
pub async fn api_post_comment<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, AppState>,
    camp_iri: String,
    activity_iri: String,
    text_html: String,
) -> AppResult<serde_json::Value> {
    ensure_main(&webview)?;
    let body = coco_core::comments::build_post_body(&camp_iri, &activity_iri, &text_html)?;
    crate::api::post_comment(&app, &state, &body).await
}

#[tauri::command]
pub async fn api_patch_comment<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, AppState>,
    comment_iri: String,
    patch: serde_json::Value,
) -> AppResult<serde_json::Value> {
    ensure_main(&webview)?;
    let (path, patch) = coco_core::comments::build_patch(&comment_iri, &patch)?;
    crate::api::patch_comment(&app, &state, &path, &patch).await
}

// ---- M3: files and documents

#[tauri::command]
pub async fn pick_files<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    files: State<'_, FileState>,
    filters: Option<Vec<FileFilter>>,
) -> AppResult<Vec<String>> {
    ensure_main(&webview)?;
    files::pick_files(&app, &files, filters).await
}

#[tauri::command]
pub async fn pick_folder<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    files: State<'_, FileState>,
) -> AppResult<Option<String>> {
    ensure_main(&webview)?;
    files::pick_folder(&app, &files).await
}

#[tauri::command]
pub async fn read_document<R: Runtime>(
    webview: Webview<R>,
    files: State<'_, FileState>,
    path: String,
) -> AppResult<DocumentBytes> {
    ensure_main(&webview)?;
    files::read_document(&files, &path).await
}

#[tauri::command]
pub async fn list_folder<R: Runtime>(
    webview: Webview<R>,
    files: State<'_, FileState>,
    path: String,
) -> AppResult<Vec<FolderEntry>> {
    ensure_main(&webview)?;
    files::list_folder(&files, &path).await
}

#[tauri::command]
pub async fn watch_folder<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    files: State<'_, FileState>,
    path: String,
) -> AppResult<()> {
    ensure_main(&webview)?;
    files::watch_folder(&app, &files, &path)
}

#[tauri::command]
pub async fn unwatch_folder<R: Runtime>(
    webview: Webview<R>,
    files: State<'_, FileState>,
    path: String,
) -> AppResult<()> {
    ensure_main(&webview)?;
    files::unwatch_folder(&files, &path)
}

// ---- M4: backup files

#[tauri::command]
pub async fn save_text_file<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    default_name: String,
    content: String,
) -> AppResult<Option<String>> {
    ensure_main(&webview)?;
    files::save_text_file(&app, default_name, content).await
}

#[tauri::command]
pub async fn open_text_file<R: Runtime>(app: AppHandle<R>, webview: Webview<R>) -> AppResult<Option<TextFile>> {
    ensure_main(&webview)?;
    files::open_text_file(&app).await
}

// ---- M5: AI

#[tauri::command]
pub async fn ai_set_key<R: Runtime>(webview: Webview<R>, key: String) -> AppResult<()> {
    ensure_main(&webview)?;
    crate::ai::set_key(key).await
}

#[tauri::command]
pub async fn ai_has_key<R: Runtime>(webview: Webview<R>) -> AppResult<bool> {
    ensure_main(&webview)?;
    crate::ai::has_key().await
}

#[tauri::command]
pub async fn ai_clear_key<R: Runtime>(webview: Webview<R>) -> AppResult<()> {
    ensure_main(&webview)?;
    crate::ai::clear_key().await
}

#[tauri::command]
pub async fn ai_complete<R: Runtime>(
    webview: Webview<R>,
    request: coco_core::ai::AiRequest,
) -> AppResult<crate::ai::AiResponse> {
    ensure_main(&webview)?;
    crate::ai::complete(request).await
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
