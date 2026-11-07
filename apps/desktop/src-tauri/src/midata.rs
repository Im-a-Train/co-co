//! MiData connection (M7, red zone, read-only).
//!
//! Own HTTP client + cookie jar (separate from eCamp), own login window
//! (`midata-login`, no capability / no IPC), service token in the OS keychain.
//! Raw responses are reduced in `coco_core::midata`; only aggregates, event
//! summaries, probe results (names + status codes) and status cross to the UI.
//! Refreshed only on explicit user request, never in the background.
//!
//! The HTTP logic lives in plain async functions taking `&MidataState`
//! (`find_events_impl`, `fetch_aggregate_impl`, `probe_impl`) so the ignored
//! live test can call it without a Webview.
//!
//! Secrets: cookie values and the token are never logged, serialized or put
//! into error messages. Raw JSON documents are dropped at the end of each
//! function and never logged.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use coco_core::cookies::{jar_cookie_string, RawCookie};
use coco_core::midata::{
    leader_person_ids, next_link, normalize_midata_base_url, parse_event_list_filtered, rank_events, probe_classic_fields, reduce_aggregate,
    MidataAggregate, MidataEventSummary, MidataProbe, MidataStatus, RawEventData, JSONAPI_ACCEPT, SESSION_COOKIE,
};
use coco_core::types::AuthLog;
use coco_core::CoreError;
use reqwest::cookie::Jar;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Webview, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::RwLock;
use url::Url;

use crate::error::{AppError, AppResult};
use crate::session::{ensure_main, log, read_body_capped, MAIN_LABEL};

/// Label of the MiData login window (no capability).
pub const MIDATA_LOGIN_LABEL: &str = "midata-login";
/// Event emitted to "main" with a `MidataStatus` payload after login/logout.
pub const EVENT_MIDATA_STATUS: &str = "midata://status";

const LOGIN_TITLE: &str = "MiData Anmeldung";
const POLL_INTERVAL: Duration = Duration::from_millis(1000);
const POLL_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const USER_AGENT: &str = concat!("co-co/", env!("CARGO_PKG_VERSION"), " (MiData read-only client)");
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_BODY: usize = 8 * 1024 * 1024;
const MAX_PAGES: usize = 50;
const PAGE_SIZE: u32 = 100;
const QUAL_CHUNK: usize = 20;
const KEYCHAIN_SERVICE: &str = "co-co-midata";
/// Keychain user of the non-secret pointer to the last connected base URL.
const KEYCHAIN_POINTER_USER: &str = "@last-base-url";
const MAX_TOKEN_LEN: usize = 200;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Method {
    Session,
    Token,
}

impl Method {
    fn as_str(self) -> &'static str {
        match self {
            Method::Session => "session",
            Method::Token => "token",
        }
    }
}

/// Current connection. Deliberately no `Debug`/`Serialize` (holds the token).
struct Connection {
    base_url: String,
    method: Method,
    cookie_names: Vec<String>,
    token: Option<String>,
}

struct Inner {
    client: reqwest::Client,
    jar: Arc<Jar>,
    conn: Option<Connection>,
}

/// Managed state of the MiData connection.
pub struct MidataState {
    inner: RwLock<Inner>,
    /// Bumped by logout/login so a stale login window cannot store cookies.
    epoch: AtomicU64,
}

/// Everything needed for requests; cheap to clone, no secrets in `Debug`.
struct Ctx {
    client: reqwest::Client,
    base: Url,
    token: Option<String>,
    method: Method,
}

fn build_client(jar: Arc<Jar>) -> AppResult<reqwest::Client> {
    // Redirects only within the starting origin; anything else is not followed.
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        let start = attempt.previous().first().map(|u| u.origin());
        if attempt.previous().len() >= 5 {
            attempt.error("zu viele Weiterleitungen")
        } else if start.as_ref() == Some(&attempt.url().origin()) {
            attempt.follow()
        } else {
            attempt.stop()
        }
    });
    Ok(reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(HTTP_TIMEOUT)
        .https_only(false) // http only for loopback hosts, enforced by normalize_midata_base_url
        .cookie_provider(jar)
        .redirect(policy)
        .build()?)
}

impl MidataState {
    pub fn new() -> AppResult<Self> {
        let jar = Arc::new(Jar::default());
        Ok(Self {
            inner: RwLock::new(Inner { client: build_client(jar.clone())?, jar, conn: None }),
            epoch: AtomicU64::new(0),
        })
    }

