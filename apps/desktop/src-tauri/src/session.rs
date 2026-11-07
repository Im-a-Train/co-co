//! Managed state: the current eCamp session (reqwest client + cookie jar that
//! hold the auth cookies) and helpers to build/refresh it.
//!
//! Cookie values only ever live in the `Jar`. Everything that leaves this
//! module towards the frontend is a [`SessionInfo`] (names + decoded claims).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use coco_core::cookies::{jar_cookie_string, parse_cookie_header, select_auth_cookies, AuthCookies, RawCookie};
use coco_core::instance::validate_remote_url;
use coco_core::jwt::decode_jwt_hp;
use coco_core::origin::session_origins;
use coco_core::refresh::now_secs;
use coco_core::types::{AuthLog, AuthMethod, InstanceInfo, SessionInfo};
use reqwest::cookie::{CookieStore, Jar};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, CONTENT_TYPE};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::{Mutex, RwLock};
use url::{Origin, Url};

use crate::error::{AppError, AppResult};

pub const MAIN_LABEL: &str = "main";
pub const EVENT_LOG: &str = "auth://log";
pub const EVENT_SESSION: &str = "auth://session";
pub const HAL_JSON: &str = "application/hal+json";
const USER_AGENT: &str = concat!("co-co/", env!("CARGO_PKG_VERSION"), " (+https://github.com/ecamp/ecamp3 client)");
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

/// A discovered eCamp instance with the resolved endpoint URLs.
#[derive(Debug, Clone)]
pub struct Instance {
    pub info: InstanceInfo,
    pub base: Url,
    pub api_root: Url,
    pub login_url: Url,
    pub refresh_url: Url,
}

impl Instance {
    /// Origins an authenticated client may talk to: only the instance origin.
    /// Discovery (`build_instance_info`) rejects API roots on another origin;
    /// this filter keeps that invariant even for hand-built instances.
    pub fn origins(&self) -> Vec<Origin> {
        let base = self.base.origin();
        session_origins(&self.base, &self.api_root).into_iter().filter(|o| *o == base).collect()
    }

    /// URLs at which the auth cookies are looked up: the instance root and, if
    /// it is on the same origin, the API root. Never another host.
    pub fn cookie_urls(&self) -> Vec<Url> {
        let mut v = vec![dir_url(&self.base)];
        let api = dir_url(&self.api_root);
        if api.origin() == self.base.origin() && !v.contains(&api) {
            v.push(api);
        }
        v
    }
}

/// `https://host/api` -> `https://host/api/` (so Path=/ cookies match and joins work).
pub fn dir_url(u: &Url) -> Url {
    let mut u = u.clone();
    if !u.path().ends_with('/') {
        let p = format!("{}/", u.path());
        u.set_path(&p);
    }
    u.set_query(None);
    u.set_fragment(None);
    u
}

/// The live session. Cloning is cheap (the client and jar are reference counted).
#[derive(Clone)]
pub struct Session {
    pub info: SessionInfo,
    pub instance: Instance,
    pub jar: Arc<Jar>,
    pub client: reqwest::Client,
    /// Bumped on every login/refresh, used to avoid double refreshes.
    pub generation: u64,
}

impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("info", &self.info)
            .field("generation", &self.generation)
            .finish_non_exhaustive()
    }
}

pub struct AppState {
    pub session: RwLock<Option<Session>>,
    /// Serializes token refreshes (the refresh token is single-use).
    pub refresh_lock: Mutex<()>,
    pub instances: StdMutex<HashMap<String, Instance>>,
    /// Cookie-less client for discovery.
    pub http: reqwest::Client,
    generation: AtomicU64,
    /// Bumped by `logout` (under `refresh_lock`). A webview login started
    /// under an older epoch must not store its session.
    pub logout_epoch: AtomicU64,
    /// Normalized base URL of the instance the open login window belongs to.
    pub login_window_base: StdMutex<Option<String>>,
}

