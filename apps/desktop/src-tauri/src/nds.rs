//! NDS connection (M8, red zone, read-only).
//!
//! Own HTTP client + cookie jar (separate from eCamp and MiData), own login window
//! (`nds-login`, no capability / no IPC), session in the OS keychain (service `co-co-nds`).
//! Raw responses are reduced in `coco_core::nds`; only aggregates, camp summaries, probe results
//! (names + status codes) and status cross to the UI. Only GET and GraphQL queries are sent,
//! never mutations. Refreshed only on explicit user request, never in the background.
//!
//! The HTTP logic lives in plain async functions taking `&NdsState` (`find_camps_impl`,
//! `fetch_aggregate_impl`, `probe_impl`) so the ignored live test can call it without a Webview.
//!
//! Secrets: cookie values are never logged, serialized or put into error messages. Raw JSON
//! documents are dropped at the end of each function and never logged. The GraphQL documents do
//! not even request names, birth dates, addresses or AHV numbers.
//!
//! CONTRACT (M8): command names/args/returns are fixed (see
//! docs/contracts/commands.md and src/lib/tauri.ts).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use coco_core::cookies::{jar_cookie_string, RawCookie};
use coco_core::nds::{
    chunk_variables, graphql_body, graphql_data, is_session_expired_status, list_document, parse_camps_overlapping,
    parse_chunk, parse_offers_overlapping, probe_fields, reduce_aggregate, NdsAggregate, NdsCampSummary, NdsProbe,
    NdsProbeEndpoint, NdsStatus, RawNdsCamp, NDS_BASE_URL, NDS_LANGUAGE, NDS_LOGIN_PATH, OP_ACTIVITY_LIST,
    OP_CAMP_LIST, OP_OFFER_LIST, OP_PARTICIPANTS_LIST, OP_RENTAL_ORDERS, OP_SUPERVISORS_LIST, Q_ACTIVITY_LIST,
    Q_CAMP_LIST, Q_OFFER_LIST, Q_PARTICIPANTS_LIST, Q_RENTAL_ORDERS, Q_SUPERVISORS_LIST, SESSION_COOKIE,
    SESSION_EXPIRED_MSG,
};
use coco_core::types::AuthLog;
use coco_core::CoreError;
use reqwest::cookie::Jar;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Webview, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::RwLock;
use url::Url;

use crate::error::{AppError, AppResult};
use crate::session::{ensure_main, log, read_body_capped, MAIN_LABEL};

/// Label of the NDS login window (no capability).
pub const NDS_LOGIN_LABEL: &str = "nds-login";
/// Event emitted to "main" with an `NdsStatus` payload after login/logout.
pub const EVENT_NDS_STATUS: &str = "nds://status";

const LOGIN_TITLE: &str = "NDS Anmeldung";
const POLL_INTERVAL: Duration = Duration::from_millis(1000);
const POLL_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Verify the session with a request only every N polls (the candidate check costs one GET).
const VERIFY_EVERY_POLLS: u32 = 3;
const USER_AGENT: &str = concat!("co-co/", env!("CARGO_PKG_VERSION"), " (NDS read-only client)");
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_BODY: usize = 8 * 1024 * 1024;
const MAX_PAGES: u32 = 100;
const PAGE_SIZE: u32 = 50;
const KEYCHAIN_SERVICE: &str = "co-co-nds";
const KEYCHAIN_USER: &str = "session";
/// Only these cookies are kept (names are never secret, values are).
const KEPT_COOKIES: [&str; 3] = [SESSION_COOKIE, "cookiesession1", "LANG"];
/// Cheap authenticated GET used to verify that a session really is logged in.
const SESSION_CHECK_PATH: &str = "/youthtraining/offer/offer/availableOptions";

/// Current connection. Deliberately no `Debug`/`Serialize` (holds cookie values).
struct Connection {
    cookies: Vec<RawCookie>,
}

impl Connection {
    fn names(&self) -> Vec<String> {
        self.cookies.iter().map(|c| c.name.clone()).collect()
    }
}

struct Inner {
    client: reqwest::Client,
    conn: Option<Connection>,
}