    /// In-memory token connection without keychain (live tests).
    #[cfg(test)]
    pub fn for_test(base_url: &str, token: &str) -> AppResult<Self> {
        let st = Self::new()?;
        let base = normalize_midata_base_url(base_url)?;
        tauri::async_runtime::block_on(async {
            st.inner.write().await.conn = Some(Connection {
                base_url: base,
                method: Method::Token,
                cookie_names: vec![],
                token: Some(token.to_string()),
            });
        });
        Ok(st)
    }

    async fn status(&self) -> MidataStatus {
        let g = self.inner.read().await;
        status_of(g.conn.as_ref())
    }

    /// Loads the token connection from the keychain when nothing is connected yet.
    async fn lazy_load(&self) {
        if self.inner.read().await.conn.is_some() {
            return;
        }
        let loaded = tauri::async_runtime::spawn_blocking(keychain_load).await.ok().flatten();
        if let Some((base, token)) = loaded {
            let mut g = self.inner.write().await;
            if g.conn.is_none() {
                g.conn = Some(Connection { base_url: base, method: Method::Token, cookie_names: vec![], token: Some(token) });
            }
        }
    }

    async fn ctx(&self) -> AppResult<Ctx> {
        self.lazy_load().await;
        let g = self.inner.read().await;
        let conn = g.conn.as_ref().ok_or(AppError::NotLoggedIn)?;
        let base = Url::parse(&conn.base_url).map_err(|e| AppError::Core(CoreError::InvalidUrl(e.to_string())))?;
        Ok(Ctx { client: g.client.clone(), base, token: conn.token.clone(), method: conn.method })
    }
}

fn status_of(conn: Option<&Connection>) -> MidataStatus {
    match conn {
        Some(c) => MidataStatus {
            connected: true,
            base_url: Some(c.base_url.clone()),
            method: Some(c.method.as_str().into()),
            cookie_names: c.cookie_names.clone(),
        },
        None => MidataStatus { connected: false, base_url: None, method: None, cookie_names: vec![] },
    }
}

fn emit_status<R: Runtime>(app: &AppHandle<R>, status: &MidataStatus) {
    let _ = app.emit_to(MAIN_LABEL, EVENT_MIDATA_STATUS, status.clone());
}

// ---------------------------------------------------------------- keychain

fn keychain_err(e: keyring::Error) -> AppError {
    // keyring errors do not contain the secret
    AppError::Unexpected(format!("Schlüsselbund nicht verfügbar: {e}"))
}

fn keychain_store(base: &str, token: &str) -> AppResult<()> {
    keyring::Entry::new(KEYCHAIN_SERVICE, base).and_then(|e| e.set_password(token)).map_err(keychain_err)?;
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_POINTER_USER)
        .and_then(|e| e.set_password(base))
        .map_err(keychain_err)
}

fn keychain_load() -> Option<(String, String)> {
    let base = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_POINTER_USER).ok()?.get_password().ok()?;
    let token = keyring::Entry::new(KEYCHAIN_SERVICE, &base).ok()?.get_password().ok()?;
    Some((base, token))
}

fn keychain_delete(base: Option<String>) -> AppResult<()> {
    let base = base.or_else(|| {
        keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_POINTER_USER).ok().and_then(|e| e.get_password().ok())
    });
    let mut result = Ok(());
    if let Some(b) = base {
        match keyring::Entry::new(KEYCHAIN_SERVICE, &b).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => result = Err(keychain_err(e)),
        }
    }
    match keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_POINTER_USER).and_then(|e| e.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => result = result.and(Err(keychain_err(e))),
    }
    result
}

// ------------------------------------------------------- pure URL helpers

fn invalid(msg: &str) -> AppError {
    AppError::Core(CoreError::Invalid(msg.into()))
}

/// `YYYY-MM-DD` with plausible month/day.
fn validate_date(s: &str) -> AppResult<()> {
    let b = s.as_bytes();
    let ok = b.len() == 10
        && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
        && matches!(s[5..7].parse::<u32>(), Ok(1..=12))
        && matches!(s[8..10].parse::<u32>(), Ok(1..=31));
    if ok {
        Ok(())
    } else {
        Err(invalid("Datum muss das Format JJJJ-MM-TT haben"))
    }
}

