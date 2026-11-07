//! MiData connection (M7, red zone, read-only).
//!
//! Own HTTP client + cookie jar (separate from eCamp), own login window
//! (`midata-login`, no capability / no IPC), service token in the OS keychain.
//! Raw responses are reduced in `coco_core::midata`; only aggregates, event
//! summaries, probe results (names + status codes) and status cross to the UI.
//! Refreshed only on explicit user request, never in the background.
//!
//! CONTRACT (M7): command names/args/returns are fixed (see
//! docs/contracts/commands.md and src/lib/tauri.ts). Fill in the bodies.

use coco_core::midata::{MidataAggregate, MidataEventSummary, MidataProbe, MidataStatus};
use tauri::{AppHandle, Runtime, State, Webview};

use crate::error::{AppError, AppResult};
use crate::session::ensure_main;

/// Label of the MiData login window (no capability).
pub const MIDATA_LOGIN_LABEL: &str = "midata-login";
/// Event emitted to "main" with a `MidataStatus` payload after login/logout.
pub const EVENT_MIDATA_STATUS: &str = "midata://status";

/// Managed state of the MiData connection.
pub struct MidataState {}

impl MidataState {
    pub fn new() -> AppResult<Self> {
        Ok(Self {})
    }
}

fn not_yet() -> AppError {
    AppError::Unexpected("MiData ist noch nicht implementiert".into())
}

#[tauri::command]
pub async fn midata_status<R: Runtime>(webview: Webview<R>, state: State<'_, MidataState>) -> AppResult<MidataStatus> {
    ensure_main(&webview)?;
    let _ = state;
    Err(not_yet())
}

#[tauri::command]
pub async fn midata_open_login<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, MidataState>,
    base_url: String,
) -> AppResult<()> {
    ensure_main(&webview)?;
    let _ = (app, state, base_url);
    Err(not_yet())
}

#[tauri::command]
pub async fn midata_set_token<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, MidataState>,
    base_url: String,
    token: String,
) -> AppResult<MidataStatus> {
    ensure_main(&webview)?;
    let _ = (app, state, base_url, token);
    Err(not_yet())
}

#[tauri::command]
pub async fn midata_logout<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, MidataState>,
) -> AppResult<()> {
    ensure_main(&webview)?;
    let _ = (app, state);
    Err(not_yet())
}

#[tauri::command]
pub async fn midata_find_events<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MidataState>,
    from: String,
    to: String,
) -> AppResult<Vec<MidataEventSummary>> {
    ensure_main(&webview)?;
    let _ = (state, from, to);
    Err(not_yet())
}

#[tauri::command]
pub async fn midata_fetch_aggregate<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MidataState>,
    event_id: String,
    camp_start: String,
    camp_end: String,
    coach_person_id: Option<String>,
) -> AppResult<MidataAggregate> {
    ensure_main(&webview)?;
    let _ = (state, event_id, camp_start, camp_end, coach_person_id);
    Err(not_yet())
}

#[tauri::command]
pub async fn midata_probe<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MidataState>,
    event_id: String,
    group_id: Option<String>,
) -> AppResult<MidataProbe> {
    ensure_main(&webview)?;
    let _ = (state, event_id, group_id);
    Err(not_yet())
}