/// Managed state of the NDS connection.
pub struct NdsState {
    inner: RwLock<Inner>,
    /// Bumped by logout/login so a stale login window cannot store cookies.
    epoch: AtomicU64,
}

/// Everything needed for requests; cheap to clone.
struct Ctx {
    client: reqwest::Client,
    base: Url,
}

fn base_url() -> Url {
    Url::parse(NDS_BASE_URL).expect("static NDS base URL")
}

fn build_client(jar: Arc<Jar>) -> AppResult<reqwest::Client> {
    // Redirects only within the starting origin; the Keycloak redirect of an expired session is
    // not followed (the 3xx status is reported as «session expired»).
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
        .https_only(true)
        .cookie_provider(jar)
        .redirect(policy)
        .build()?)
}

/// A client whose jar holds `cookies` for the NDS origin.
fn client_with_cookies(cookies: &[RawCookie]) -> AppResult<reqwest::Client> {
    let jar = Arc::new(Jar::default());
    let base = base_url();
    for c in cookies {
        jar.add_cookie_str(&jar_cookie_string(c, &base), &base);
    }
    build_client(jar)
}

impl NdsState {
    pub fn new() -> AppResult<Self> {
        Ok(Self {
            inner: RwLock::new(Inner { client: build_client(Arc::new(Jar::default()))?, conn: None }),
            epoch: AtomicU64::new(0),
        })
    }

    /// In-memory connection without keychain (live tests).
    #[cfg(test)]
    pub fn for_test(session_value: &str) -> AppResult<Self> {
        let st = Self::new()?;
        let cookies = vec![RawCookie::new(SESSION_COOKIE, session_value)];
        let client = client_with_cookies(&cookies)?;
        tauri::async_runtime::block_on(async {
            let mut g = st.inner.write().await;
            g.client = client;
            g.conn = Some(Connection { cookies });
        });
        Ok(st)
    }

    async fn status(&self) -> NdsStatus {
        status_of(self.inner.read().await.conn.as_ref())
    }

    /// Loads the session from the keychain when nothing is connected yet.
    async fn lazy_load(&self) {
        if self.inner.read().await.conn.is_some() {
            return;
        }
        let Some(cookies) = tauri::async_runtime::spawn_blocking(keychain_load).await.ok().flatten() else {
            return;
        };
        let Ok(client) = client_with_cookies(&cookies) else { return };
        let mut g = self.inner.write().await;
        if g.conn.is_none() {
            g.client = client;
            g.conn = Some(Connection { cookies });
        }
    }

    async fn ctx(&self) -> AppResult<Ctx> {
        self.lazy_load().await;
        let g = self.inner.read().await;
        g.conn.as_ref().ok_or(AppError::NotLoggedIn)?;
        Ok(Ctx { client: g.client.clone(), base: base_url() })
    }

    /// Drops the in-memory session and the stored one. Returns the keychain result.
    async fn disconnect(&self) -> AppResult<()> {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        {
            let mut g = self.inner.write().await;
            g.conn = None;
            g.client = build_client(Arc::new(Jar::default()))?;
        }
        tauri::async_runtime::spawn_blocking(keychain_delete).await?
    }
}

fn status_of(conn: Option<&Connection>) -> NdsStatus {
    match conn {
        Some(c) => NdsStatus { connected: true, cookie_names: c.names() },
        None => NdsStatus { connected: false, cookie_names: vec![] },
    }
}

fn emit_status<R: Runtime>(app: &AppHandle<R>, status: &NdsStatus) {
    let _ = app.emit_to(MAIN_LABEL, EVENT_NDS_STATUS, status.clone());
}

// ---------------------------------------------------------------- keychain

fn keychain_err(e: keyring::Error) -> AppError {
    // keyring errors do not contain the secret
    AppError::Unexpected(format!("Schlüsselbund nicht verfügbar: {e}"))
}

/// Cookies are stored as `name=value; name=value` (names and values never contain `;`).
fn keychain_store(cookies: &[RawCookie]) -> AppResult<()> {
    let joined = cookies.iter().map(|c| format!("{}={}", c.name, c.value)).collect::<Vec<_>>().join("; ");
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).and_then(|e| e.set_password(&joined)).map_err(keychain_err)
}

