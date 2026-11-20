//! In-app updates (ADR 0018). Wraps tauri-plugin-updater in our own commands; the plugin's JS API
//! and permissions are not exposed. The only host contacted is github.com (static `latest.json`
//! of the rolling `updater` release); no personal data is sent. Errors are short German texts
//! without URLs.

use coco_core::update::{self, AppUpdateInfo};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, Webview};
use tauri_plugin_updater::UpdaterExt;

use crate::error::{AppError, AppResult};
use crate::session::{ensure_main, MAIN_LABEL};

pub const EVENT_UPDATE_PROGRESS: &str = "app-update://progress";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

/// Portable = no `uninstall.exe` next to the exe (NSIS installs have one). Non-Windows: never installable.
fn is_portable() -> bool {
    let Ok(exe) = std::env::current_exe() else { return true };
    let Some(dir) = exe.parent() else { return true };
    let names: Vec<String> = std::fs::read_dir(dir)
        .map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect())
        .unwrap_or_default();
    update::is_portable(&names)
}

fn friendly(e: &tauri_plugin_updater::Error) -> AppError {
    use tauri_plugin_updater::Error as E;
    let msg = match e {
        E::Reqwest(_) => "Keine Verbindung zu GitHub. Bitte Internetverbindung prüfen.",
        E::ReleaseNotFound => "Es wurde keine Update-Information gefunden.",
        E::Network(_) => "Der Update-Server hat nicht wie erwartet geantwortet.",
        E::Semver(_) | E::Serialization(_) | E::TargetNotFound(_) | E::TargetsNotFound(_) => {
            "Die Update-Information ist ungültig."
        }
        E::Minisign(_) | E::SignatureUtf8(_) | E::Base64(_) => "Die Signatur des Updates ist ungültig. Update abgebrochen.",
        _ => "Die Update-Prüfung ist fehlgeschlagen.",
    };
    AppError::Unexpected(msg.into())
}

fn build_info(current: &str, found: Option<&tauri_plugin_updater::Update>, portable: bool) -> AppUpdateInfo {
    let shown = found.map(|u| u.version.clone()).unwrap_or_else(|| current.to_string());
    AppUpdateInfo {
        current_version: current.to_string(),
        available: found.is_some(),
        version: found.map(|u| u.version.clone()),
        notes: found.and_then(|u| u.body.as_deref()).map(update::truncate_notes).filter(|n| !n.is_empty()),
        date: found.and_then(|u| u.date).map(|d| d.to_string()),
        can_install: found.is_some() && !portable && cfg!(windows),
        portable,
        release_url: update::release_url(&shown),
    }
}

async fn check<R: Runtime>(app: &AppHandle<R>) -> AppResult<(Option<tauri_plugin_updater::Update>, String)> {
    let current = app.package_info().version.to_string();
    let updater = app.updater().map_err(|e| friendly(&e))?;
    let found = updater.check().await.map_err(|e| friendly(&e))?;
    Ok((found, current))
}

#[tauri::command]
pub async fn app_update_check<R: Runtime>(app: AppHandle<R>, webview: Webview<R>) -> AppResult<AppUpdateInfo> {
    ensure_main(&webview)?;
    let (found, current) = check(&app).await?;
    Ok(build_info(&current, found.as_ref(), is_portable()))
}

/// Whether the start-up check may run at all (unstamped dev/debug builds skip it).
#[tauri::command]
pub async fn app_update_auto_check_allowed<R: Runtime>(app: AppHandle<R>, webview: Webview<R>) -> AppResult<bool> {
    ensure_main(&webview)?;
    Ok(update::auto_check_allowed(&app.package_info().version.to_string(), cfg!(debug_assertions)))
}

/// Opens the GitHub release page of `version` (validated, invalid -> releases overview) in the system browser.
/// The UI never passes a URL, so this cannot be used to open arbitrary links.
#[tauri::command]
pub async fn app_update_open_release<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    version: Option<String>,
) -> AppResult<()> {
    ensure_main(&webview)?;
    use tauri_plugin_opener::OpenerExt;
    let url = update::release_url(version.as_deref().unwrap_or(""));
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| AppError::Unexpected("Der Browser konnte nicht geöffnet werden".into()))?;
    Ok(())
}

#[tauri::command]
pub async fn app_update_install<R: Runtime>(app: AppHandle<R>, webview: Webview<R>) -> AppResult<()> {
    ensure_main(&webview)?;
    if is_portable() || !cfg!(windows) {
        return Err(AppError::Unexpected(
            "Die portable Version kann sich nicht selbst aktualisieren. Bitte die Download-Seite öffnen.".into(),
        ));
    }
    let (found, _) = check(&app).await?;
    let Some(found) = found else {
        return Err(AppError::Unexpected("Es ist kein Update verfügbar.".into()));
    };
    let mut downloaded: u64 = 0;
    let handle = app.clone();
    found
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = handle.emit_to(MAIN_LABEL, EVENT_UPDATE_PROGRESS, Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| friendly(&e))?;
    app.restart();
}
