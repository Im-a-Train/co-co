//! co-co desktop app (Tauri 2) – M0 login spike.
//!
//! All eCamp HTTP traffic runs in Rust (reqwest + cookie jar). The frontend
//! only receives cookie names and decoded `jwt_hp` claims, never cookie values.

mod ai;
mod api;
mod auth;
mod commands;
mod data_key;
mod error;
mod files;
mod instance;
mod login_window;
mod midata;
mod nds;
mod persons;
mod session;

#[cfg(test)]
mod live_tests;
#[cfg(test)]
mod midata_live_tests;
#[cfg(test)]
mod nds_live_tests;

use session::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::new().expect("HTTP-Client konnte nicht erstellt werden");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .manage(midata::MidataState::new().expect("MiData-HTTP-Client konnte nicht erstellt werden"))
        .manage(persons::PersonsState::default())
        .manage(nds::NdsState::new().expect("NDS-HTTP-Client konnte nicht erstellt werden"))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(files::FileState::load(&dir));
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != session::MAIN_LABEL {
                return;
            }
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                files::handle_drop(window.app_handle(), paths);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::discover_instance,
            commands::open_login_window,
            commands::password_login,
            commands::session_status,
            commands::refresh_session,
            commands::api_get,
            commands::logout,
            commands::api_post_comment,
            commands::api_patch_comment,
            commands::open_ecamp_url,
            commands::pick_files,
            commands::pick_folder,
            commands::read_document,
            commands::list_folder,
            commands::watch_folder,
            commands::unwatch_folder,
            commands::save_text_file,
            commands::open_text_file,
            commands::ai_set_key,
            commands::ai_has_key,
            commands::ai_clear_key,
            commands::ai_complete,
            midata::midata_status,
            midata::midata_open_login,
            midata::midata_set_token,
            midata::midata_logout,
            midata::midata_find_events,
            midata::midata_fetch_aggregate,
            midata::midata_probe,
            midata::midata_find_self,
            nds::nds_status,
            nds::nds_open_login,
            nds::nds_logout,
            nds::nds_find_camps,
            nds::nds_fetch_aggregate,
            nds::nds_probe,
            midata::persons_load_midata,
            nds::persons_load_nds,
            persons::persons_clear,
            commands::unlock_data_store,
            commands::lock_data_store,
        ])
        .run(tauri::generate_context!())
        .expect("error while running co-co");
}