fn keychain_load() -> Option<Vec<RawCookie>> {
    let raw = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).ok()?.get_password().ok()?;
    let cookies: Vec<RawCookie> = raw
        .split("; ")
        .filter_map(|p| p.split_once('='))
        .filter(|(n, v)| KEPT_COOKIES.contains(n) && !v.is_empty())
        .map(|(n, v)| RawCookie::new(n, v))
        .collect();
    cookies.iter().any(|c| c.name == SESSION_COOKIE).then_some(cookies)
}

fn keychain_delete() -> AppResult<()> {
    match keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).and_then(|e| e.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keychain_err(e)),
    }
}

// ------------------------------------------------------- pure helpers

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

/// NDS business ids are numeric (`^-?\d+$`).
fn validate_id(s: &str) -> AppResult<()> {
    let digits = s.strip_prefix('-').unwrap_or(s);
    if (1..=20).contains(&digits.len()) && digits.bytes().all(|c| c.is_ascii_digit()) {
        Ok(())
    } else {
        Err(invalid("Ungültige NDS-ID"))
    }
}

/// Joins a path onto the NDS base; refuses anything leaving the origin.
fn api_url(base: &Url, path: &str) -> AppResult<Url> {
    let url = base
        .join(path.trim_start_matches('/'))
        .map_err(|e| AppError::Core(CoreError::InvalidUrl(e.to_string())))?;
    if url.origin() != base.origin() {
        return Err(AppError::Core(CoreError::ForeignOrigin(url.origin().ascii_serialization())));
    }
    Ok(url)
}

fn camp_path(camp_id: &str, tail: &str) -> String {
    format!("/youthtraining/offer/camp/{camp_id}/{tail}")
}

fn offer_details_path(offer_id: &str) -> String {
    format!("/youthtraining/offer/offer/{offer_id}/details")
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

fn session_expired() -> AppError {
    AppError::Unexpected(SESSION_EXPIRED_MSG.into())
}

fn is_session_expired(e: &AppError) -> bool {
    matches!(e, AppError::Unexpected(m) if m == SESSION_EXPIRED_MSG)
}

fn status_error(status: u16) -> AppError {
    if is_session_expired_status(status) {
        session_expired()
    } else {
        AppError::Unexpected(format!("NDS antwortete mit HTTP {status}"))
    }
}

fn request_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(ACCEPT, HeaderValue::from_static("application/json"));
    h.insert("default-language", HeaderValue::from_static(NDS_LANGUAGE));
    h
}

async fn finish(ctx: &Ctx, resp: reqwest::Response) -> AppResult<Fetched> {
    if resp.url().origin() != ctx.base.origin() {
        return Err(AppError::Core(CoreError::ForeignOrigin(resp.url().origin().ascii_serialization())));
    }
    let status = resp.status().as_u16();
    if !(200..300).contains(&status) {
        return Ok(Fetched { status, body: None });
    }
    let bytes = read_body_capped(resp, MAX_BODY).await?;
    Ok(Fetched { status, body: serde_json::from_slice(&bytes).ok() })
}

/// GET (read-only).
async fn fetch(ctx: &Ctx, path: &str) -> AppResult<Fetched> {
    let resp = ctx.client.get(api_url(&ctx.base, path)?).headers(request_headers()).send().await?;
    finish(ctx, resp).await
}

/// GraphQL query via POST. `ensure_query_only` runs inside `graphql_body`.
async fn fetch_graphql(ctx: &Ctx, service: &str, op: &str, query: &str, variables: Value) -> AppResult<Fetched> {
    let body = graphql_body(op, variables, query)?;
    let url = api_url(&ctx.base, &format!("/{service}/graphql/admin"))?;
    let resp = ctx.client.post(url).headers(request_headers()).json(&body).send().await?;
    finish(ctx, resp).await
}

async fn get_json(ctx: &Ctx, path: &str) -> AppResult<Value> {
    let f = fetch(ctx, path).await?;
    if !(200..300).contains(&f.status) {
        return Err(status_error(f.status));
    }
    f.body.ok_or_else(|| AppError::Http("NDS-Antwort nicht lesbar (kein JSON)".into()))
}

