//! NDS (Nationale Datenbank Sport, www.nds.baspo.admin.ch) – pure parsing and reduction to
//! aggregates (M8, red zone). NDS has no public API; endpoints and field names come from the
//! reverse-engineered, read-only spec in `docs/contracts/nds-api/`.
//!
//! Red-zone rule: raw NDS person data (names, birth dates, AHV numbers, addresses, e-mails, IBANs)
//! never leaves this module. Callers hand in raw JSON documents and get an [`NdsAggregate`] back:
//! counts only. Participant/supervisor lists are reduced to counts per involvementType /
//! targetAudienceGroup. Error messages never contain person data or cookies.
//!
//! Unknown state codes are kept as raw strings and never crash anything.
//!
//! CONTRACT (M8): the signatures and serialized shapes below are shared with
//! `src-tauri/src/nds.rs` and `apps/desktop/src/domain/nds/index.ts`
//! (`NdsAggregate`, `NdsCampSummary`, `NdsProbe`, `NdsStatus`). Do not change them without
//! updating both sides.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::CoreError;
use regex::Regex;

/// NDS host (no other host is ever contacted).
pub const NDS_BASE_URL: &str = "https://www.nds.baspo.admin.ch";
/// Keycloak login entry point (opens in the `nds-login` window).
pub const NDS_LOGIN_PATH: &str = "/perorgfin/oauth2/authorization/keycloak";
/// Session cookie name (value never leaves Rust).
pub const SESSION_COOKIE: &str = "SESSION";
/// Value of the `default-language` request header.
pub const NDS_LANGUAGE: &str = "de";

/// Offer/camp states that count as «closed» for `ndsClosed` suggestions (observed codes only).
pub const KNOWN_CLOSED_STATES: [&str; 3] = ["WAITING_FOR_ASSESSMENT", "PAYED_CH", "PARTIALLY_PAYED"];

/// Planned or actual counts of a camp (from `/camp/{id}/statistics`). `None` = field absent.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsCounts {
    pub children: Option<u32>,
    pub adolescents: Option<u32>,
    pub total_participants: Option<u32>,
    pub total_instructors: Option<u32>,
    pub js_instructors: Option<u32>,
    pub camp_days: Option<u32>,
    pub total_activities: Option<u32>,
}

/// Statistics block: planned vs actual.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsStatistics {
    pub planned: NdsCounts,
    pub actual: NdsCounts,
    pub coach_authorized_for_contribution: Option<bool>,
}

/// Activity summary of a camp (from `ActivityListForCamp`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsActivities {
    pub total: u32,
    /// activityState (raw code) -> count.
    pub by_state: BTreeMap<String, u32>,
    /// activityType (raw code) -> count.
    pub by_type: BTreeMap<String, u32>,
    /// YYYY-MM-DD of the latest activity.
    pub last_activity_date: Option<String>,
    /// Activities whose attendance check is still open (known open-state codes only; the code is unverified, see `nds_probe` / `by_state`).
    pub attendance_open_count: u32,
}

/// Material rental order (no personal data).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsRentalOrder {
    pub order_state: Option<String>,
    pub dispatchment_date: Option<String>,
    pub return_date: Option<String>,
}

/// The ONLY NDS-derived structure that crosses to the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsAggregate {
    pub offer_business_id: String,
    pub camp_business_id: String,
    pub offer_number: Option<String>,
    /// YYYY-MM-DD
    pub start: Option<String>,
    pub end: Option<String>,
    /// Raw state codes (unknown codes are kept as they are).
    pub offer_state: Option<String>,
    pub offer_item_state: Option<String>,
    /// Date (YYYY-MM-DD) of `approvalTimestamp` («bewilligt am»), null if absent.
    pub approved_on: Option<String>,
    pub statistics: NdsStatistics,
    /// involvementType (raw code) -> count. No names.
    pub supervisor_counts: BTreeMap<String, u32>,
    pub participant_count: u32,
    /// targetAudienceGroup (raw code) -> count. No names, no birth dates.
    pub participant_counts_by_audience: BTreeMap<String, u32>,
    pub activities: NdsActivities,
    pub camp_agenda_uploaded: Option<bool>,
    pub rental_orders: Vec<NdsRentalOrder>,
    /// Rega registration counts (participants / supervisors); `None` if the Rega lists were not readable.
    #[serde(default)]
    pub rega: Option<RegaCounts>,
    /// ISO date-time «Stand NDS».
    pub fetched_at: String,
}