/// `[A-Za-z0-9_-]{1,40}`
fn validate_id(s: &str) -> AppResult<()> {
    if (1..=40).contains(&s.len()) && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-') {
        Ok(())
    } else {
        Err(invalid("Ungültige MiData-ID"))
    }
}

/// Joins a path-and-query onto the base; refuses anything leaving the origin.
fn api_url(base: &Url, path_and_query: &str) -> AppResult<Url> {
    let url = base
        .join(path_and_query.trim_start_matches('/'))
        .map_err(|e| AppError::Core(CoreError::InvalidUrl(e.to_string())))?;
    if url.origin() != base.origin() {
        return Err(AppError::Core(CoreError::ForeignOrigin(url.origin().ascii_serialization())));
    }
    Ok(url)
}

fn same_origin(base: &Url, other: &Url) -> bool {
    base.origin() == other.origin()
}

// All MiData query strings are built here. NOTE: filter syntax unverified – M7-0.
// (Graphiti style `filter[x]=..` / `filter[x][eq]=..`; resolved by the live probe.)

/// filter syntax unverified – M7-0
fn events_path(from: &str, to: &str, with_dates: bool, with_type: bool) -> String {
    let mut q = String::from("/api/events?");
    if with_type {
        q.push_str("filter[type][eq]=Event::Camp&");
    }
    if with_dates {
        q.push_str(&format!("filter[after_or_on]={from}&filter[before_or_on]={to}&"));
    }
    q.push_str(&format!("include=dates,groups&page[size]={PAGE_SIZE}"));
    q
}

/// filter syntax unverified – M7-0
fn event_path(id: &str) -> String {
    format!("/api/events/{id}?include=dates")
}

/// filter syntax unverified – M7-0
fn participations_path(id: &str) -> String {
    format!(
        "/api/event_participations?filter[event_id]={id}&include=person,roles&fields[people]=nickname,first_name,birthday&page[size]={PAGE_SIZE}"
    )
}

/// filter syntax unverified – M7-0
fn qualifications_path(person_ids: &[String]) -> String {
    format!(
        "/api/qualifications?filter[person_id]={}&include=qualification_kind&page[size]={PAGE_SIZE}",
        person_ids.join(",")
    )
}

fn token_check_path() -> &'static str {
    "/api/events?page[size]=1"
}

fn classic_path(group_id: &str, event_id: &str) -> String {
    format!("/groups/{group_id}/events/{event_id}.json")
}

/// RFC 3339 UTC timestamp from unix seconds (no chrono).
fn rfc3339_from_unix(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let mut y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    if m <= 2 {
        y += 1;
    }
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

fn now_rfc3339() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    rfc3339_from_unix(secs)
}

// ------------------------------------------------------------------- HTTP

struct Fetched {
    status: u16,
    /// Parsed JSON, only for 2xx responses with a JSON body.
    body: Option<Value>,
}

fn status_error(status: u16) -> AppError {
    match status {
        401 | 403 => AppError::Unexpected(format!(
            "MiData: nicht angemeldet oder keine Berechtigung (HTTP {status})"
        )),
        _ => AppError::Unexpected(format!("MiData antwortete mit HTTP {status}")),
    }
}

async fn fetch(ctx: &Ctx, url: Url, accept: &'static str) -> AppResult<Fetched> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static(accept));
    if let Some(t) = &ctx.token {
        if ctx.method == Method::Token {
            let mut v = HeaderValue::from_str(t).map_err(|_| invalid("Token enthält ungültige Zeichen"))?;
            v.set_sensitive(true);
            headers.insert("X-TOKEN", v);
        }
    }
    let resp = ctx.client.get(url).headers(headers).send().await?;
    if !same_origin(&ctx.base, resp.url()) {
        return Err(AppError::Core(CoreError::ForeignOrigin(resp.url().origin().ascii_serialization())));
    }
    let mut status = resp.status().as_u16();
    // hitobito answers an expired session with a redirect to the sign-in page (HTML, 200).
    if resp.url().path().contains("/users/sign_in") {
        status = 401;
    }
    if !(200..300).contains(&status) {
        return Ok(Fetched { status, body: None });
    }
    let bytes = read_body_capped(resp, MAX_BODY).await?;
    Ok(Fetched { status, body: serde_json::from_slice(&bytes).ok() })
}