/// Result of an optional document: session expiry is propagated, any other problem yields `Null`
/// (the reduction tolerates missing parts).
fn tolerate(r: AppResult<Value>) -> AppResult<Value> {
    match r {
        Err(e) if is_session_expired(&e) => Err(e),
        Err(_) => Ok(Value::Null),
        Ok(v) => Ok(v),
    }
}

/// All pages of one GraphQL list (`page` 0-based, max 100 pages). `field` is the root field of
/// the operation (`data.<field>`).
async fn graphql_list(ctx: &Ctx, service: &str, op: &str, query: &str, field: &str, extra: Value) -> AppResult<Vec<Value>> {
    let mut items = Vec::new();
    let mut page = 0u32;
    loop {
        let f = fetch_graphql(ctx, service, op, query, chunk_variables(extra.clone(), PAGE_SIZE, page)).await?;
        if !(200..300).contains(&f.status) {
            return Err(status_error(f.status));
        }
        let body = f.body.ok_or_else(|| AppError::Http("NDS-Antwort nicht lesbar (kein JSON)".into()))?;
        let data = graphql_data(&body)?;
        let list = data.get(field).ok_or_else(|| AppError::Unexpected("NDS-Antwort ohne erwartete Liste".into()))?;
        let (chunk, total_pages) = parse_chunk(list)?;
        let empty = chunk.is_empty();
        items.extend(chunk);
        page += 1;
        if page >= total_pages || empty {
            return Ok(items);
        }
        if page >= MAX_PAGES {
            return Err(AppError::Unexpected(format!("NDS: mehr als {MAX_PAGES} Seiten – abgebrochen")));
        }
    }
}

pub async fn find_camps_impl(state: &NdsState, from: &str, to: &str) -> AppResult<Vec<NdsCampSummary>> {
    validate_date(from)?;
    validate_date(to)?;
    let ctx = state.ctx().await?;
    let offers = graphql_list(&ctx, "youthtraining", OP_OFFER_LIST, Q_OFFER_LIST, "offerList", json!({})).await?;
    let mut out = Vec::new();
    for (offer_id, number, state_code) in parse_offers_overlapping(&offers, from, to)? {
        let camps = graphql_list(
            &ctx,
            "youthtraining",
            OP_CAMP_LIST,
            Q_CAMP_LIST,
            "campList",
            json!({ "offerBusinessId": offer_id }),
        )
        .await?;
        out.extend(parse_camps_overlapping(&offer_id, number.as_deref(), state_code.as_deref(), &camps, from, to)?);
    }
    Ok(out)
}

pub async fn fetch_aggregate_impl(state: &NdsState, offer_id: &str, camp_id: &str) -> AppResult<NdsAggregate> {
    validate_id(offer_id)?;
    validate_id(camp_id)?;
    let ctx = state.ctx().await?;
    let camp_details = get_json(&ctx, &camp_path(camp_id, "details")).await?;
    let statistics = tolerate(get_json(&ctx, &camp_path(camp_id, "statistics")).await)?;
    let offer_details = tolerate(get_json(&ctx, &offer_details_path(offer_id)).await)?;
    let camp_vars = json!({ "campBusinessId": camp_id });
    let list = |r: AppResult<Vec<Value>>| -> AppResult<Value> {
        match r {
            Ok(items) => Ok(list_document(items)),
            Err(e) if is_session_expired(&e) => Err(e),
            Err(_) => Ok(Value::Null),
        }
    };
    let activities = list(
        graphql_list(&ctx, "youthtraining", OP_ACTIVITY_LIST, Q_ACTIVITY_LIST, "activityListForCamp", camp_vars.clone())
            .await,
    )?;
    let supervisors = list(
        graphql_list(&ctx, "youthtraining", OP_SUPERVISORS_LIST, Q_SUPERVISORS_LIST, "supervisorsListForCamp", camp_vars.clone())
            .await,
    )?;
    let participants = list(
        graphql_list(&ctx, "youthtraining", OP_PARTICIPANTS_LIST, Q_PARTICIPANTS_LIST, "participantsListForCamp", camp_vars.clone())
            .await,
    )?;
    let rental_orders = list(
        graphql_list(&ctx, "material", OP_RENTAL_ORDERS, Q_RENTAL_ORDERS, "rentalMaterialOrderListForCamp", camp_vars).await,
    )?;
    let fetched_at = now_rfc3339();
    reduce_aggregate(&RawNdsCamp {
        offer_business_id: offer_id,
        camp_business_id: camp_id,
        offer_details: &offer_details,
        camp_details: &camp_details,
        statistics: &statistics,
        activities: &activities,
        supervisors: &supervisors,
        participants: &participants,
        rental_orders: &rental_orders,
        fetched_at: &fetched_at,
    })
    .map_err(Into::into)
}