/// Rega registration counts of one camp. Counts only, no names. Mirrors `NdsRegaCounts` in `domain/types.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegaCounts {
    pub participants_total: u32,
    pub participants_transmitted: u32,
    pub supervisors_total: u32,
    pub supervisors_transmitted: u32,
}

/// One camp of an offer, for the one-time camp pick.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsCampSummary {
    pub offer_business_id: String,
    pub camp_business_id: String,
    pub offer_number: Option<String>,
    pub offer_item_number: Option<String>,
    pub group_name: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub offer_state: Option<String>,
    pub offer_item_state: Option<String>,
}

/// One probed endpoint: HTTP status plus which expected fields were present (names only).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsProbeEndpoint {
    /// Endpoint label, e.g. `camp/details`, `camp/statistics`, `graphql/CampList`.
    pub name: String,
    pub status: Option<u16>,
    pub fields_present: Vec<String>,
    pub fields_missing: Vec<String>,
}

/// Diagnosis result of `nds_probe`. Field NAMES only, never values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsProbe {
    pub connected: bool,
    pub endpoints: Vec<NdsProbeEndpoint>,
}

/// Connection status. Cookie NAMES only, never values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsStatus {
    pub connected: bool,
    pub cookie_names: Vec<String>,
}

/// Raw documents of one camp as fetched by the Rust side. Dropped after reduction.
pub struct RawNdsCamp<'a> {
    pub offer_business_id: &'a str,
    pub camp_business_id: &'a str,
    pub offer_details: &'a Value,
    pub camp_details: &'a Value,
    pub statistics: &'a Value,
    pub activities: &'a Value,
    pub supervisors: &'a Value,
    pub participants: &'a Value,
    pub rental_orders: &'a Value,
    pub fetched_at: &'a str,
}

// ------------------------------------------------------------ GraphQL documents
//
// Field selections are copied from docs/contracts/nds-api/operations.graphql but reduced to what
// the aggregate needs. Person fields (names, birthDate, addresses, ahvn13, e-mails, IBANs) are
// deliberately NOT requested: the lists below only carry involvementType / targetAudienceGroup.

pub const OP_OFFER_LIST: &str = "OfferList";
pub const OP_CAMP_LIST: &str = "CampList";
pub const OP_ACTIVITY_LIST: &str = "ActivityListForCamp";
pub const OP_SUPERVISORS_LIST: &str = "SupervisorsListForCamp";
pub const OP_PARTICIPANTS_LIST: &str = "ParticipantsListForCamp";
pub const OP_REGA_PARTICIPANTS: &str = "RegaParticipantsListForCamp";
pub const OP_REGA_SUPERVISORS: &str = "RegaSupervisorsListForCamp";
pub const OP_RENTAL_ORDERS: &str = "rentalMaterialOrderListForCamp";

pub const Q_OFFER_LIST: &str = "query OfferList($chunk: Chunk, $filter: OfferFilter) {
  offerList(chunk: $chunk, filter: $filter) {
    content { businessId offerNumber duration { first last } offerState }
    totalElements totalPages number size
  }
}";

pub const Q_CAMP_LIST: &str = "query CampList($offerBusinessId: ID!, $campBusinessId: ID, $chunk: Chunk) {
  campList(offerBusinessId: $offerBusinessId, campBusinessId: $campBusinessId, chunk: $chunk) {
    content { businessId offerItemNumber groupName duration { first last } offerItemState }
    totalElements totalPages number size
  }
}";

