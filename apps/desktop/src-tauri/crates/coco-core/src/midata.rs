//! MiData (hitobito JSON:API v1, e.g. https://db.scout.ch) – pure parsing and
//! reduction to aggregates (M7, red zone).
//!
//! Red-zone rule: raw MiData person data (birthdays, full names, AHV, health …)
//! never leaves this module. Callers hand in raw JSON:API documents and get a
//! [`MidataAggregate`] back: counts, age band, leaders as nickname +
//! qualification yes/no, coach match. Only that aggregate is serialized to the
//! UI. Error messages never contain person data or tokens.
//!
//! CONTRACT (M7): the signatures and serialized shapes below are shared with
//! `src-tauri/src/midata.rs` and `apps/desktop/src/domain/types.ts`
//! (`MidataAggregate`, `MidataEventSummary`, `MidataProbe`, `MidataStatus`).
//! Do not change them without updating both sides.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::CoreError;

/// Default MiData instance (PBS).
pub const DEFAULT_MIDATA_BASE_URL: &str = "https://db.scout.ch";
/// JSON:API media type sent as `Accept`.
pub const JSONAPI_ACCEPT: &str = "application/vnd.api+json";
/// hitobito session cookie name (session auth).
pub const SESSION_COOKIE: &str = "_session_id";

/// Qualification categories co-co checks. Serialized camelCase:
/// `lagerleiter`, `leiterLsT`, `wasser`, `berg`, `winter`, `slrg`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QualKey {
    /// J+S «Zusatz Lagerleiter» (JS-LL-01).
    Lagerleiter,
    /// J+S Leiter*in Lagersport/Trekking (LS/T).
    LeiterLsT,
    /// LS/T module/Sicherheitsbereich Wasser.
    Wasser,
    /// LS/T module/Sicherheitsbereich Berg.
    Berg,
    /// LS/T module/Sicherheitsbereich Winter.
    Winter,
    /// SLRG brevet / module (BP-WATER-01).
    Slrg,
}

pub const ALL_QUAL_KEYS: [QualKey; 6] =
    [QualKey::Lagerleiter, QualKey::LeiterLsT, QualKey::Wasser, QualKey::Berg, QualKey::Winter, QualKey::Slrg];

/// Age band of participants at camp start (inclusive bounds; `to` = None means open-ended).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgeBand {
    pub from: u32,
    pub to: Option<u32>,
    pub count: u32,
}

/// Fixed band boundaries used for `age_bands` (from, to): 0–4, 5–6, 7–10, 11–14, 15–17, 18–20, 21+.
pub const AGE_BANDS: [(u32, Option<u32>); 7] =
    [(0, Some(4)), (5, Some(6)), (7, Some(10)), (11, Some(14)), (15, Some(17)), (18, Some(20)), (21, None)];

/// One leader (participation with a leader role). `nickname` is yellow-zone
/// (falls back to first name; never the full name). Qualifications are yes/no,
/// valid over the whole camp period. `qualifications` always has all 6 keys.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidataLeader {
    pub nickname: String,
    /// Event role label as shown by MiData (e.g. «Hauptleitung», «Leitung»).
    pub role_label: String,
    pub qualifications: std::collections::BTreeMap<QualKey, bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventDate {
    /// YYYY-MM-DD
    pub start_at: String,
    /// YYYY-MM-DD (same as start when MiData has none)
    pub finish_at: String,
}

/// The ONLY MiData-derived structure that crosses to the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidataAggregate {
    /// Always "red-derived".
    pub zone: String,
    pub base_url: String,
    pub event_id: String,
    pub event_name: String,
    pub event_dates: Vec<EventDate>,
    pub location: Option<String>,
    pub maximum_participants: Option<u32>,
    pub participants_count: u32,
    /// Participants aged 5..=20 at camp start (J+S age).
    pub participants_js_age_count: u32,
    pub participants_without_birthday: u32,
    pub min_age: Option<u32>,
    pub max_age: Option<u32>,
    pub age_bands: Vec<AgeBand>,
    pub leaders_count: u32,
    pub leaders: Vec<MidataLeader>,
    /// event.advisor_id == coach person id; None when either is unknown.
    pub coach_match: Option<bool>,
    /// RFC 3339 UTC timestamp («Stand MiData»), set by the caller.
    pub fetched_at: String,
}

/// Event list entry for the «Anlass wählen» picker (yellow: names only, no persons).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidataEventSummary {
    pub id: String,
    pub name: String,
    pub start_at: Option<String>,
    pub finish_at: Option<String>,
    pub location: Option<String>,
}