async fn get_json(ctx: &Ctx, url: Url) -> AppResult<Value> {
    let f = fetch(ctx, url, JSONAPI_ACCEPT).await?;
    if !(200..300).contains(&f.status) {
        return Err(status_error(f.status));
    }
    f.body.ok_or_else(|| AppError::Http("Antwort nicht lesbar (kein JSON)".into()))
}

/// True when the document holds a full page (`PAGE_SIZE` items), i.e. more data may follow.
fn full_page(doc: &Value) -> bool {
    doc.get("data").and_then(Value::as_array).is_some_and(|d| d.len() >= PAGE_SIZE as usize)
}

/// `url` with `page[number]` set to `n` (query building lives here, next to the other paths).
fn with_page_number(url: &Url, n: usize) -> Url {
    let kept: Vec<(String, String)> =
        url.query_pairs().filter(|(k, _)| k != "page[number]").map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    let mut out = url.clone();
    {
        let mut q = out.query_pairs_mut();
        q.clear();
        for (k, v) in &kept {
            q.append_pair(k, v);
        }
        q.append_pair("page[number]", &n.to_string());
    }
    out
}

/// Resolves a `links.next` value (MiData sends relative URLs) against the current page URL and
/// refuses anything leaving the origin.
fn resolve_next(base: &Url, current: &Url, next: &str) -> AppResult<Url> {
    let url = current.join(next).map_err(|e| AppError::Core(CoreError::InvalidUrl(e.to_string())))?;
    if !same_origin(base, &url) {
        return Err(AppError::Core(CoreError::ForeignOrigin(url.origin().ascii_serialization())));
    }
    Ok(url)
}

/// All pages of a collection, following `links.next` (same origin only, max 50 pages).
async fn get_pages(ctx: &Ctx, first: Url) -> AppResult<Vec<Value>> {
    match get_pages_status(ctx, first).await? {
        Ok(pages) => Ok(pages),
        Err(status) => Err(status_error(status)),
    }
}

/// Like `get_pages`, but a non-2xx answer is returned as `Ok(Err(status))` so callers can retry.
async fn get_pages_status(ctx: &Ctx, first: Url) -> AppResult<Result<Vec<Value>, u16>> {
    let mut pages = Vec::new();
    let mut url = first;
    for number in 1..=MAX_PAGES {
        let f = fetch(ctx, url.clone(), JSONAPI_ACCEPT).await?;
        if !(200..300).contains(&f.status) {
            return Ok(Err(f.status));
        }
        let doc = f.body.ok_or_else(|| AppError::Http("Antwort nicht lesbar (kein JSON)".into()))?;
        let next = next_link(&doc);
        let full = full_page(&doc);
        pages.push(doc);
        match next {
            None if full => {
                // Graphiti only renders pagination links when enabled; a full page without a next link may be
                // followed by more data, so ask for page[number]+1 (unverified, M7-0) until a short page.
                url = with_page_number(&url, number + 1);
            }
            None => return Ok(Ok(pages)),
            Some(n) => {
                url = resolve_next(&ctx.base, &url, &n)?;
            }
        }
    }
    Err(AppError::Unexpected(format!("MiData: mehr als {MAX_PAGES} Seiten – abgebrochen")))
}

/// Camp search over all organisations visible to the account. The hitobito filter syntax is
/// unverified (M7-0), so on HTTP 400 the request is retried without the date filters and then
/// without the type filter; the result is always filtered and ranked client-side.
pub async fn find_events_impl(
    state: &MidataState,
    from: &str,
    to: &str,
    camp_start: Option<&str>,
    camp_end: Option<&str>,
) -> AppResult<Vec<MidataEventSummary>> {
    validate_date(from)?;
    validate_date(to)?;
    for d in [camp_start, camp_end].into_iter().flatten() {
        validate_date(d)?;
    }
    let ctx = state.ctx().await?;
    let attempts = [(true, true), (false, true), (false, false)];
    for (with_dates, with_type) in attempts {
        match get_pages_status(&ctx, api_url(&ctx.base, &events_path(from, to, with_dates, with_type))?).await? {
            Ok(pages) => {
                let mut out = Vec::new();
                for p in &pages {
                    out.extend(parse_event_list_filtered(p, !with_type)?);
                }
                return Ok(rank_events(out, from, to, camp_start, camp_end));
            }
            Err(400) => {}
            Err(status) => return Err(status_error(status)),
        }
    }
    Err(status_error(400))
}