pub const Q_ACTIVITY_LIST: &str = "query ActivityListForCamp($campBusinessId: ID!, $chunk: Chunk, $filter: ActivityFilter) {
  activityListForCamp(campBusinessId: $campBusinessId, chunk: $chunk, filter: $filter) {
    content { businessId activityType activityState activityDate }
    totalElements totalPages number size
  }
}";

pub const Q_SUPERVISORS_LIST: &str = "query SupervisorsListForCamp($campBusinessId: ID!, $chunk: Chunk) {
  supervisorsListForCamp(campBusinessId: $campBusinessId, chunk: $chunk) {
    content { businessId involvementType }
    totalElements totalPages number size
  }
}";

pub const Q_PARTICIPANTS_LIST: &str = "query ParticipantsListForCamp($campBusinessId: ID!, $chunk: Chunk) {
  participantsListForCamp(campBusinessId: $campBusinessId, chunk: $chunk) {
    content { businessId targetAudienceGroup }
    totalElements totalPages number size
  }
}";

/// «Personen» tab (ADR 0009, red zone, read-only): the participants list WITH the person fields needed
/// for the MiData reconciliation. Same operation name and root field as the counting query. Only
/// fields present in the captured operations; `privateAddress` and AHV are deliberately NOT requested.
pub const Q_PERSONS_PARTICIPANTS: &str = "query ParticipantsListForCamp($campBusinessId: ID!, $chunk: Chunk) {
  participantsListForCamp(campBusinessId: $campBusinessId, chunk: $chunk) {
    content { businessId targetAudienceGroup person { businessId personNumber firstName lastName birthDate } }
    totalElements totalPages number size
  }
}";

/// Supervisors counterpart of [`Q_PERSONS_PARTICIPANTS`] (`involvementType` instead of `targetAudienceGroup`).
pub const Q_PERSONS_SUPERVISORS: &str = "query SupervisorsListForCamp($campBusinessId: ID!, $chunk: Chunk) {
  supervisorsListForCamp(campBusinessId: $campBusinessId, chunk: $chunk) {
    content { businessId involvementType person { businessId personNumber firstName lastName birthDate } }
    totalElements totalPages number size
  }
}";

/// Rega registration status of participants. `privateAddress` (present in the captured operation) is
/// deliberately NOT requested.
pub const Q_REGA_PARTICIPANTS: &str = "query RegaParticipantsListForCamp($campBusinessId: ID!, $chunk: Chunk) {
  regaParticipantsListForCamp(campBusinessId: $campBusinessId, chunk: $chunk) {
    content { businessId person { businessId personNumber firstName lastName birthDate } transmittedToRega }
    totalElements totalPages number size
  }
}";

/// Supervisors counterpart of [`Q_REGA_PARTICIPANTS`].
pub const Q_REGA_SUPERVISORS: &str = "query RegaSupervisorsListForCamp($campBusinessId: ID!, $chunk: Chunk) {
  regaSupervisorsListForCamp(campBusinessId: $campBusinessId, chunk: $chunk) {
    content { businessId person { businessId personNumber firstName lastName birthDate } transmittedToRega }
    totalElements totalPages number size
  }
}";

pub const Q_RENTAL_ORDERS: &str = "query rentalMaterialOrderListForCamp($campBusinessId: ID!, $chunk: Chunk, $filter: SpecificOrderFilter) {
  rentalMaterialOrderListForCamp(campBusinessId: $campBusinessId, chunk: $chunk, filter: $filter) {
    content { businessId orderState dispatchmentDate returnDate }
    totalElements totalPages number size
  }
}";

/// Message of the «session expired» error (HTTP 401/403 or redirect to the login).
pub const SESSION_EXPIRED_MSG: &str = "NDS-Sitzung abgelaufen – bitte erneut anmelden";

/// True when an HTTP status means the NDS session is gone (401/403, or a redirect to the login).
pub fn is_session_expired_status(status: u16) -> bool {
    matches!(status, 401 | 403) || (300..400).contains(&status)
}