const CAMP_DETAIL_FIELDS: [&str; 8] = [
    "offerBusinessId",
    "offerItemState",
    "approvalTimestamp",
    "duration.first",
    "duration.last",
    "overnightStay",
    "campAgenda",
    "riskActivitiesPlanned",
];
const STATISTICS_FIELDS: [&str; 14] = [
    "planned.numberOfChildren",
    "planned.numberOfAdolescents",
    "planned.totalNumberOfParticipants",
    "planned.totalNumberOfInstructors",
    "planned.numberOfJsInstructors",
    "planned.numberOfCampDays",
    "planned.totalNumberOfActivities",
    "planned.coachAuthorizedForContribution",
    "actual.numberOfChildren",
    "actual.numberOfAdolescents",
    "actual.totalNumberOfParticipants",
    "actual.totalNumberOfInstructors",
    "actual.numberOfJsInstructors",
    "actual.numberOfCampDays",
];
const OFFER_DETAIL_FIELDS: [&str; 5] = ["offerNumber", "offerState", "approvalTimestamp", "duration.first", "duration.last"];

fn endpoint(name: &str, status: Option<u16>, doc: Option<&Value>, expected: &[&str]) -> NdsProbeEndpoint {
    let (fields_present, fields_missing) = match doc {
        Some(d) => probe_fields(d, expected),
        None => (vec![], expected.iter().map(|s| (*s).to_string()).collect()),
    };
    NdsProbeEndpoint { name: name.into(), status, fields_present, fields_missing }
}

/// Probes one GraphQL list: HTTP status plus which `content[].x` fields came back.
async fn probe_list(
    ctx: &Ctx,
    service: &str,
    op: &str,
    query: &str,
    field: &str,
    extra: Value,
    item_fields: &[&str],
) -> AppResult<NdsProbeEndpoint> {
    let name = format!("graphql/{op}");
    let f = fetch_graphql(ctx, service, op, query, chunk_variables(extra, 1, 0)).await?;
    let mut expected: Vec<String> = vec!["totalPages".into()];
    expected.extend(item_fields.iter().map(|x| format!("content[].{x}")));
    let expected_refs: Vec<&str> = expected.iter().map(String::as_str).collect();
    let list = f.body.as_ref().and_then(|b| graphql_data(b).ok()).and_then(|d| d.get(field));
    Ok(endpoint(&name, Some(f.status), list, &expected_refs))
}

