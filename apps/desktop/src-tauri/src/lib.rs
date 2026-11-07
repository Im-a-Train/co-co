//! co-co desktop app (Tauri 2) – M0 login spike.
//!
//! All eCamp HTTP traffic runs in Rust (reqwest + cookie jar). The frontend
//! only receives cookie names and decoded `jwt_hp` claims, never cookie values.

mod ai;
mod api;
mod auth;
mod commands;
mod error;
mod files;
mod instance;
mod login_window;
mod session;

#[cfg(test)]
mod live_tests;

use session::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::new().expect("HTTP-Client konnte nicht erstellt werden");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running co-co");
}