pub async fn fetch_aggregate_impl(
    state: &MidataState,
    event_id: &str,
    camp_start: &str,
    camp_end: &str,
    coach_person_id: Option<&str>,
) -> AppResult<MidataAggregate> {
    validate_id(event_id)?;
    validate_date(camp_start)?;
    validate_date(camp_end)?;
    if let Some(c) = coach_person_id {
        validate_id(c)?;
    }
    let ctx = state.ctx().await?;
    let event = get_json(&ctx, api_url(&ctx.base, &event_path(event_id))?).await?;
    let participations = get_pages(&ctx, api_url(&ctx.base, &participations_path(event_id))?).await?;
    let leaders = leader_person_ids(&participations);
    let mut qualifications = Vec::new();
    for chunk in leaders.chunks(QUAL_CHUNK) {
        qualifications.extend(get_pages(&ctx, api_url(&ctx.base, &qualifications_path(chunk))?).await?);
    }
    let fetched_at = now_rfc3339();
    let aggregate = reduce_aggregate(&RawEventData {
        base_url: ctx.base.as_str().trim_end_matches('/'),
        event: &event,
        participation_pages: &participations,
        qualification_pages: &qualifications,
        camp_start,
        camp_end,
        coach_person_id,
        fetched_at: &fetched_at,
    })?;
    Ok(aggregate)
}

fn any_birthday(doc: &Value) -> bool {
    doc.get("included")
        .and_then(Value::as_array)
        .is_some_and(|inc| {
            inc.iter().any(|i| {
                i.get("type").and_then(Value::as_str) == Some("people")
                    && i.pointer("/attributes/birthday").is_some_and(|b| !b.is_null())
            })
        })
}

pub async fn probe_impl(state: &MidataState, event_id: &str, group_id: Option<&str>) -> AppResult<MidataProbe> {
    validate_id(event_id)?;
    if let Some(g) = group_id {
        validate_id(g)?;
    }
    let ctx = state.ctx().await?;
    let event = fetch(&ctx, api_url(&ctx.base, &event_path(event_id))?, JSONAPI_ACCEPT).await?;
    let parts = fetch(&ctx, api_url(&ctx.base, &participations_path(event_id))?, JSONAPI_ACCEPT).await?;
    let participations_readable = (200..300).contains(&parts.status) && parts.body.is_some();
    let people_birthday_readable = parts.body.as_ref().is_some_and(any_birthday);
    let leader_ids: Vec<String> = match &parts.body {
        Some(b) => leader_person_ids(std::slice::from_ref(b)).into_iter().take(QUAL_CHUNK).collect(),
        None => vec![],
    };
    let qualifications_status = if leader_ids.is_empty() {
        0
    } else {
        fetch(&ctx, api_url(&ctx.base, &qualifications_path(&leader_ids))?, JSONAPI_ACCEPT).await?.status
    };
    let (classic_json_status, pbs_fields_present, classic_attribute_names) = match group_id {
        Some(g) => {
            let f = fetch(&ctx, api_url(&ctx.base, &classic_path(g, event_id))?, "application/json").await?;
            let (pbs, attrs) = f.body.as_ref().map(probe_classic_fields).unwrap_or_default();
            (Some(f.status), pbs, attrs)
        }
        None => (None, vec![], vec![]),
    };
    Ok(MidataProbe {
        auth_method: Some(ctx.method.as_str().into()),
        event_status: event.status,
        participations_status: parts.status,
        participations_readable,
        people_birthday_readable,
        qualifications_status,
        classic_json_status,
        pbs_fields_present,
        classic_attribute_names,
    })
}

// --------------------------------------------------------------- commands

#[tauri::command]
pub async fn midata_status<R: Runtime>(webview: Webview<R>, state: State<'_, MidataState>) -> AppResult<MidataStatus> {
    ensure_main(&webview)?;
    state.lazy_load().await;
    Ok(state.status().await)
}