pub async fn probe_impl(state: &NdsState, camp_id: &str) -> AppResult<NdsProbe> {
    validate_id(camp_id)?;
    let ctx = state.ctx().await?;
    let mut endpoints = Vec::new();

    let details = fetch(&ctx, &camp_path(camp_id, "details")).await?;
    endpoints.push(endpoint("camp/details", Some(details.status), details.body.as_ref(), &CAMP_DETAIL_FIELDS));
    let stats = fetch(&ctx, &camp_path(camp_id, "statistics")).await?;
    endpoints.push(endpoint("camp/statistics", Some(stats.status), stats.body.as_ref(), &STATISTICS_FIELDS));

    // The offer id comes from the camp details; it is only used in a request path.
    let offer_id = details
        .body
        .as_ref()
        .and_then(|d| d.get("offerBusinessId"))
        .and_then(|v| v.as_str().map(str::to_string).or_else(|| v.as_i64().map(|n| n.to_string())))
        .filter(|id| validate_id(id).is_ok());
    match &offer_id {
        Some(id) => {
            let f = fetch(&ctx, &offer_details_path(id)).await?;
            endpoints.push(endpoint("offer/details", Some(f.status), f.body.as_ref(), &OFFER_DETAIL_FIELDS));
        }
        None => endpoints.push(endpoint("offer/details", None, None, &OFFER_DETAIL_FIELDS)),
    }

    endpoints.push(
        probe_list(
            &ctx,
            "youthtraining",
            OP_OFFER_LIST,
            Q_OFFER_LIST,
            "offerList",
            json!({}),
            &["businessId", "offerNumber", "duration.first", "duration.last", "offerState"],
        )
        .await?,
    );
    match &offer_id {
        Some(id) => endpoints.push(
            probe_list(
                &ctx,
                "youthtraining",
                OP_CAMP_LIST,
                Q_CAMP_LIST,
                "campList",
                json!({ "offerBusinessId": id }),
                &["businessId", "offerItemNumber", "groupName", "duration.first", "duration.last", "offerItemState"],
            )
            .await?,
        ),
        None => endpoints.push(endpoint(&format!("graphql/{OP_CAMP_LIST}"), None, None, &["totalPages"])),
    }
    let camp_vars = json!({ "campBusinessId": camp_id });
    endpoints.push(
        probe_list(
            &ctx,
            "youthtraining",
            OP_ACTIVITY_LIST,
            Q_ACTIVITY_LIST,
            "activityListForCamp",
            camp_vars.clone(),
            &["activityType", "activityState", "activityDate"],
        )
        .await?,
    );
    endpoints.push(
        probe_list(
            &ctx,
            "youthtraining",
            OP_SUPERVISORS_LIST,
            Q_SUPERVISORS_LIST,
            "supervisorsListForCamp",
            camp_vars.clone(),
            &["involvementType"],
        )
        .await?,
    );
    endpoints.push(
        probe_list(
            &ctx,
            "youthtraining",
            OP_PARTICIPANTS_LIST,
            Q_PARTICIPANTS_LIST,
            "participantsListForCamp",
            camp_vars.clone(),
            &["targetAudienceGroup"],
        )
        .await?,
    );
    endpoints.push(
        probe_list(
            &ctx,
            "material",
            OP_RENTAL_ORDERS,
            Q_RENTAL_ORDERS,
            "rentalMaterialOrderListForCamp",
            camp_vars,
            &["orderState", "dispatchmentDate", "returnDate"],
        )
        .await?,
    );

    // Connected only if the session is still accepted.
    let connected = !endpoints.iter().any(|e| e.status.is_some_and(is_session_expired_status));
    Ok(NdsProbe { connected, endpoints })
}

// --------------------------------------------------------------- commands

/// After a session-expired error: forget the dead session and tell the UI.
async fn drop_expired_session<R: Runtime, T>(app: &AppHandle<R>, state: &NdsState, result: &AppResult<T>) {
    if matches!(result, Err(e) if is_session_expired(e)) {
        let _ = state.disconnect().await;
        emit_status(app, &state.status().await);
        log(app, AuthLog::fail("nds-session", Some("Sitzung abgelaufen".into())));
    }
}

#[tauri::command]
pub async fn nds_status<R: Runtime>(webview: Webview<R>, state: State<'_, NdsState>) -> AppResult<NdsStatus> {
    ensure_main(&webview)?;
    state.lazy_load().await;
    Ok(state.status().await)
}

#[tauri::command]
pub async fn nds_open_login<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, NdsState>,
) -> AppResult<()> {
    ensure_main(&webview)?;
    if let Some(existing) = app.get_webview_window(NDS_LOGIN_LABEL) {
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }
    let base = base_url();
    let login_url = api_url(&base, NDS_LOGIN_PATH)?;
    let epoch = state.epoch.fetch_add(1, Ordering::SeqCst) + 1;

    let window = WebviewWindowBuilder::new(&app, NDS_LOGIN_LABEL, WebviewUrl::External(login_url))
        .title(LOGIN_TITLE)
        .inner_size(520.0, 760.0)
        .min_inner_size(380.0, 480.0)
        .center()
        .focused(true)
        .incognito(true)
        // Main thread: no cookie access here. AGOV/Keycloak live on other hosts, so only https is required.
        .on_navigation(|url| url.as_str() == "about:blank" || url.scheme() == "https")
        .build()?;
    // No window-event hook needed: the poller notices a closed window.
    drop(window);

    log(&app, AuthLog::ok("nds-login-window-opened", None));
    let poll_app = app.clone();
    tauri::async_runtime::spawn(async move {
        poll_login(poll_app, base, epoch).await;
    });
    Ok(())
}