impl AppState {
    pub fn new() -> AppResult<Self> {
        // Discovery data (environment.js, API root links) is trusted later, so a
        // redirect may only stay on the starting origin and must pass the same
        // https/loopback validation as the initial URL.
        let policy = reqwest::redirect::Policy::custom(|attempt| {
            let start = attempt.previous().first().map(|u| u.origin());
            if attempt.previous().len() >= 5 {
                attempt.error("zu viele Weiterleitungen")
            } else if validate_remote_url(attempt.url()).is_ok() && start.as_ref() == Some(&attempt.url().origin()) {
                attempt.follow()
            } else {
                attempt.error("Weiterleitung auf einen anderen Host ist nicht erlaubt")
            }
        });
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(HTTP_TIMEOUT)
            // http only for loopback: validated for the initial URL by coco_core
            // and for every redirect hop by the policy above.
            .https_only(false)
            .redirect(policy)
            .build()?;
        Ok(Self {
            session: RwLock::new(None),
            refresh_lock: Mutex::new(()),
            instances: StdMutex::new(HashMap::new()),
            http,
            generation: AtomicU64::new(0),
            logout_epoch: AtomicU64::new(0),
            login_window_base: StdMutex::new(None),
        })
    }

    pub fn next_generation(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub async fn current(&self) -> Option<Session> {
        self.session.read().await.clone()
    }

    pub async fn store(&self, mut session: Session) -> SessionInfo {
        session.generation = self.next_generation();
        let info = session.info.clone();
        *self.session.write().await = Some(session);
        info
    }

    pub async fn clear(&self) {
        *self.session.write().await = None;
    }
}

/// Reads a response body into memory, failing once it exceeds `cap` bytes
/// (protects against hostile/misconfigured instances sending huge bodies).
pub async fn read_body_capped(mut resp: reqwest::Response, cap: usize) -> AppResult<Vec<u8>> {
    let too_large = || AppError::Unexpected(format!("Antwort zu gross (mehr als {} KB)", cap / 1024));
    if resp.content_length().is_some_and(|len| len > cap as u64) {
        return Err(too_large());
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await? {
        if body.len() + chunk.len() > cap {
            return Err(too_large());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Fails unless the final response URL (after redirects) is on `expected`'s origin.
pub fn ensure_same_origin(resp: &reqwest::Response, expected: &Url) -> AppResult<()> {
    if resp.url().origin() == expected.origin() {
        Ok(())
    } else {
        Err(AppError::Core(coco_core::CoreError::ForeignOrigin(resp.url().origin().ascii_serialization())))
    }
}

/// Default headers for eCamp API calls.
fn api_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(ACCEPT, HeaderValue::from_static(HAL_JSON));
    h
}

/// Builds the authenticated client for `instance` around `jar`. Redirects are
/// only followed within the session origins so cookies/requests stay on eCamp.
pub fn build_client(instance: &Instance, jar: Arc<Jar>) -> AppResult<reqwest::Client> {
    let origins = instance.origins();
    let policy = reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= 5 {
            attempt.error("zu viele Weiterleitungen")
        } else if origins.contains(&attempt.url().origin()) {
            attempt.follow()
        } else {
            attempt.stop()
        }
    });
    Ok(reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(HTTP_TIMEOUT)
        .default_headers(api_headers())
        .cookie_provider(jar)
        .redirect(policy)
        .build()?)
}

/// All cookies the jar would send to the instance (host + API root), deduped by name.
pub fn jar_cookies(jar: &Jar, instance: &Instance) -> Vec<RawCookie> {
    let lists = instance.cookie_urls().into_iter().map(|u| {
        jar.cookies(&u)
            .and_then(|h| h.to_str().ok().map(parse_cookie_header))
            .unwrap_or_default()
    });
    coco_core::cookies::dedupe_by_name(lists)
}

/// Reads the auth cookies from `jar` and turns them into a [`Session`].
pub fn session_from_jar(instance: &Instance, jar: Arc<Jar>, method: AuthMethod) -> AppResult<Session> {
    let cookies = jar_cookies(&jar, instance);
    let selected = select_auth_cookies(&cookies, Some(&instance.info.cookie_prefix));
    session_from_selected(instance, jar, &selected, method)
}

fn session_from_selected(
    instance: &Instance,
    jar: Arc<Jar>,
    selected: &AuthCookies,
    method: AuthMethod,
) -> AppResult<Session> {
    let hp = match (&selected.jwt_hp, &selected.jwt_s) {
        (Some(hp), Some(_)) => hp,
        _ => {
            let names = selected.names();
            return Err(AppError::MissingCookies(if names.is_empty() {
                "keine".into()
            } else {
                format!("nur: {}", names.join(", "))
            }));
        }
    };
    let claims = decode_jwt_hp(&hp.value)?;
    let client = build_client(instance, jar.clone())?;
    let info = SessionInfo::new(&instance.info, method, &claims, selected.names(), now_secs());
    Ok(Session { info, instance: instance.clone(), jar, client, generation: 0 })
}

/// Creates a fresh jar holding only the eCamp auth cookies taken from the
/// login webview (read on the instance host), and builds a session from it.
/// Each cookie is stored host-only for the instance host it was read from,
/// so it is never sent to any other host.
pub fn session_from_webview_cookies(instance: &Instance, cookies: &[RawCookie]) -> AppResult<Session> {
    let selected = select_auth_cookies(cookies, Some(&instance.info.cookie_prefix));
    let jar = Arc::new(Jar::default());
    let host_url = dir_url(&instance.base);
    for c in selected.all() {
        jar.add_cookie_str(&jar_cookie_string(c, &host_url), &host_url);
    }
    // Verify the jar actually accepted them (add_cookie_str ignores invalid input).
    let session = session_from_jar(instance, jar, AuthMethod::Webview)?;
    Ok(session)
}

/// POSTs to the refresh endpoint with the session's jar (which rotates the
/// single-use refresh token) and returns the updated session.
/// Caller must hold `AppState::refresh_lock`.
pub async fn refresh_locked<R: Runtime>(app: &AppHandle<R>, state: &AppState, current: Session) -> AppResult<SessionInfo> {
    let cookies = jar_cookies(&current.jar, &current.instance);
    let selected = select_auth_cookies(&cookies, Some(&current.instance.info.cookie_prefix));
    if selected.refresh_token.is_none() {
        let err = AppError::Refresh("kein refresh_token-Cookie vorhanden".into());
        log(app, AuthLog::fail("refresh", Some(err.to_string())));
        return Err(err);
    }
    log(app, AuthLog::ok("refresh-start", Some(format!("POST {}", current.instance.refresh_url.path()))));
    let resp = current
        .client
        .post(current.instance.refresh_url.clone())
        .header(CONTENT_TYPE, "application/json")
        .body("{}")
        .send()
        .await;
    let resp = match resp {
        Ok(r) => r,
        Err(e) => {
            let err = AppError::from(e);
            log(app, AuthLog::fail("refresh", Some(err.to_string())));
            return Err(err);
        }
    };
    let status = resp.status();
    if !status.is_success() {
        let err = AppError::Refresh(format!("HTTP {}", status.as_u16()));
        log(app, AuthLog::fail("refresh", Some(err.to_string())));
        return Err(err);
    }
    let mut refreshed = match session_from_jar(&current.instance, current.jar.clone(), current.info.method) {
        Ok(s) => s,
        Err(e) => {
            log(app, AuthLog::fail("refresh", Some(e.to_string())));
            return Err(e);
        }
    };
    // keep the same client (same jar) so in-flight requests stay valid
    refreshed.client = current.client.clone();

    let mut guard = state.session.write().await;
    match guard.as_ref() {
        Some(s) if Arc::ptr_eq(&s.jar, &current.jar) => {
            refreshed.generation = state.next_generation();
            let info = refreshed.info.clone();
            *guard = Some(refreshed);
            drop(guard);
            log(
                app,
                AuthLog::ok(
                    "refresh",
                    Some(format!("neues Ablaufdatum exp={}", info.exp.map_or("?".into(), |e| e.to_string()))),
                ),
            );
            emit_session(app, &info);
            Ok(info)
        }
        _ => {
            drop(guard);
            log(app, AuthLog::fail("refresh", Some("Sitzung wurde während der Erneuerung beendet".into())));
            Err(AppError::NotLoggedIn)
        }
    }
}

/// Emits an `auth://log` event to the main window only.
pub fn log<R: Runtime>(app: &AppHandle<R>, entry: AuthLog) {
    let _ = app.emit_to(MAIN_LABEL, EVENT_LOG, entry);
}

/// Emits `auth://session` to the main window only.
pub fn emit_session<R: Runtime>(app: &AppHandle<R>, info: &SessionInfo) {
    let _ = app.emit_to(MAIN_LABEL, EVENT_SESSION, info.clone());
}

/// Rejects commands invoked from any webview other than the main window
/// (defense in depth: the remote login window has no IPC access anyway).
pub fn ensure_main<R: Runtime>(webview: &tauri::Webview<R>) -> AppResult<()> {
    if webview.label() == MAIN_LABEL {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// Convenience accessor used by background tasks.
pub fn app_state<R: Runtime>(app: &AppHandle<R>) -> tauri::State<'_, AppState> {
    app.state::<AppState>()
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;

    fn instance(base: &str, api: &str) -> Instance {
        let base_u = Url::parse(base).unwrap();
        let api_u = Url::parse(api).unwrap();
        Instance {
            info: InstanceInfo {
                base_url: base.trim_end_matches('/').into(),
                api_root: api.trim_end_matches('/').into(),
                cookie_prefix: "app_ecamp3_ch_".into(),
                feature_comments: true,
                version: None,
                oauth_providers: vec![],
            },
            login_url: api_u.join("/api/authentication_token").unwrap(),
            refresh_url: api_u.join("/api/token/refresh").unwrap(),
            base: base_u,
            api_root: api_u,
        }
    }

    fn hp() -> String {
        format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(r#"{"alg":"RS256"}"#),
            URL_SAFE_NO_PAD.encode(r#"{"exp":4102444800,"user":"/api/users/u1","roles":["ROLE_USER"]}"#)
        )
    }

    #[test]
    fn dir_url_appends_slash() {
        assert_eq!(dir_url(&Url::parse("https://a.ch/api").unwrap()).as_str(), "https://a.ch/api/");
        assert_eq!(dir_url(&Url::parse("https://a.ch").unwrap()).as_str(), "https://a.ch/");
        assert_eq!(dir_url(&Url::parse("https://a.ch/api/?x#y").unwrap()).as_str(), "https://a.ch/api/");
    }

    #[test]
    fn webview_cookies_end_up_in_jar_and_session_info() {
        let inst = instance("https://app.ecamp3.ch", "https://app.ecamp3.ch/api");
        let cookies = vec![
            RawCookie::new("app_ecamp3_ch_jwt_hp", hp()),
            RawCookie::new("app_ecamp3_ch_jwt_s", "SIGNATURE_SECRET"),
            RawCookie::new("app_ecamp3_ch_refresh_token", "REFRESH_SECRET"),
            RawCookie::new("_ga", "tracking"),
        ];
        let s = session_from_webview_cookies(&inst, &cookies).unwrap();
        assert_eq!(s.info.method, AuthMethod::Webview);
        assert_eq!(s.info.user_iri.as_deref(), Some("/api/users/u1"));
        assert_eq!(s.info.exp, Some(4_102_444_800));
        assert_eq!(s.info.roles, vec!["ROLE_USER"]);
        assert_eq!(
            s.info.cookie_names,
            vec!["app_ecamp3_ch_jwt_hp", "app_ecamp3_ch_jwt_s", "app_ecamp3_ch_refresh_token"]
        );
        // non-auth cookies are not copied
        let in_jar = jar_cookies(&s.jar, &inst);
        assert!(in_jar.iter().all(|c| c.name != "_ga"));
        // the jar sends them to the API
        let header = s.jar.cookies(&Url::parse("https://app.ecamp3.ch/api/camps").unwrap()).unwrap();
        let header = header.to_str().unwrap();
        assert!(header.contains("app_ecamp3_ch_jwt_s=SIGNATURE_SECRET"));
        // but never to other hosts or over http
        assert!(s.jar.cookies(&Url::parse("https://evil.example/api").unwrap()).is_none());
        assert!(s.jar.cookies(&Url::parse("http://app.ecamp3.ch/api").unwrap()).is_none());
        // SessionInfo never contains values
        let json = serde_json::to_string(&s.info).unwrap();
        assert!(!json.contains("SECRET"));
        assert!(!format!("{s:?}").contains("SECRET"));
    }

    #[test]
    fn missing_signature_cookie_is_an_error_naming_only_names() {
        let inst = instance("https://app.ecamp3.ch", "https://app.ecamp3.ch/api");
        let err = session_from_webview_cookies(&inst, &[RawCookie::new("app_ecamp3_ch_jwt_hp", hp())]).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("app_ecamp3_ch_jwt_hp"));
        assert!(!msg.contains(&hp()));
    }

    #[test]
    fn suffix_match_when_prefix_differs() {
        let inst = instance("https://app.ecamp3.ch", "https://app.ecamp3.ch/api");
        let cookies = vec![RawCookie::new("custom_jwt_hp", hp()), RawCookie::new("custom_jwt_s", "s")];
        let s = session_from_webview_cookies(&inst, &cookies).unwrap();
        assert_eq!(s.info.cookie_names, vec!["custom_jwt_hp", "custom_jwt_s"]);
    }

    #[test]
    fn cookies_read_on_instance_host_never_reach_another_host() {
        // Discovery rejects this, but even a hand-built instance with a foreign
        // API root must not leak the auth cookies to that host.
        let inst = instance("https://ecamp.example.ch", "https://api.example.ch/api");
        let cookies = vec![
            RawCookie::new("x_jwt_hp", hp()),
            RawCookie::new("x_jwt_s", "SIGNATURE_SECRET"),
            RawCookie::new("x_refresh_token", "REFRESH_SECRET"),
        ];
        let s = session_from_webview_cookies(&inst, &cookies).unwrap();
        assert!(s.jar.cookies(&Url::parse("https://ecamp.example.ch/api/camps").unwrap()).is_some());
        assert!(s.jar.cookies(&Url::parse("https://api.example.ch/api/camps").unwrap()).is_none());
        assert_eq!(inst.origins(), vec![Url::parse("https://ecamp.example.ch").unwrap().origin()]);
        assert_eq!(inst.cookie_urls(), vec![Url::parse("https://ecamp.example.ch/").unwrap()]);
    }

    #[test]
    fn refreshed_cookies_win_over_imported_ones() {
        let inst = instance("https://app.ecamp3.ch", "https://app.ecamp3.ch/api");
        let cookies = vec![RawCookie::new("app_ecamp3_ch_jwt_hp", hp()), RawCookie::new("app_ecamp3_ch_jwt_s", "s")];
        let s = session_from_webview_cookies(&inst, &cookies).unwrap();
        // simulate the Set-Cookie of POST /api/token/refresh (host-only, Path=/)
        let new_hp = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(r#"{"alg":"RS256"}"#),
            URL_SAFE_NO_PAD.encode(r#"{"exp":4102448400,"user":"/api/users/u1","roles":[]}"#)
        );
        let refresh_url = Url::parse("https://app.ecamp3.ch/api/token/refresh").unwrap();
        s.jar.add_cookie_str(&format!("app_ecamp3_ch_jwt_hp={new_hp}; Path=/; Secure; SameSite=Strict"), &refresh_url);
        let again = session_from_jar(&inst, s.jar.clone(), AuthMethod::Webview).unwrap();
        assert_eq!(again.info.exp, Some(4_102_448_400));
    }

    #[test]
    fn localhost_http_cookies_work() {
        let inst = instance("http://localhost:3000", "http://localhost:3000/api");
        let cookies = vec![RawCookie::new("localhost_jwt_hp", hp()), RawCookie::new("localhost_jwt_s", "s")];
        let s = session_from_webview_cookies(&inst, &cookies).unwrap();
        assert!(s.jar.cookies(&Url::parse("http://localhost:3000/api/camps").unwrap()).is_some());
    }
}
