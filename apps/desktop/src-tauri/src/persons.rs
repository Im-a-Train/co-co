//! «Personen» tab state (ADR 0009, red zone): the last loaded MiData and NDS person lists.
//!
//! Memory only: no file, no keychain, no log line, no event. The lists are wiped by
//! `persons_clear` (UI: lock, logout, leaving the tab) and vanish when the app exits. Errors from the
//! load commands carry HTTP status / path / parameter names only (see `midata.rs` / `nds.rs`).

use std::sync::Mutex;

use coco_core::persons::{MidataPersonsResult, NdsPersonsResult};
use tauri::{AppHandle, Manager, Runtime, State, Webview};

use crate::error::AppResult;
use crate::session::ensure_main;

#[derive(Default)]
pub struct PersonsState {
    midata: Mutex<Option<MidataPersonsResult>>,
    nds: Mutex<Option<NdsPersonsResult>>,
}

impl PersonsState {
    pub fn set_midata(&self, r: MidataPersonsResult) {
        *self.midata.lock().unwrap_or_else(|e| e.into_inner()) = Some(r);
    }

    pub fn set_nds(&self, r: NdsPersonsResult) {
        *self.nds.lock().unwrap_or_else(|e| e.into_inner()) = Some(r);
    }

    pub fn clear_midata(&self) {
        *self.midata.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    pub fn clear_nds(&self) {
        *self.nds.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    pub fn clear(&self) {
        *self.midata.lock().unwrap_or_else(|e| e.into_inner()) = None;
        *self.nds.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    #[cfg(test)]
    fn is_empty(&self) -> bool {
        self.midata.lock().unwrap_or_else(|e| e.into_inner()).is_none() && self.nds.lock().unwrap_or_else(|e| e.into_inner()).is_none()
    }
}

/// Defence in depth: logout commands wipe the matching lists themselves (no-op when the state is absent).
pub fn clear_midata_of<R: Runtime>(app: &AppHandle<R>) {
    if let Some(s) = app.try_state::<PersonsState>() {
        s.clear_midata();
    }
}

pub fn clear_nds_of<R: Runtime>(app: &AppHandle<R>) {
    if let Some(s) = app.try_state::<PersonsState>() {
        s.clear_nds();
    }
}

pub fn clear_all_of<R: Runtime>(app: &AppHandle<R>) {
    if let Some(s) = app.try_state::<PersonsState>() {
        s.clear();
    }
}

/// Wipes the in-memory person lists.
#[tauri::command]
pub async fn persons_clear<R: Runtime>(webview: Webview<R>, state: State<'_, PersonsState>) -> AppResult<()> {
    ensure_main(&webview)?;
    state.clear();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_and_clear() {
        let s = PersonsState::default();
        assert!(s.is_empty());
        s.set_midata(MidataPersonsResult { red: true, event_id: "1".into(), persons: vec![], qualifications_readable: true, fetched_at: "t".into() });
        s.set_nds(NdsPersonsResult { red: true, nds_camp_id: "2".into(), persons: vec![], fetched_at: "t".into() });
        assert!(!s.is_empty());
        s.clear();
        assert!(s.is_empty());
    }

    #[test]
    fn clears_only_the_matching_list() {
        let s = PersonsState::default();
        let m = MidataPersonsResult { red: true, event_id: "1".into(), persons: vec![], qualifications_readable: true, fetched_at: "t".into() };
        let n = NdsPersonsResult { red: true, nds_camp_id: "2".into(), persons: vec![], fetched_at: "t".into() };
        s.set_midata(m.clone());
        s.set_nds(n.clone());
        s.clear_midata();
        assert!(s.midata.lock().unwrap().is_none() && s.nds.lock().unwrap().is_some());
        s.set_midata(m);
        s.clear_nds();
        assert!(s.midata.lock().unwrap().is_some() && s.nds.lock().unwrap().is_none());
    }
}
