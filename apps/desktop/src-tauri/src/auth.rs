//! Password login (fallback), refresh and logout.

use std::sync::Arc;

use coco_core::types::{AuthLog, AuthMethod, SessionInfo};
use reqwest::cookie::Jar;
use reqwest::StatusCode;
use tauri::{AppHandle, Manager, Runtime};

use crate::error::{AppError, AppResult};
use crate::instance::get_or_discover;
use crate::login_window::LOGIN_LABEL;
use crate::session::{build_client, emit_session, log, refresh_locked, session_from_jar, AppState};

/// POST `{api}/authentication_token` with `{"identifier","password"}`; the
/// reqwest jar captures the Set-Cookie headers. The password is not logged
/// or stored anywhere.
pub async fn password_login<R: Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
    base_url: &str,
    identifier: &str,
    password: &str,
) -> AppResult<SessionInfo> {
    let instance = get_or_discover(app, state, base_url).await?;
    let jar = Arc::new(Jar::default());
    let client = build_client(&instance, jar.clone())?;
    log(app, AuthLog::ok("password-login-start", Some(format!("POST {}", instance.login_url.path()))));

    let body = serde_json::json!({ "identifier": identifier, "password": password });
    let resp = match client.post(instance.login_url.clone()).json(&body).send().await {
        Ok(r) => r,
        Err(e) => {
            let err = AppError::from(e);
            log(app, AuthLog::fail("password-login", Some(err.to_string())));
            return Err(err);
        }
    };
    drop(body);
    let status = resp.status();
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::BAD_REQUEST {
        log(app, AuthLog::fail("password-login", Some(format!("HTTP {}", status.as_u16()))));
        return Err(AppError::InvalidCredentials);
    }
    if !status.is_success() {
        let err = AppError::Status { status: status.as_u16(), detail: None };
        log(app, AuthLog::fail("password-login", Some(err.to_string())));
        return Err(err);
    }

    let session = match session_from_jar(&instance, jar, AuthMethod::Password) {
        Ok(s) => s,
        Err(e) => {
            log(app, AuthLog::fail("password-login", Some(e.to_string())));
            return Err(e);
        }
    };
    let info = state.store(session).await;
    log(
        app,
        AuthLog::ok(
            "password-login",
            Some(format!("HTTP {}, Cookies: {}", status.as_u16(), info.cookie_names.join(", "))),
        ),
    );
    emit_session(app, &info);
    Ok(info)
}

pub async fn refresh_session<R: Runtime>(app: &AppHandle<R>, state: &AppState) -> AppResult<SessionInfo> {
    let _guard = state.refresh_lock.lock().await;
    let current = state.current().await.ok_or(AppError::NotLoggedIn)?;
    refresh_locked(app, state, current).await
}

/// Clears the Rust session (client + jar are dropped) and the login webview's
/// browsing data, if the login window is open. The login window is always
/// created in incognito mode, so the next open starts with a fresh state.
pub async fn logout<R: Runtime>(app: &AppHandle<R>, state: &AppState) -> AppResult<()> {
    let _guard = state.refresh_lock.lock().await;
    // Cancels any webview login whose cookie check is already in flight: it
    // re-checks the epoch under `refresh_lock` before storing its session.
    state.logout_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    state.clear().await;
    if let Some(win) = app.get_webview_window(LOGIN_LABEL) {
        // Off the main thread (WebView2 deadlock caveat for browsing-data APIs).
        let res = tauri::async_runtime::spawn_blocking(move || {
            let cleared = win.clear_all_browsing_data();
            let _ = win.close();
            cleared
        })
        .await;
        match res {
            Ok(Ok(())) => log(app, AuthLog::ok("logout-clear-login-webview", None)),
            Ok(Err(e)) => log(app, AuthLog::fail("logout-clear-login-webview", Some(e.to_string()))),
            Err(e) => log(app, AuthLog::fail("logout-clear-login-webview", Some(e.to_string()))),
        }
    }
    log(app, AuthLog::ok("logout", Some("Sitzung und Cookie-Jar verworfen".into())));
    Ok(())
}