#[tauri::command]
pub async fn midata_open_login<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, MidataState>,
    base_url: String,
) -> AppResult<()> {
    ensure_main(&webview)?;
    let base = normalize_midata_base_url(&base_url)?;
    if let Some(existing) = app.get_webview_window(MIDATA_LOGIN_LABEL) {
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }
    let base_u = Url::parse(&base).map_err(|e| AppError::Core(CoreError::InvalidUrl(e.to_string())))?;
    let login_url = api_url(&base_u, "/users/sign_in")?;
    let epoch = state.epoch.fetch_add(1, Ordering::SeqCst) + 1;

    let nav_base = base_u.clone();
    let window = WebviewWindowBuilder::new(&app, MIDATA_LOGIN_LABEL, WebviewUrl::External(login_url))
        .title(LOGIN_TITLE)
        .inner_size(520.0, 760.0)
        .min_inner_size(380.0, 480.0)
        .center()
        .focused(true)
        .incognito(true)
        // Main thread: no cookie access here. Only the MiData origin is allowed.
        .on_navigation(move |url| url.as_str() == "about:blank" || same_origin(&nav_base, url))
        .build()?;
    // No window-event hook needed: the poller notices a closed window.
    drop(window);

    log(&app, AuthLog::ok("midata-login-window-opened", None));
    let poll_app = app.clone();
    tauri::async_runtime::spawn(async move {
        poll_login(poll_app, base_u, epoch).await;
    });
    Ok(())
}

/// Polls until a `_session_id` cookie exists AND the window left the sign-in pages.
async fn poll_login<R: Runtime>(app: AppHandle<R>, base: Url, epoch: u64) {
    let started = Instant::now();
    let mut last_names: Option<Vec<String>> = None;
    loop {
        tokio::time::sleep(POLL_INTERVAL).await;
        let state = app.state::<MidataState>();
        if state.epoch.load(Ordering::SeqCst) != epoch {
            return;
        }
        if started.elapsed() > POLL_TIMEOUT {
            log(&app, AuthLog::fail("midata-login-timeout", Some("Keine Anmeldung innerhalb von 30 Minuten".into())));
            return;
        }
        let Some(window) = app.get_webview_window(MIDATA_LOGIN_LABEL) else {
            return;
        };
        // Windows: cookies_for_url / url() must not run on the main thread (wry#583).
        let w = window.clone();
        let cookie_url = base.clone();
        let read = tauri::async_runtime::spawn_blocking(move || {
            let url = w.url().map_err(|e| e.to_string())?;
            let cookies = w
                .cookies_for_url(cookie_url)
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|c| RawCookie::new(c.name(), c.value()))
                .collect::<Vec<_>>();
            Ok::<_, String>((url, cookies))
        })
        .await;
        let (url, cookies) = match read {
            Ok(Ok(x)) => x,
            _ => continue,
        };
        let names: Vec<String> = cookies.iter().map(|c| c.name.clone()).collect();
        if last_names.as_ref() != Some(&names) {
            log(&app, AuthLog::ok("midata-cookies-read", Some(format!("Cookies: [{}]", names.join(", ")))));
            last_names = Some(names.clone());
        }
        let signed_in = !url.path().contains("/users/")
            && same_origin(&base, &url)
            && cookies.iter().any(|c| c.name == SESSION_COOKIE && !c.value.is_empty());
        if !signed_in {
            continue;
        }

        let jar = Arc::new(Jar::default());
        let mut dir = base.clone();
        dir.set_path("/");
        for c in &cookies {
            jar.add_cookie_str(&jar_cookie_string(c, &dir), &dir);
        }
        let client = match build_client(jar.clone()) {
            Ok(c) => c,
            Err(e) => {
                log(&app, AuthLog::fail("midata-login", Some(e.to_string())));
                return;
            }
        };
        let status = {
            let mut g = state.inner.write().await;
            if state.epoch.load(Ordering::SeqCst) != epoch {
                return;
            }
            g.client = client;
            g.jar = jar;
            g.conn = Some(Connection {
                base_url: base.as_str().trim_end_matches('/').to_string(),
                method: Method::Session,
                cookie_names: names,
                token: None,
            });
            status_of(g.conn.as_ref())
        };
        log(&app, AuthLog::ok("midata-login", Some("Sitzung übernommen".into())));
        emit_status(&app, &status);
        let _ = tauri::async_runtime::spawn_blocking(move || window.close()).await;
        return;
    }
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
    let base = normalize_midata_base_url(&base_url)?;
    let token = token.trim().to_string();
    if token.is_empty() || token.len() > MAX_TOKEN_LEN || token.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(invalid("Ungültiges Token"));
    }
    let base_u = Url::parse(&base).map_err(|e| AppError::Core(CoreError::InvalidUrl(e.to_string())))?;
    let ctx = Ctx {
        client: build_client(Arc::new(Jar::default()))?,
        base: base_u.clone(),
        token: Some(token.clone()),
        method: Method::Token,
    };
    let f = fetch(&ctx, api_url(&base_u, token_check_path())?, JSONAPI_ACCEPT).await?;
    match f.status {
        200..=299 => {}
        401 | 403 => return Err(AppError::Unexpected("Token ungültig oder ohne Berechtigung".into())),
        s => return Err(status_error(s)),
    }
    let (store_base, store_token) = (base.clone(), token.clone());
    tauri::async_runtime::spawn_blocking(move || keychain_store(&store_base, &store_token)).await??;

    state.epoch.fetch_add(1, Ordering::SeqCst);
    let status = {
        let mut g = state.inner.write().await;
        let jar = Arc::new(Jar::default());
        g.client = build_client(jar.clone())?;
        g.jar = jar;
        g.conn = Some(Connection { base_url: base, method: Method::Token, cookie_names: vec![], token: Some(token) });
        status_of(g.conn.as_ref())
    };
    emit_status(&app, &status);
    Ok(status)
}

