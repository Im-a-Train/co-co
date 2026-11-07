//! The `ecamp-login` window: loads the REMOTE eCamp login page (incl. OAuth
//! via PBS MiData, Google, ...), detects the end of the login and copies the
//! auth cookies from the webview's cookie store into the Rust cookie jar.
//!
//! Security:
//! - the window gets no capability (see capabilities/default.json), so the
//!   remote page has no IPC access; events are emitted to "main" only;
//! - it is created in incognito mode: fresh state on every open and its
//!   browsing data is isolated from the main window (clearing it on logout
//!   cannot wipe the app's own localStorage);
//! - only cookie NAMES and redacted URLs (no query) are logged.
//!
//! Windows caveat (wry#583): `cookies_for_url` deadlocks when called on the
//! main thread / inside event handlers. Every cookie read therefore happens on
//! a blocking worker via `spawn_blocking`, triggered from async tasks.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use coco_core::cookies::{dedupe_by_name, select_auth_cookies, RawCookie};
use coco_core::jwt::decode_jwt_hp;
use coco_core::instance::{base_url_string, normalize_base_url};
use coco_core::midata::{person_id_from_path, pick_session_cookie, DEFAULT_MIDATA_BASE_URL};
use url::Url;
use crate::midata::{adopt_session_cookies, MidataState};
use coco_core::login::{is_allowed_login_navigation, is_post_login_url, redact_url};
use coco_core::refresh::now_secs;
use coco_core::types::AuthLog;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use crate::error::{AppError, AppResult};
use crate::instance::get_or_discover;
use crate::session::{app_state, emit_session, log, session_from_webview_cookies, AppState, Instance};

pub const LOGIN_LABEL: &str = "ecamp-login";
const LOGIN_TITLE: &str = "eCamp Anmeldung";
const POLL_INTERVAL: Duration = Duration::from_millis(1000);
const POLL_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// State of one opened login window.
struct LoginAttempt {
    instance: Instance,
    /// Session captured; the window is being closed by us.
    done: AtomicBool,
    /// Window destroyed (by the user or by us).
    closed: AtomicBool,
    /// A cookie check is running (prevents overlapping reads).
    checking: AtomicBool,
    /// Last logged cookie-name list, to avoid log spam from the poller.
    last_names: StdMutex<Option<Vec<String>>>,
    /// `AppState::logout_epoch` when the window was opened.
    epoch: u64,
    /// Last `/people/<id>` seen on a foreign (MiData) origin: (origin, person id). Never logged.
    midata_person: StdMutex<Option<(String, String)>>,
}

pub async fn open_login_window<R: Runtime>(app: &AppHandle<R>, state: &AppState, base_url: &str) -> AppResult<()> {
    let requested = base_url_string(&normalize_base_url(base_url)?);
    if let Some(existing) = app.get_webview_window(LOGIN_LABEL) {
        let open_for = state.login_window_base.lock().ok().and_then(|g| g.clone());
        if open_for.as_deref() != Some(requested.as_str()) {
            let other = open_for.unwrap_or_else(|| "eine andere Instanz".into());
            log(app, AuthLog::fail("login-window-opened", Some(format!("Anmeldefenster für {other} ist bereits offen"))));
            return Err(AppError::Unexpected(format!(
                "Das Anmeldefenster für {other} ist bereits offen – bitte zuerst schliessen"
            )));
        }
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        log(app, AuthLog::ok("login-window-focused", Some("Anmeldefenster war bereits offen".into())));
        return Ok(());
    }

    let instance = get_or_discover(app, state, base_url).await?;
    let login_url = coco_core::instance::join_base(&instance.base, "login")?;

    let attempt = Arc::new(LoginAttempt {
        instance: instance.clone(),
        done: AtomicBool::new(false),
        closed: AtomicBool::new(false),
        checking: AtomicBool::new(false),
        last_names: StdMutex::new(None),
        epoch: state.logout_epoch.load(Ordering::SeqCst),
        midata_person: StdMutex::new(None),
    });

    let nav_attempt = attempt.clone();
    let nav_app = app.clone();
    let nav_base = instance.base.clone();
    let load_app = app.clone();
    let load_attempt = attempt.clone();

    let window = WebviewWindowBuilder::new(app, LOGIN_LABEL, WebviewUrl::External(login_url.clone()))
        .title(LOGIN_TITLE)
        .inner_size(520.0, 760.0)
        .min_inner_size(380.0, 480.0)
        .center()
        .focused(true)
        .incognito(true)
        .on_navigation(move |url| {
            // Runs on the main thread: only log, never touch cookies here.
            // Blocks plaintext http and the app's own (IPC-capable) origins.
            let allowed = is_allowed_login_navigation(url, &nav_base);
            if allowed && url.origin() != nav_base.origin() {
                // String work only: remember a MiData `/people/<id>` path (id is not logged).
                if let Some(id) = person_id_from_path(url.path()) {
                    if let Ok(mut g) = nav_attempt.midata_person.lock() {
                        *g = Some((url.origin().ascii_serialization(), id));
                    }
                }
            }
            log(
                &nav_app,
                AuthLog {
                    step: if allowed { "navigation" } else { "navigation-blocked" }.into(),
                    ok: allowed,
                    detail: Some(redact_url(url)),
                },
            );
            allowed
        })
        .on_page_load(move |webview, payload| {
            // Runs on the main thread: only spawn.
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let url = payload.url().clone();
            log(&load_app, AuthLog::ok("page-load", Some(redact_url(&url))));
            if is_post_login_url(&url, &load_attempt.instance.base) {
                let app = load_app.clone();
                let attempt = load_attempt.clone();
                tauri::async_runtime::spawn(async move {
                    check_cookies(&app, webview, &attempt, "page-load").await;
                });
            }
        })
        .build()
        .map_err(|e| {
            log(app, AuthLog::fail("login-window-opened", Some(e.to_string())));
            AppError::from(e)
        })?;

    if let Ok(mut g) = state.login_window_base.lock() {
        *g = Some(requested);
    }

    let ev_app = app.clone();
    let ev_attempt = attempt.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            ev_attempt.closed.store(true, Ordering::SeqCst);
            if let Ok(mut g) = app_state(&ev_app).login_window_base.lock() {
                *g = None;
            }
            if !ev_attempt.done.load(Ordering::SeqCst) {
                log(&ev_app, AuthLog::fail("login-window-closed", Some("Fenster ohne Anmeldung geschlossen".into())));
            }
        }
    });

    log(app, AuthLog::ok("login-window-opened", Some(redact_url(&login_url))));

    // Poller: the eCamp SPA moves from /login to /loginCallback or /camps via
    // history.pushState after a password login, which fires no page-load event.
    let poll_app = app.clone();
    tauri::async_runtime::spawn(async move {
        poll(poll_app, attempt).await;
    });

    Ok(())
}