/// Rejects GraphQL documents that are not queries (mutations/subscriptions are never sent).
pub fn ensure_query_only(document: &str) -> Result<(), CoreError> {
    let cleaned: String =
        document.lines().filter(|l| !l.trim_start().starts_with('#')).collect::<Vec<_>>().join("\n");
    let lower = cleaned.trim_start().to_ascii_lowercase();
    let starts_ok = lower.starts_with("query") || lower.starts_with('{');
    let has_def = Regex::new(r"(?im)^\s*(mutation|subscription)\b").expect("static regex").is_match(&cleaned);
    if !starts_ok || has_def {
        return Err(CoreError::Invalid("NDS: nur lesende GraphQL-Abfragen sind erlaubt".into()));
    }
    Ok(())
}

/// Builds the GraphQL request body `{operationName, variables, query}`.
pub fn graphql_body(operation_name: &str, variables: Value, query: &str) -> Result<Value, CoreError> {
    ensure_query_only(query)?;
    if operation_name.is_empty() || !operation_name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_') {
        return Err(CoreError::Invalid("NDS: ungültiger Operationsname".into()));
    }
    Ok(serde_json::json!({ "operationName": operation_name, "variables": variables, "query": query }))
}

/// Variables for a chunked list query (`page` is 0-based).
pub fn chunk_variables(extra: Value, size: u32, page: u32) -> Value {
    let mut vars = match extra {
        Value::Object(m) => m,
        _ => serde_json::Map::new(),
    };
    vars.insert("chunk".into(), serde_json::json!({ "size": size, "page": page, "sort": [] }));
    Value::Object(vars)
}

/// Extracts `data` of a GraphQL response; `errors` (HTTP 200) become a German error without data.
pub fn graphql_data(response: &Value) -> Result<&Value, CoreError> {
    if let Some(errors) = response.get("errors").and_then(Value::as_array).filter(|e| !e.is_empty()) {
        // Only the count and a machine code, never the server's message text (may echo data).
        let code = errors
            .first()
            .and_then(|e| e.pointer("/extensions/classification").or_else(|| e.pointer("/extensions/code")))
            .and_then(Value::as_str)
            .filter(|c| c.len() <= 40 && c.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'))
            .map(|c| format!(", {c}"))
            .unwrap_or_default();
        return Err(CoreError::Invalid(format!("NDS meldete GraphQL-Fehler ({}{code})", errors.len())));
    }
    match response.get("data") {
        Some(d) if d.is_object() => Ok(d),
        _ => Err(CoreError::Invalid("NDS-Antwort enthält keine Daten".into())),
    }
}

/// Parses a chunked list page: `(items, total_pages)` from `{content, totalPages, ...}`.
pub fn parse_chunk(list: &Value) -> Result<(Vec<Value>, u32), CoreError> {
    let content = list
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| CoreError::Invalid("NDS-Liste ohne Inhalt".into()))?;
    let pages = list.get("totalPages").and_then(Value::as_u64).unwrap_or(1).min(u32::MAX as u64) as u32;
    Ok((content.clone(), pages))
}

/// Merges already collected list items into a list document `{content: [...]}` for reduction.
pub fn list_document(items: Vec<Value>) -> Value {
    serde_json::json!({ "content": items })
}

// ------------------------------------------------------------------ Pendenzen (tasks)

pub const OP_PERSON_TASKS: &str = "PersonTaskList";

/// Coach tasks («Pendenzen») with deadlines. Deliberately NOT requested: `assignee` (names) and
/// `assigneeTeam`. The `$filter` variable is left unset: no open-tasks filter field is documented
/// in the spec, so completed tasks are filtered client-side via `processingStatus`.
pub const Q_PERSON_TASKS: &str = "query PersonTaskList($chunk: Chunk, $filter: PersonTaskFilter) {
  personTaskList(chunk: $chunk, filter: $filter) {
    content { businessId title { de fr it } correlation { correlationTitle { de fr it } } processingStatus dueDate escalationDate }
    totalElements totalPages number size
  }
}";