#[tauri::command]
pub async fn midata_logout<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, MidataState>,
) -> AppResult<()> {
    ensure_main(&webview)?;
    state.epoch.fetch_add(1, Ordering::SeqCst);
    let base = {
        let mut g = state.inner.write().await;
        let base = g.conn.take().map(|c| c.base_url);
        let jar = Arc::new(Jar::default());
        g.client = build_client(jar.clone())?;
        g.jar = jar;
        base
    };
    if let Some(w) = app.get_webview_window(MIDATA_LOGIN_LABEL) {
        let _ = tauri::async_runtime::spawn_blocking(move || w.close()).await;
    }
    let deleted = tauri::async_runtime::spawn_blocking(move || keychain_delete(base)).await?;
    emit_status(&app, &state.status().await);
    deleted
}

#[tauri::command]
pub async fn midata_find_events<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MidataState>,
    from: String,
    to: String,
    camp_start: Option<String>,
    camp_end: Option<String>,
) -> AppResult<Vec<MidataEventSummary>> {
    ensure_main(&webview)?;
    find_events_impl(&state, &from, &to, camp_start.as_deref(), camp_end.as_deref()).await
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
    fetch_aggregate_impl(&state, &event_id, &camp_start, &camp_end, coach_person_id.as_deref()).await
}