async fn poll<R: Runtime>(app: AppHandle<R>, attempt: Arc<LoginAttempt>) {
    let started = Instant::now();
    loop {
        tokio::time::sleep(POLL_INTERVAL).await;
        if attempt.done.load(Ordering::SeqCst) || attempt.closed.load(Ordering::SeqCst) {
            return;
        }
        if started.elapsed() > POLL_TIMEOUT {
            log(&app, AuthLog::fail("login-poll-timeout", Some("Keine Anmeldung innerhalb von 30 Minuten".into())));
            return;
        }
        let Some(window) = app.get_webview_window(LOGIN_LABEL) else {
            return;
        };
        let w = window.clone();
        let url = match tauri::async_runtime::spawn_blocking(move || w.url()).await {
            Ok(Ok(u)) => u,
            _ => continue,
        };
        if is_post_login_url(&url, &attempt.instance.base) {
            check_cookies(&app, window, &attempt, "poll").await;
        }
    }
}

/// Reads the cookies of the instance host (and API root) from the login
/// webview's cookie store. Always off the main thread.
async fn read_webview_cookies<R: Runtime>(window: WebviewWindow<R>, instance: &Instance) -> Result<Vec<RawCookie>, String> {
    let urls = instance.cookie_urls();
    tauri::async_runtime::spawn_blocking(move || {
        let mut lists = Vec::new();
        for u in urls {
            let cookies = window.cookies_for_url(u).map_err(|e| e.to_string())?;
            lists.push(
                cookies
                    .into_iter()
                    .map(|c| RawCookie::new(c.name(), c.value()))
                    .collect::<Vec<_>>(),
            );
        }
        Ok(dedupe_by_name(lists))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Reads the MiData cookies of the login webview (candidates: default MiData instance and the base
/// URL MidataState knows) and hands a `_session_id` session to `MidataState`. Cookie reads happen on
/// a blocking worker (wry#583). Logs cookie NAMES only; every failure is swallowed.
async fn adopt_midata_session<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>, attempt: &LoginAttempt) {
    let Some(state) = app.try_state::<MidataState>() else { return };
    let mut bases: Vec<String> = vec![DEFAULT_MIDATA_BASE_URL.to_string()];
    if let Some(known) = state.known_base_url().await {
        if !bases.contains(&known) {
            bases.push(known);
        }
    }
    for base in bases {
        let Ok(base_u) = Url::parse(&base) else { continue };
        let w = window.clone();
        let read = tauri::async_runtime::spawn_blocking(move || {
            w.cookies_for_url(base_u)
                .map(|cs| cs.into_iter().map(|c| RawCookie::new(c.name(), c.value())).collect::<Vec<_>>())
                .map_err(|e| e.to_string())
        })
        .await;
        let Ok(Ok(cookies)) = read else { continue };
        if pick_session_cookie(&cookies).is_none() {
            continue;
        }
        let origin = Url::parse(&base).ok().map(|u| u.origin().ascii_serialization());
        let person_id = attempt
            .midata_person
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .filter(|(o, _)| Some(o) == origin.as_ref())
            .map(|(_, id)| id);
        if adopt_session_cookies(app, &state, &base, cookies, person_id).await {
            return;
        }
    }
}

async fn check_cookies<R: Runtime>(app: &AppHandle<R>, window: WebviewWindow<R>, attempt: &LoginAttempt, trigger: &str) {
    if attempt.done.load(Ordering::SeqCst) || attempt.checking.swap(true, Ordering::SeqCst) {
        return;
    }
    let result = read_webview_cookies(window.clone(), &attempt.instance).await;
    let cookies = match result {
        Ok(c) => c,
        Err(e) => {
            log(app, AuthLog::fail("cookies-read", Some(format!("cookies_for_url fehlgeschlagen ({trigger}): {e}"))));
            attempt.checking.store(false, Ordering::SeqCst);
            return;
        }
    };

    let all_names: Vec<String> = cookies.iter().map(|c| c.name.clone()).collect();
    let selected = select_auth_cookies(&cookies, Some(&attempt.instance.info.cookie_prefix));
    let changed = {
        let mut last = attempt.last_names.lock().unwrap_or_else(|p| p.into_inner());
        let changed = last.as_ref() != Some(&all_names);
        *last = Some(all_names.clone());
        changed
    };
    if changed || trigger == "page-load" {
        log(
            app,
            AuthLog {
                step: "cookies-read".into(),
                ok: selected.has_jwt(),
                detail: Some(format!(
                    "{trigger}: {} Cookie(s) für {}: [{}]",
                    all_names.len(),
                    attempt.instance.info.base_url,
                    all_names.join(", ")
                )),
            },
        );
    }

    if !selected.has_jwt() {
        attempt.checking.store(false, Ordering::SeqCst);
        return;
    }

    // Ignore stale/expired tokens (should not happen in incognito, but be safe).
    if let Some(hp) = &selected.jwt_hp {
        match decode_jwt_hp(&hp.value) {
            Ok(claims) if claims.is_expired(now_secs()) => {
                if changed {
                    log(app, AuthLog::fail("cookies-found", Some("JWT ist bereits abgelaufen – warte auf neue Anmeldung".into())));
                }
                attempt.checking.store(false, Ordering::SeqCst);
                return;
            }
            Ok(_) => {}
            Err(e) => {
                log(app, AuthLog::fail("cookies-found", Some(e.to_string())));
                attempt.checking.store(false, Ordering::SeqCst);
                return;
            }
        }
    }
    log(app, AuthLog::ok("cookies-found", Some(selected.names().join(", "))));

    let session = match session_from_webview_cookies(&attempt.instance, &cookies) {
        Ok(s) => s,
        Err(e) => {
            log(app, AuthLog::fail("session-stored", Some(e.to_string())));
            attempt.checking.store(false, Ordering::SeqCst);
            return;
        }
    };

    let state = app_state(app);
    let info = {
        // Same lock as logout: either logout ran before (epoch changed, the
        // attempt is cancelled) or it runs after and clears this session.
        let _guard = state.refresh_lock.lock().await;
        if state.logout_epoch.load(Ordering::SeqCst) != attempt.epoch {
            attempt.done.store(true, Ordering::SeqCst);
            log(app, AuthLog::fail("session-stored", Some("Abmeldung während der Anmeldung – Sitzung verworfen".into())));
            attempt.checking.store(false, Ordering::SeqCst);
            return;
        }
        attempt.done.store(true, Ordering::SeqCst);
        state.store(session).await
    };
    // No user IRI here: the log ends up in the (public) spike report.
    log(
        app,
        AuthLog::ok(
            "session-stored",
            Some(format!(
                "Benutzer {}, gültig bis exp={}, Cookies: {}",
                if info.user_iri.is_some() { "erkannt" } else { "?" },
                info.exp.map_or("?".into(), |e| e.to_string()),
                info.cookie_names.join(", ")
            )),
        ),
    );
    emit_session(app, &info);

    // Same webview, same incognito store: reuse a MiData session so no second login is needed.
    // Best effort; must never fail the eCamp login.
    adopt_midata_session(app, &window, attempt).await;

    // Close promptly so the eCamp SPA in the login window cannot rotate the
    // (single-use) refresh token behind our back.
    let res = tauri::async_runtime::spawn_blocking(move || window.close()).await;
    match res {
        Ok(Ok(())) => log(app, AuthLog::ok("login-window-closed-after-login", None)),
        Ok(Err(e)) => log(app, AuthLog::fail("login-window-closed-after-login", Some(e.to_string()))),
        Err(e) => log(app, AuthLog::fail("login-window-closed-after-login", Some(e.to_string()))),
    }
    attempt.checking.store(false, Ordering::SeqCst);
}