/// One NDS task, reduced to what the Fristen radar needs (no assignee). Red zone: memory only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsTask {
    pub business_id: String,
    pub title: String,
    pub correlation_title: Option<String>,
    /// YYYY-MM-DD
    pub due_date: Option<String>,
    /// YYYY-MM-DD
    pub escalation_date: Option<String>,
    pub processing_status: Option<String>,
}

/// Valid `YYYY-MM-DD` prefix (month 1-12, day 1-31) or `None`.
fn valid_date_of(v: &Value, key: &str) -> Option<String> {
    let d = date_of(v, key)?;
    let m: u32 = d[5..7].parse().ok()?;
    let day: u32 = d[8..10].parse().ok()?;
    ((1..=12).contains(&m) && (1..=31).contains(&day)).then_some(d)
}

/// German text of a `{de, fr, it}` object, falling back to fr, then it.
fn localized(v: Option<&Value>) -> Option<String> {
    let v = v?;
    ["de", "fr", "it"].iter().find_map(|k| text(v, k)).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Reduces raw `personTaskList` items (array or `{content: [...]}`) to [`NdsTask`]s. Items
/// without id or title are skipped; assignee data is never read.
pub fn parse_person_tasks(raw: &Value) -> Vec<NdsTask> {
    items_of(raw)
        .iter()
        .filter_map(|it| {
            let business_id = text(it, "businessId")?;
            let title = localized(it.get("title"))?;
            let correlation_title = localized(it.pointer("/correlation/correlationTitle"));
            Some(NdsTask {
                business_id,
                title,
                correlation_title,
                due_date: valid_date_of(it, "dueDate"),
                escalation_date: valid_date_of(it, "escalationDate"),
                processing_status: text(it, "processingStatus"),
            })
        })
        .collect()
}

// ------------------------------------------------------------------ helpers

fn text(v: &Value, key: &str) -> Option<String> {
    match v.get(key)? {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn count(v: &Value, key: &str) -> Option<u32> {
    v.get(key)?.as_u64().map(|n| n.min(u32::MAX as u64) as u32)
}

/// `YYYY-MM-DD` prefix of a date or date-time string.
fn date_part(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let ok = b.len() >= 10
        && b[..10].iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
        && (b.len() == 10 || !b[10].is_ascii_digit());
    ok.then(|| s[..10].to_string())
}

fn date_of(v: &Value, key: &str) -> Option<String> {
    v.get(key)?.as_str().and_then(date_part)
}

/// `(first, last)` of a `duration {first,last}` object; `last` falls back to `first`.
fn duration(v: &Value) -> (Option<String>, Option<String>) {
    let d = v.get("duration");
    let first = d.and_then(|d| date_of(d, "first"));
    let last = d.and_then(|d| date_of(d, "last")).or_else(|| first.clone());
    (first, last)
}

fn overlaps(start: &Option<String>, end: &Option<String>, from: &str, to: &str) -> bool {
    match (start, end) {
        (Some(s), Some(e)) => s.as_str() <= to && e.as_str() >= from,
        _ => false,
    }
}

fn items_of(v: &Value) -> &[Value] {
    match v {
        Value::Array(a) => a,
        _ => v.get("content").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]),
    }
}

fn tally(items: &[Value], key: &str) -> BTreeMap<String, u32> {
    let mut out = BTreeMap::new();
    for it in items {
        *out.entry(text(it, key).unwrap_or_else(|| "UNKNOWN".to_string())).or_insert(0) += 1;
    }
    out
}

fn counts_of(v: Option<&Value>) -> NdsCounts {
    let Some(v) = v else { return NdsCounts::default() };
    NdsCounts {
        children: count(v, "numberOfChildren"),
        adolescents: count(v, "numberOfAdolescents"),
        total_participants: count(v, "totalNumberOfParticipants"),
        total_instructors: count(v, "totalNumberOfInstructors"),
        js_instructors: count(v, "numberOfJsInstructors"),
        camp_days: count(v, "numberOfCampDays"),
        total_activities: count(v, "totalNumberOfActivities"),
    }
}

/// Activity states that mean «attendance check still open». Only known codes count: an unknown
/// state never produces an AWK reminder. (ATTENDANCE_OPEN is inferred from the option name
/// `setFromNotDoneToAttendanceOpen` in the spec, not observed as a value.)
const ATTENDANCE_OPEN_STATES: [&str; 1] = ["ATTENDANCE_OPEN"];

/// `(offerBusinessId, offerNumber, offerState)` of an offer.
pub type NdsOfferRef = (String, Option<String>, Option<String>);

/// Parses OfferList items, keeping offers whose duration overlaps `[from, to]` (YYYY-MM-DD).
/// Returns `(offerBusinessId, offerNumber, offerState)`.
pub fn parse_offers_overlapping(
    offers: &[Value],
    from: &str,
    to: &str,
) -> Result<Vec<NdsOfferRef>, CoreError> {
    let mut out = Vec::new();
    for o in offers {
        let Some(id) = text(o, "businessId") else { continue };
        let (s, e) = duration(o);
        if overlaps(&s, &e, from, to) {
            out.push((id, text(o, "offerNumber"), text(o, "offerState")));
        }
    }
    Ok(out)
}

/// Parses CampList items of one offer, keeping camps overlapping `[from, to]`.
pub fn parse_camps_overlapping(
    offer_business_id: &str,
    offer_number: Option<&str>,
    offer_state: Option<&str>,
    camps: &[Value],
    from: &str,
    to: &str,
) -> Result<Vec<NdsCampSummary>, CoreError> {
    let mut out = Vec::new();
    for c in camps {
        let Some(id) = text(c, "businessId") else { continue };
        let (start, end) = duration(c);
        if !overlaps(&start, &end, from, to) {
            continue;
        }
        out.push(NdsCampSummary {
            offer_business_id: offer_business_id.to_string(),
            camp_business_id: id,
            offer_number: offer_number.map(str::to_string),
            offer_item_number: text(c, "offerItemNumber"),
            group_name: text(c, "groupName"),
            start,
            end,
            offer_state: offer_state.map(str::to_string),
            offer_item_state: text(c, "offerItemState"),
        });
    }
    Ok(out)
}

/// Reduces the raw documents of one camp to an [`NdsAggregate`]. The list arguments are list
/// documents (`{content: [...]}` or a plain array, see [`list_document`]).
pub fn reduce_aggregate(raw: &RawNdsCamp<'_>) -> Result<NdsAggregate, CoreError> {
    let camp = raw.camp_details;
    if !camp.is_object() {
        return Err(CoreError::Invalid("NDS-Antwort ohne Lagerdetails".into()));
    }
    let offer = raw.offer_details;
    let (c_start, c_end) = duration(camp);
    let (o_start, o_end) = duration(offer);
    let approved_on = date_of(camp, "approvalTimestamp").or_else(|| date_of(offer, "approvalTimestamp"));

    let planned = raw.statistics.get("planned");
    let actual = raw.statistics.get("actual");
    let coach_auth = |v: Option<&Value>| v.and_then(|v| v.get("coachAuthorizedForContribution")?.as_bool());
    let statistics = NdsStatistics {
        planned: counts_of(planned),
        actual: counts_of(actual),
        coach_authorized_for_contribution: coach_auth(actual).or_else(|| coach_auth(planned)),
    };

    let supervisors = items_of(raw.supervisors);
    let participants = items_of(raw.participants);
    let acts = items_of(raw.activities);
    let activities = NdsActivities {
        total: acts.len() as u32,
        by_state: tally(acts, "activityState"),
        by_type: tally(acts, "activityType"),
        last_activity_date: acts.iter().filter_map(|a| date_of(a, "activityDate")).max(),
        attendance_open_count: acts
            .iter()
            .filter(|a| text(a, "activityState").is_some_and(|s| ATTENDANCE_OPEN_STATES.contains(&s.as_str())))
            .count() as u32,
    };
    let rental_orders = items_of(raw.rental_orders)
        .iter()
        .map(|o| NdsRentalOrder {
            order_state: text(o, "orderState"),
            dispatchment_date: date_of(o, "dispatchmentDate"),
            return_date: date_of(o, "returnDate"),
        })
        .collect();

    Ok(NdsAggregate {
        offer_business_id: raw.offer_business_id.to_string(),
        camp_business_id: raw.camp_business_id.to_string(),
        offer_number: text(offer, "offerNumber"),
        start: c_start.or(o_start),
        end: c_end.or(o_end),
        offer_state: text(offer, "offerState"),
        offer_item_state: text(camp, "offerItemState"),
        approved_on,
        statistics,
        supervisor_counts: tally(supervisors, "involvementType"),
        participant_count: participants.len() as u32,
        participant_counts_by_audience: tally(participants, "targetAudienceGroup"),
        activities,
        camp_agenda_uploaded: Some(camp.get("campAgenda").is_some_and(|a| !a.is_null())),
        rental_orders,
        rega: None,
        fetched_at: raw.fetched_at.to_string(),
    })
}

fn tally_rega(pages: &[Value]) -> (u32, u32) {
    let (mut total, mut sent) = (0u32, 0u32);
    for item in pages.iter().flat_map(items_of) {
        total += 1;
        if item.get("transmittedToRega").and_then(Value::as_bool) == Some(true) {
            sent += 1;
        }
    }
    (total, sent)
}

/// Reduces the Rega list pages (`{content: [...]}` or plain arrays) to counts. Counts only.
pub fn reduce_rega_counts(participant_pages: &[Value], supervisor_pages: &[Value]) -> RegaCounts {
    let (participants_total, participants_transmitted) = tally_rega(participant_pages);
    let (supervisors_total, supervisors_transmitted) = tally_rega(supervisor_pages);
    RegaCounts { participants_total, participants_transmitted, supervisors_total, supervisors_transmitted }
}

/// Key prefix of [`rega_transmitted_map`] entries keyed by NDS person `businessId`.
pub const REGA_KEY_ID: &str = "id:";
/// Key prefix of [`rega_transmitted_map`] entries keyed by `personNumber` (own namespace: both id spaces are
/// numeric strings and may overlap).
pub const REGA_KEY_NR: &str = "nr:";

/// Per-person Rega state for the persons path: `id:<person businessId>` and `nr:<personNumber>` -> transmitted.
/// Items without a person or without a boolean `transmittedToRega` are skipped. Red zone: stays in Rust.
pub fn rega_transmitted_map(pages: &[Value]) -> BTreeMap<String, bool> {
    let mut out = BTreeMap::new();
    for item in pages.iter().flat_map(items_of) {
        let (Some(person), Some(sent)) =
            (item.get("person").filter(|p| p.is_object()), item.get("transmittedToRega").and_then(Value::as_bool))
        else {
            continue;
        };
        for (key, prefix) in [("businessId", REGA_KEY_ID), ("personNumber", REGA_KEY_NR)] {
            if let Some(id) = text(person, key) {
                out.insert(format!("{prefix}{id}"), sent);
            }
        }
    }
    out
}

/// Which expected field paths are present / missing in a JSON document (names only, never values).
/// Paths use `.` for nesting and `[]` for «first array element», e.g. `content[].activityType`.
pub fn probe_fields(doc: &Value, expected: &[&str]) -> (Vec<String>, Vec<String>) {
    fn resolve<'a>(doc: &'a Value, path: &str) -> Option<&'a Value> {
        let mut cur = doc;
        for seg in path.split('.') {
            let (key, first) = match seg.strip_suffix("[]") {
                Some(k) => (k, true),
                None => (seg, false),
            };
            if !key.is_empty() {
                cur = cur.get(key)?;
            }
            if first {
                cur = cur.as_array()?.first()?;
            }
        }
        (!cur.is_null()).then_some(cur)
    }
    let (mut present, mut missing) = (Vec::new(), Vec::new());
    for p in expected {
        if resolve(doc, p).is_some() {
            present.push((*p).to_string());
        } else {
            missing.push((*p).to_string());
        }
    }
    (present, missing)
}