#[tauri::command]
pub async fn midata_probe<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, MidataState>,
    event_id: String,
    group_id: Option<String>,
) -> AppResult<MidataProbe> {
    ensure_main(&webview)?;
    probe_impl(&state, &event_id, group_id.as_deref()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc3339_formatting() {
        assert_eq!(rfc3339_from_unix(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339_from_unix(1_700_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(rfc3339_from_unix(951_782_400), "2000-02-29T00:00:00Z");
    }

    #[test]
    fn date_and_id_validation() {
        assert!(validate_date("2026-07-18").is_ok());
        assert!(validate_date("2026-13-01").is_err());
        assert!(validate_date("2026-7-18").is_err());
        assert!(validate_date("2026-07-18&x=1").is_err());
        assert!(validate_id("1234").is_ok());
        assert!(validate_id("ab_c-9").is_ok());
        assert!(validate_id("").is_err());
        assert!(validate_id("1/../2").is_err());
        assert!(validate_id("1&filter=x").is_err());
        assert!(validate_id(&"a".repeat(41)).is_err());
    }

    #[test]
    fn page_number_fallback() {
        let u = Url::parse("https://db.scout.ch/api/event_participations?filter[event_id]=42&page[size]=100").unwrap();
        let n2 = with_page_number(&u, 2);
        let q: Vec<(String, String)> = n2.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        assert!(q.contains(&("page[number]".into(), "2".into())));
        assert!(q.contains(&("filter[event_id]".into(), "42".into())));
        let n3 = with_page_number(&n2, 3);
        assert_eq!(n3.query_pairs().filter(|(k, _)| k == "page[number]").count(), 1);
        assert!(n3.query_pairs().any(|(k, v)| k == "page[number]" && v == "3"));
        let full = serde_json::json!({ "data": (0..100).map(|i| serde_json::json!({ "id": i })).collect::<Vec<_>>() });
        assert!(full_page(&full));
        assert!(!full_page(&serde_json::json!({ "data": [] })));
    }

    #[test]
    fn query_building() {
        let p = events_path("2026-07-01", "2026-07-31", true, true);
        assert!(p.starts_with("/api/events?filter[type][eq]=Event::Camp"));
        assert!(p.contains("filter[after_or_on]=2026-07-01"));
        assert!(p.contains("filter[before_or_on]=2026-07-31"));
        assert!(p.contains("include=dates,groups"));
        let no_dates = events_path("2026-07-01", "2026-07-31", false, true);
        assert!(no_dates.contains("Event::Camp") && !no_dates.contains("after_or_on"));
        let bare = events_path("2026-07-01", "2026-07-31", false, false);
        assert!(!bare.contains("filter["));
        assert!(participations_path("42").contains("filter[event_id]=42"));
        assert!(participations_path("42").contains("page[size]=100"));
        assert_eq!(event_path("42"), "/api/events/42?include=dates");
        let q = qualifications_path(&["1".into(), "2".into()]);
        assert!(q.contains("filter[person_id]=1,2"));
        assert!(q.contains("include=qualification_kind"));
        assert_eq!(classic_path("7", "42"), "/groups/7/events/42.json");
    }

    #[test]
    fn api_url_stays_on_origin() {
        let base = Url::parse("https://db.scout.ch").unwrap();
        let u = api_url(&base, "/api/events?page[size]=1").unwrap();
        assert_eq!(u.host_str(), Some("db.scout.ch"));
        assert_eq!(u.path(), "/api/events");
        assert!(api_url(&base, "https://evil.example/x").is_err());
    }

    #[test]
    fn next_link_resolution() {
        let base = Url::parse("https://db.scout.ch").unwrap();
        let cur = Url::parse("https://db.scout.ch/api/events?page[number]=1&page[size]=100").unwrap();
        // relative (what MiData actually sends)
        let r = resolve_next(&base, &cur, "/api/events?page[number]=2&page[size]=100").unwrap();
        assert_eq!(r.host_str(), Some("db.scout.ch"));
        assert_eq!(r.path(), "/api/events");
        assert!(r.query().unwrap().contains("page[number]=2"));
        // absolute same-origin
        let a = resolve_next(&base, &cur, "https://db.scout.ch/api/events?page[number]=3").unwrap();
        assert!(a.query().unwrap().contains("page[number]=3"));
        // foreign origins refused
        assert!(resolve_next(&base, &cur, "https://evil.example/api/events?page[number]=2").is_err());
        assert!(resolve_next(&base, &cur, "//evil.example/api").is_err());
        assert!(resolve_next(&base, &cur, "http://db.scout.ch/api").is_err());
    }

    #[test]
    fn same_origin_check() {
        let base = Url::parse("https://db.scout.ch").unwrap();
        assert!(same_origin(&base, &Url::parse("https://db.scout.ch/api/events?page[number]=2").unwrap()));
        assert!(!same_origin(&base, &Url::parse("http://db.scout.ch/api").unwrap()));
        assert!(!same_origin(&base, &Url::parse("https://db.scout.ch.evil.example/api").unwrap()));
        assert!(!same_origin(&base, &Url::parse("https://db.scout.ch:8443/api").unwrap()));
    }

    #[test]
    fn birthday_detection_returns_bool_only() {
        let with = serde_json::json!({"included":[{"type":"people","attributes":{"birthday":"2012-01-01"}}]});
        let without = serde_json::json!({"included":[{"type":"people","attributes":{"birthday":null}}]});
        assert!(any_birthday(&with));
        assert!(!any_birthday(&without));
        assert!(!any_birthday(&serde_json::json!({})));
    }

    #[test]
    fn status_hides_token() {
        let c = Connection { base_url: "https://db.scout.ch".into(), method: Method::Token, cookie_names: vec![], token: Some("SECRET".into()) };
        let json = serde_json::to_string(&status_of(Some(&c))).unwrap();
        assert!(!json.contains("SECRET"));
        assert!(json.contains("\"method\":\"token\""));
    }
}
