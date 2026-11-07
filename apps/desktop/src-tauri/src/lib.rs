//! co-co desktop app (Tauri 2) – M0 login spike.
//!
//! All eCamp HTTP traffic runs in Rust (reqwest + cookie jar). The frontend
//! only receives cookie names and decoded `jwt_hp` claims, never cookie values.

mod api;
mod auth;
mod commands;
mod error;
mod instance;
mod login_window;
mod session;

#[cfg(test)]
mod live_tests;

use session::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::new().expect("HTTP-Client konnte nicht erstellt werden");
    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::discover_instance,
            commands::open_login_window,
            commands::password_login,
            commands::session_status,
            commands::refresh_session,
            commands::api_get,
            commands::logout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running co-co");
}