/// True once the login window is back on the NDS app (not on the OAuth entry/callback paths).
fn is_signed_in_location(base: &Url, url: &Url) -> bool {
    url.origin() == base.origin()
        && !url.path().starts_with("/perorgfin/oauth2/")
        && !url.path().starts_with("/perorgfin/login")
}

/// Polls until a `SESSION` cookie exists, the window is back on NDS, and an authenticated GET works.
async fn poll_login<R: Runtime>(app: AppHandle<R>, base: Url, epoch: u64) {
    let started = Instant::now();
    let mut last_names: Option<Vec<String>> = None;
    let mut polls: u32 = 0;
    loop {
        tokio::time::sleep(POLL_INTERVAL).await;
        polls += 1;
        let state = app.state::<NdsState>();
        if state.epoch.load(Ordering::SeqCst) != epoch {
            return;
        }
        if started.elapsed() > POLL_TIMEOUT {
            log(&app, AuthLog::fail("nds-login-timeout", Some("Keine Anmeldung innerhalb von 30 Minuten".into())));
            return;
        }
        let Some(window) = app.get_webview_window(NDS_LOGIN_LABEL) else {
            return;
        };
        // Windows: cookies_for_url / url() must not run on the main thread (wry#583).
        let w = window.clone();
        let cookie_urls = [base.clone(), base.join("perorgfin/").unwrap_or_else(|_| base.clone())];
        let read = tauri::async_runtime::spawn_blocking(move || {
            let url = w.url().map_err(|e| e.to_string())?;
            let mut cookies: Vec<RawCookie> = Vec::new();
            for cu in cookie_urls {
                for c in w.cookies_for_url(cu).map_err(|e| e.to_string())? {
                    if !cookies.iter().any(|k| k.name == c.name()) {
                        cookies.push(RawCookie::new(c.name(), c.value()));
                    }
                }
            }
            Ok::<_, String>((url, cookies))
        })
        .await;
        let (url, cookies) = match read {
            Ok(Ok(x)) => x,
            _ => continue,
        };
        let names: Vec<String> = cookies.iter().map(|c| c.name.clone()).collect();
        if last_names.as_ref() != Some(&names) {
            log(&app, AuthLog::ok("nds-cookies-read", Some(format!("Cookies: [{}]", names.join(", ")))));
            last_names = Some(names);
        }
        let has_session = cookies.iter().any(|c| c.name == SESSION_COOKIE && !c.value.is_empty());
        if !has_session || !is_signed_in_location(&base, &url) || polls % VERIFY_EVERY_POLLS != 0 {
            continue;
        }

        // Spring creates a SESSION cookie before login finishes: verify with an authenticated GET.
        let kept: Vec<RawCookie> = cookies.into_iter().filter(|c| KEPT_COOKIES.contains(&c.name.as_str())).collect();
        let client = match client_with_cookies(&kept) {
            Ok(c) => c,
            Err(e) => {
                log(&app, AuthLog::fail("nds-login", Some(e.to_string())));
                return;
            }
        };
        let ctx = Ctx { client: client.clone(), base: base.clone() };
        match fetch(&ctx, SESSION_CHECK_PATH).await {
            Ok(f) if (200..300).contains(&f.status) => {}
            _ => continue,
        }

        let store = kept.clone();
        if let Err(e) = tauri::async_runtime::spawn_blocking(move || keychain_store(&store)).await.map_err(AppError::from).and_then(|r| r) {
            log(&app, AuthLog::fail("nds-keychain", Some(e.to_string())));
        }
        let status = {
            let mut g = state.inner.write().await;
            if state.epoch.load(Ordering::SeqCst) != epoch {
                return;
            }
            g.client = client;
            g.conn = Some(Connection { cookies: kept });
            status_of(g.conn.as_ref())
        };
        log(&app, AuthLog::ok("nds-login", Some("Sitzung übernommen".into())));
        emit_status(&app, &status);
        let _ = tauri::async_runtime::spawn_blocking(move || window.close()).await;
        return;
    }
}