/// Result of the M7-0 spike probe. Contains field NAMES and HTTP status codes only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidataProbe {
    pub auth_method: Option<String>,
    pub event_status: u16,
    pub participations_status: u16,
    pub participations_readable: bool,
    pub people_birthday_readable: bool,
    pub qualifications_status: u16,
    /// Status of the classic `/groups/{g}/events/{e}.json` export (None when no group id).
    pub classic_json_status: Option<u16>,
    /// PBS camp field names found in the classic export (e.g. "coach", "camp_submitted").
    pub pbs_fields_present: Vec<String>,
    /// Top-level attribute names of the classic export event object (names only).
    pub classic_attribute_names: Vec<String>,
}

/// Login state of the MiData connection. Never contains cookie/token values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidataStatus {
    pub connected: bool,
    pub base_url: Option<String>,
    /// "session" (login window) or "token" (service token from the keychain).
    pub method: Option<String>,
    pub cookie_names: Vec<String>,
}

/// Inputs for [`reduce_aggregate`]: raw JSON:API documents as returned by MiData.
pub struct RawEventData<'a> {
    pub base_url: &'a str,
    /// `GET /api/events/{id}?include=dates`
    pub event: &'a Value,
    /// All pages of `GET /api/event_participations?filter[event_id]=..&include=person,roles`
    pub participation_pages: &'a [Value],
    /// All pages of `GET /api/qualifications?filter[person_id]=..&include=qualification_kind`
    pub qualification_pages: &'a [Value],
    /// Camp period from eCamp (YYYY-MM-DD), used for ages and qualification validity.
    pub camp_start: &'a str,
    pub camp_end: &'a str,
    /// Logged-in coach's MiData person id (from settings), for `coach_match`.
    pub coach_person_id: Option<&'a str>,
    /// RFC 3339 timestamp to put into `fetched_at`.
    pub fetched_at: &'a str,
}

/// Validates and normalizes a MiData base URL: https only (http only for
/// loopback hosts), no path/query/fragment/credentials. Returns e.g. "https://db.scout.ch".
pub fn normalize_midata_base_url(input: &str) -> Result<String, CoreError> {
    let _ = input;
    todo!("M7-1: implement")
}

/// Classifies an event role `type` (e.g. "Event::Camp::Role::Leader",
/// "Event::Role::Participant", "Event::Camp::Role::AssistantLeader",
/// "Event::Role::Cook") into leader / participant / other.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoleClass {
    Leader,
    Participant,
    Other,
}

pub fn classify_role(role_type: &str) -> RoleClass {
    let _ = role_type;
    todo!("M7-1: implement")
}

/// Maps a qualification-kind label (German, as in MiData) to co-co categories.
/// Case-insensitive keyword matching; one label may map to several keys.
pub fn qual_keys_for_label(label: &str) -> Vec<QualKey> {
    let _ = label;
    todo!("M7-1: implement")
}

/// Age in full years on `on` (YYYY-MM-DD) for a birthday (YYYY-MM-DD). None if unparsable or in the future.
pub fn age_on(birthday: &str, on: &str) -> Option<u32> {
    let _ = (birthday, on);
    todo!("M7-1: implement")
}

/// Parses an events list document into picker entries.
pub fn parse_event_list(doc: &Value) -> Result<Vec<MidataEventSummary>, CoreError> {
    let _ = doc;
    todo!("M7-1: implement")
}

/// Person ids (as strings) of all participations with a leader role, for the qualifications query.
pub fn leader_person_ids(participation_pages: &[Value]) -> Vec<String> {
    let _ = participation_pages;
    todo!("M7-1: implement")
}

/// `links.next` of a JSON:API document, if any (absolute URL as given by MiData).
pub fn next_link(doc: &Value) -> Option<String> {
    let _ = doc;
    todo!("M7-1: implement")
}

/// Reduces raw MiData documents to the aggregate. Pure; never logs.
pub fn reduce_aggregate(raw: &RawEventData<'_>) -> Result<MidataAggregate, CoreError> {
    let _ = raw;
    todo!("M7-1: implement")
}

/// Extracts PBS camp field names present in a classic event JSON export
/// (`/groups/{g}/events/{e}.json`). Returns (pbs_fields_present, attribute_names). Names only.
pub fn probe_classic_fields(doc: &Value) -> (Vec<String>, Vec<String>) {
    let _ = doc;
    todo!("M7-0: implement")
}