#[tauri::command]
pub async fn nds_logout<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, NdsState>,
) -> AppResult<()> {
    ensure_main(&webview)?;
    let deleted = state.disconnect().await;
    if let Some(w) = app.get_webview_window(NDS_LOGIN_LABEL) {
        let _ = tauri::async_runtime::spawn_blocking(move || w.close()).await;
    }
    emit_status(&app, &state.status().await);
    deleted
}

#[tauri::command]
pub async fn nds_find_camps<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, NdsState>,
    from: String,
    to: String,
) -> AppResult<Vec<NdsCampSummary>> {
    ensure_main(&webview)?;
    let result = find_camps_impl(&state, &from, &to).await;
    drop_expired_session(webview.app_handle(), &state, &result).await;
    result
}

#[tauri::command]
pub async fn nds_fetch_aggregate<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, NdsState>,
    offer_business_id: String,
    camp_business_id: String,
) -> AppResult<NdsAggregate> {
    ensure_main(&webview)?;
    let result = fetch_aggregate_impl(&state, &offer_business_id, &camp_business_id).await;
    drop_expired_session(webview.app_handle(), &state, &result).await;
    result
}

#[tauri::command]
pub async fn nds_probe<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, NdsState>,
    camp_business_id: String,
) -> AppResult<NdsProbe> {
    ensure_main(&webview)?;
    // The probe records statuses instead of failing; a dead session shows as `connected: false`.
    let result = probe_impl(&state, &camp_business_id).await;
    if matches!(&result, Ok(p) if !p.connected) {
        let _ = state.disconnect().await;
        emit_status(webview.app_handle(), &state.status().await);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_and_date_validation() {
        assert!(validate_id("7001").is_ok());
        assert!(validate_id("-12").is_ok());
        for bad in ["", "-", "12a", "1/2", "../x", "1 2", "123456789012345678901"] {
            assert!(validate_id(bad).is_err(), "{bad}");
        }
        assert!(validate_date("2026-07-18").is_ok());
        for bad in ["2026-13-01", "2026-7-18", "x", "2026-07-18T00"] {
            assert!(validate_date(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn api_url_stays_on_nds() {
        let base = base_url();
        assert_eq!(
            api_url(&base, "/youthtraining/graphql/admin").unwrap().as_str(),
            "https://www.nds.baspo.admin.ch/youthtraining/graphql/admin"
        );
        assert!(api_url(&base, "https://evil.example/x").is_err());
    }

    #[test]
    fn expired_error_is_recognised() {
        assert!(is_session_expired(&status_error(401)));
        assert!(is_session_expired(&status_error(302)));
        assert!(!is_session_expired(&status_error(500)));
        assert!(!status_error(401).to_string().contains("SESSION"));
    }

    #[test]
    fn signed_in_location() {
        let base = base_url();
        let u = |p: &str| Url::parse(&format!("https://www.nds.baspo.admin.ch{p}")).unwrap();
        assert!(!is_signed_in_location(&base, &u("/perorgfin/oauth2/authorization/keycloak")));
        assert!(!is_signed_in_location(&base, &u("/perorgfin/login/oauth2/code/keycloak")));
        assert!(is_signed_in_location(&base, &u("/")));
        assert!(!is_signed_in_location(&base, &Url::parse("https://login.example.test/").unwrap()));
    }

    #[test]
    fn rfc3339_known_value() {
        assert_eq!(rfc3339_from_unix(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339_from_unix(1_700_000_000), "2023-11-14T22:13:20Z");
    }

    #[test]
    fn status_never_contains_values() {
        let conn = Connection { cookies: vec![RawCookie::new("SESSION", "TOPSECRET")] };
        let s = serde_json::to_string(&status_of(Some(&conn))).unwrap();
        assert!(s.contains("SESSION") && !s.contains("TOPSECRET"));
    }
}
