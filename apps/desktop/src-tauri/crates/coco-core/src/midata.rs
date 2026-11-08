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
use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde_json::Value;
use url::Url;

use crate::cookies::RawCookie;
use crate::CoreError;

/// Default MiData instance (PBS).
pub const DEFAULT_MIDATA_BASE_URL: &str = "https://db.scout.ch";
/// JSON:API media type sent as `Accept`.
pub const JSONAPI_ACCEPT: &str = "application/vnd.api+json";
/// hitobito session cookie name (session auth).
pub const SESSION_COOKIE: &str = "_session_id";

/// Qualification categories co-co checks. Serialized camelCase:
/// `lagerleiter`, `leiterLsT`, `wasser`, `berg`, `winter`, `slrg` (legacy) and the rules-v2 keys
/// `sbBerg`, `sbWasser`, `sbWinter`, `waterBath`, `waterPoolUnsupervised`, `waterLake`, `waterRiver`.
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
    /// Rules v2: Sicherheitsbereich Berg.
    SbBerg,
    /// Rules v2: Sicherheitsbereich Wasser.
    SbWasser,
    /// Rules v2: Sicherheitsbereich Winter.
    SbWinter,
    /// Rules v2: qualified for supervised bathing.
    WaterBath,
    /// Rules v2: qualified for unsupervised pool.
    WaterPoolUnsupervised,
    /// Rules v2: qualified for unsupervised lake.
    WaterLake,
    /// Rules v2: qualified for swimming in a river.
    WaterRiver,
}

pub const ALL_QUAL_KEYS: [QualKey; 13] = [
    QualKey::Lagerleiter,
    QualKey::LeiterLsT,
    QualKey::Wasser,
    QualKey::Berg,
    QualKey::Winter,
    QualKey::Slrg,
    QualKey::SbBerg,
    QualKey::SbWasser,
    QualKey::SbWinter,
    QualKey::WaterBath,
    QualKey::WaterPoolUnsupervised,
    QualKey::WaterLake,
    QualKey::WaterRiver,
];

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
/// valid over the whole camp period. `qualifications` has all keys (older stored aggregates may lack the v2 keys).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidataLeader {
    pub nickname: String,
    /// Event role label as shown by MiData (e.g. «Hauptleitung», «Leitung»).
    pub role_label: String,
    /// Main leader (Hauptleitung, role type `...::Leader`); false for assistants and security leaders.
    #[serde(default)]
    pub main_leader: bool,
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
    /// Participants with J+S age by Jahrgang: camp start year minus birth year in 5..=20.
    pub participants_js_age_count: u32,
    pub participants_without_birthday: u32,
    /// Participants per birth year (Jahrgang). Aggregate only, never names or birthdates.
    #[serde(default)]
    pub participants_by_birth_year: BTreeMap<u32, u32>,
    pub min_age: Option<u32>,
    pub max_age: Option<u32>,
    pub age_bands: Vec<AgeBand>,
    pub leaders_count: u32,
    pub leaders: Vec<MidataLeader>,
    /// Coach (participation with role `Event::Camp::Role::Coach`) person id == `coach_person_id`;
    /// without a coach participation: event.advisor_id == coach person id; None when unknown.
    pub coach_match: Option<bool>,
    /// Nickname (else first name, never last name) of the coach participation; None when there is none.
    #[serde(default)]
    pub coach_nickname: Option<String>,
    /// False when the qualifications request was refused (401/403) or failed: all qualification
    /// cells are then false because they are UNKNOWN, not because nobody is qualified.
    #[serde(default = "default_true")]
    pub qualifications_readable: bool,
    /// Every distinct qualification-kind label found among the leaders' qualifications (no personal data).
    #[serde(default)]
    pub qualification_kinds: Vec<QualKindInfo>,
    /// RFC 3339 UTC timestamp («Stand MiData»), set by the caller.
    pub fetched_at: String,
}

fn default_true() -> bool {
    true
}

/// One qualification-kind label held by leaders, with the co-co keys it maps to and how many
/// leaders hold it valid over the camp period vs. only expired / not yet valid.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualKindInfo {
    pub label: String,
    pub keys: Vec<QualKey>,
    pub valid_leaders: u32,
    pub expired_leaders: u32,
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
    /// Names of the organisations (groups) running the event; empty when unknown.
    #[serde(default)]
    pub group_names: Vec<String>,
    /// Days overlapping the eCamp camp period; None when unknown (set by `rank_events`).
    #[serde(default)]
    pub overlap_days: Option<u32>,
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
    /// MiData person id of the signed-in user when detected from `/people/<id>` URLs.
    #[serde(default)]
    pub person_id: Option<String>,
}

/// Picks the hitobito session cookie (`_session_id`, non-empty value) from a cookie list.
pub fn pick_session_cookie(cookies: &[RawCookie]) -> Option<&RawCookie> {
    cookies.iter().find(|c| c.name == SESSION_COOKIE && !c.value.is_empty())
}

/// Person id from a hitobito URL path such as `/groups/1/people/123` or `/people/123.json`.
/// Takes the last `/people/<digits>` segment pair; None otherwise.
pub fn person_id_from_path(path: &str) -> Option<String> {
    let segs: Vec<&str> = path.split('/').collect();
    let mut found = None;
    for w in segs.windows(2) {
        if w[0] == "people" {
            let digits: String = w[1].chars().take_while(char::is_ascii_digit).collect();
            let rest = &w[1][digits.len()..];
            if !digits.is_empty() && (rest.is_empty() || rest.starts_with('.')) {
                found = Some(digits);
            }
        }
    }
    found
}

/// Inputs for [`reduce_aggregate`]: raw JSON:API documents as returned by MiData.
pub struct RawEventData<'a> {
    pub base_url: &'a str,
    /// `GET /api/events/{id}?include=dates`
    pub event: &'a Value,
    /// All pages of `GET /api/event_participations?filter[event_id][eq]=..&include=participant,roles`
    pub participation_pages: &'a [Value],
    /// All pages of `GET /api/qualifications?filter[person_id][eq]=..&include=qualification_kind`
    pub qualification_pages: &'a [Value],
    /// Camp period from eCamp (YYYY-MM-DD), used for ages and qualification validity.
    pub camp_start: &'a str,
    pub camp_end: &'a str,
    /// Logged-in coach's MiData person id (from settings), for `coach_match`.
    pub coach_person_id: Option<&'a str>,
    /// RFC 3339 timestamp to put into `fetched_at`.
    pub fetched_at: &'a str,
    /// False when the qualifications request was refused (401/403) or failed; the pages are then ignored.
    pub qualifications_readable: bool,
    /// User mapping `label -> keys` (label compared trimmed and case-insensitive). An entry REPLACES the
    /// built-in keyword mapping for that label; an empty list means "ignore this label".
    pub qual_mapping: Option<&'a HashMap<String, Vec<QualKey>>>,
}

/// Validates and normalizes a MiData base URL: https only (http only for
/// loopback hosts), no path/query/fragment/credentials. Returns e.g. "https://db.scout.ch".
pub fn normalize_midata_base_url(input: &str) -> Result<String, CoreError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(CoreError::InvalidUrl("leer".into()));
    }
    let with_scheme = if trimmed.contains("://") { trimmed.to_string() } else { format!("https://{trimmed}") };
    let url = Url::parse(&with_scheme).map_err(|e| CoreError::InvalidUrl(e.to_string()))?;
    crate::instance::validate_remote_url(&url)?;
    if !url.path().trim_matches('/').is_empty() || url.query().is_some() || url.fragment().is_some() {
        return Err(CoreError::InvalidUrl("Pfad, Query und Fragment sind nicht erlaubt".into()));
    }
    Ok(url.origin().ascii_serialization())
}

/// Classifies an event role `type` (e.g. "Event::Camp::Role::Leader",
/// "Event::Role::Participant", "Event::Camp::Role::AssistantLeader",
/// "Event::Role::Cook") into leader / participant / other.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoleClass {
    Leader,
    Participant,
    /// PBS restricted role `Event::Camp::Role::Coach`.
    Coach,
    Other,
}

/// Mapping (by last `::` segment of the role type):
/// - `Leader`, `AssistantLeader` and any segment starting with `Leader`
///   (PBS: `LeaderMountainSecurity`, `LeaderSnowSecurity`, `LeaderWaterSecurity`) -> Leader
/// - `Participant` -> Participant
/// - `Coach` -> Coach (not a leader, not a participant); the restricted `Advisor*` roles
///   (`AdvisorMountainSecurity`, `AdvisorSnowSecurity`, `AdvisorWaterSecurity`) -> Other
/// - everything else (Cook, Helper, Treasurer, Speaker, Kitchen, ...) -> Other
pub fn classify_role(role_type: &str) -> RoleClass {
    let last = role_type.rsplit("::").next().unwrap_or("").trim();
    if last == "Participant" {
        RoleClass::Participant
    } else if last == "Coach" {
        RoleClass::Coach
    } else if last == "AssistantLeader" || last.starts_with("Leader") {
        RoleClass::Leader
    } else {
        RoleClass::Other
    }
}

fn fold_label(label: &str) -> String {
    label
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'ä' | 'à' | 'á' | 'â' => 'a',
            'ö' | 'ò' | 'ó' | 'ô' => 'o',
            'ü' | 'ù' | 'ú' | 'û' => 'u',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'ï' | 'î' | 'ì' => 'i',
            other => other,
        })
        .collect()
}

/// Maps a qualification-kind label (German, as in MiData) to co-co categories.
/// Case-insensitive keyword matching; one label may map to several keys.
/// - Lagerleiter: `lagerleit`, `zusatz lager`
/// - LeiterLsT: `lagersport`, `trekking`, `ls/t`, token `lst`, `leiter*in j+s ls`, `j+s-leiter`
/// - Wasser: `wasser`, `modul see`, `modul fluss`
/// - Berg: `berg`; Winter: `winter`, `schnee`
/// - Slrg: `slrg`, `brevet`, `rettungsschwimm`, `modul pool`, `modul see`, `modul fluss`
///   (SLRG modules imply both Slrg and Wasser)
pub fn qual_keys_for_label(label: &str) -> Vec<QualKey> {
    let l = fold_label(label);
    let tokens: Vec<&str> = l.split(|c: char| !c.is_alphanumeric()).filter(|t| !t.is_empty()).collect();
    let has = |k: &str| l.contains(k);
    let mut out = Vec::new();
    if has("lagerleit") || has("zusatz lager") {
        out.push(QualKey::Lagerleiter);
    }
    if has("lagersport")
        || has("trekking")
        || has("ls/t")
        || tokens.contains(&"lst")
        || has("leiter*in j+s ls")
        || has("j+s-leiter")
    {
        out.push(QualKey::LeiterLsT);
    }
    if has("wasser") || has("modul see") || has("modul fluss") {
        out.push(QualKey::Wasser);
    }
    if has("berg") {
        out.push(QualKey::Berg);
    }
    if has("winter") || has("schnee") {
        out.push(QualKey::Winter);
    }
    if has("slrg") || has("brevet") || has("rettungsschwimm") || has("modul pool") || has("modul see") || has("modul fluss") {
        out.push(QualKey::Slrg);
    }
    // Rules v2 keys. Token sequences, so «Sicherheitsmodul Wasser» does not count as «Modul Wasser».
    let seq = |a: &str, b: &str| tokens.windows(2).any(|w| w[0] == a && w[1] == b);
    let sb = |area: &str| seq("sicherheitsbereich", area) || seq("sb", area);
    let (mut bath, mut pool, mut lake, mut river) = (false, false, false, false);
    if sb("berg") {
        out.push(QualKey::SbBerg);
    }
    if sb("wasser") {
        out.push(QualKey::SbWasser);
        river = true;
    }
    if sb("winter") {
        out.push(QualKey::SbWinter);
    }
    if seq("modul", "wasser") || seq("aufsichtsperson", "wasser") || seq("modul", "see") {
        (bath, pool, lake) = (true, true, true);
    }
    if seq("basis", "pool") {
        bath = true;
    }
    if seq("plus", "pool") {
        (bath, pool) = (true, true);
    }
    if seq("modul", "fluss") {
        river = true;
    }
    // J+S water sport leaders (Kanu, Rudern, Segeln, Triathlon, Windsurfen).
    if ["kanu", "rudern", "segeln", "triathlon", "windsurf"].iter().any(|w| tokens.iter().any(|t| t.starts_with(w))) {
        (bath, pool, lake) = (true, true, true);
    }
    for (on, k) in [
        (bath, QualKey::WaterBath),
        (pool, QualKey::WaterPoolUnsupervised),
        (lake, QualKey::WaterLake),
        (river, QualKey::WaterRiver),
    ] {
        if on {
            out.push(k);
        }
    }
    out
}

/// Like [`qual_keys_for_label`], but a user mapping entry for the label (trimmed, case-insensitive)
/// replaces the built-in keyword mapping (an empty list ignores the label).
pub fn qual_keys_with_mapping(label: &str, mapping: Option<&HashMap<String, Vec<QualKey>>>) -> Vec<QualKey> {
    let norm = label.trim().to_lowercase();
    if let Some(m) = mapping {
        if let Some((_, keys)) = m.iter().find(|(k, _)| k.trim().to_lowercase() == norm) {
            let mut v = keys.clone();
            v.sort();
            v.dedup();
            return v;
        }
    }
    qual_keys_for_label(label)
}

fn is_leap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

/// Parses `YYYY-MM-DD` (a longer ISO datetime is truncated). Validates ranges.
fn parse_date(s: &str) -> Option<(i32, u32, u32)> {
    let head = s.trim().get(..10)?;
    let b = head.as_bytes();
    if b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let y: i32 = head.get(..4)?.parse().ok()?;
    let m: u32 = head.get(5..7)?.parse().ok()?;
    let d: u32 = head.get(8..10)?.parse().ok()?;
    let dim = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap(y) {
                29
            } else {
                28
            }
        }
        _ => return None,
    };
    if d == 0 || d > dim {
        return None;
    }
    Some((y, m, d))
}

/// Normalizes a date or datetime string to `YYYY-MM-DD`, None if unparsable.
fn day_string(s: &str) -> Option<String> {
    parse_date(s).map(|(y, m, d)| format!("{y:04}-{m:02}-{d:02}"))
}

/// Age in full years on `on` (YYYY-MM-DD) for a birthday (YYYY-MM-DD). None if unparsable or in the future.
/// A Feb-29 birthday counts from Mar 1 in non-leap years.
pub fn age_on(birthday: &str, on: &str) -> Option<u32> {
    let (by, bm, bd) = parse_date(birthday)?;
    let (y, m, d) = parse_date(on)?;
    if (y, m, d) < (by, bm, bd) {
        return None;
    }
    let mut age = y - by;
    if (m, d) < (bm, bd) {
        age -= 1;
    }
    u32::try_from(age).ok()
}

fn id_str(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn str_attr(item: &Value, key: &str) -> Option<String> {
    item.get("attributes")?.get(key)?.as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from)
}

type Included = HashMap<(String, String), Value>;

/// Index of `included` resources by (type, id).
fn index_included(docs: &[&Value]) -> Included {
    let mut map = HashMap::new();
    for doc in docs {
        if let Some(arr) = doc.get("included").and_then(Value::as_array) {
            for item in arr {
                if let (Some(t), Some(id)) = (item.get("type").and_then(Value::as_str), item.get("id").and_then(id_str)) {
                    map.insert((t.to_string(), id), item.clone());
                }
            }
        }
    }
    map
}

/// Resource identifiers `[(type, id)]` of a to-one/to-many relationship.
fn rel_ids(item: &Value, rel: &str) -> Vec<(String, String)> {
    let Some(data) = item.get("relationships").and_then(|r| r.get(rel)).and_then(|r| r.get("data")) else {
        return Vec::new();
    };
    let one = |v: &Value| Some((v.get("type")?.as_str()?.to_string(), v.get("id").and_then(id_str)?));
    match data {
        Value::Array(a) => a.iter().filter_map(one).collect(),
        Value::Object(_) => one(data).into_iter().collect(),
        _ => Vec::new(),
    }
}

fn dates_of(item: &Value, included: &Included) -> Vec<EventDate> {
    let mut out = Vec::new();
    for key in rel_ids(item, "dates") {
        if let Some(d) = included.get(&key) {
            if let Some(start) = str_attr(d, "start_at").and_then(|s| day_string(&s)) {
                let finish = str_attr(d, "finish_at").and_then(|s| day_string(&s)).unwrap_or_else(|| start.clone());
                out.push(EventDate { start_at: start, finish_at: finish });
            }
        }
    }
    if out.is_empty() {
        if let Some(start) = str_attr(item, "start_at").and_then(|s| day_string(&s)) {
            let finish = str_attr(item, "finish_at").and_then(|s| day_string(&s)).unwrap_or_else(|| start.clone());
            out.push(EventDate { start_at: start, finish_at: finish });
        }
    }
    out.sort_by(|a, b| a.start_at.cmp(&b.start_at));
    out
}

/// Parses an events list document into picker entries (no type filtering).
pub fn parse_event_list(doc: &Value) -> Result<Vec<MidataEventSummary>, CoreError> {
    parse_event_list_filtered(doc, false)
}

/// Like `parse_event_list`; with `camp_only` drops events whose `type` attribute is present
/// and does not contain "Camp" (fallback when the server ignored the type filter).
pub fn parse_event_list_filtered(doc: &Value, camp_only: bool) -> Result<Vec<MidataEventSummary>, CoreError> {
    parse_event_list_with_groups(doc, camp_only, &HashMap::new())
}

/// Group ids (`attributes.group_ids`) of all events of the given list documents, deduped, in first-seen order.
pub fn event_group_ids(docs: &[Value]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for doc in docs {
        for item in doc.get("data").and_then(Value::as_array).into_iter().flatten() {
            for g in item.get("attributes").and_then(|a| a.get("group_ids")).and_then(Value::as_array).into_iter().flatten() {
                if let Some(id) = id_str(g) {
                    if !out.contains(&id) {
                        out.push(id);
                    }
                }
            }
        }
    }
    out
}

/// `group id -> name` from `GET /api/groups` documents (prefers `display_name`, else `name`).
pub fn group_names_by_id(docs: &[Value]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for doc in docs {
        for g in doc.get("data").and_then(Value::as_array).into_iter().flatten() {
            let Some(id) = g.get("id").and_then(id_str) else { continue };
            if let Some(name) = str_attr(g, "display_name").or_else(|| str_attr(g, "name")) {
                out.insert(id, name);
            }
        }
    }
    out
}

/// Like [`parse_event_list_filtered`]; organisation names come from `attributes.group_ids` mapped through `names`.
pub fn parse_event_list_with_groups(
    doc: &Value,
    camp_only: bool,
    names: &HashMap<String, String>,
) -> Result<Vec<MidataEventSummary>, CoreError> {
    let data = doc
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| CoreError::Invalid("MiData-Antwort enthält keine Anlassliste".into()))?;
    let included = index_included(&[doc]);
    let mut out = Vec::new();
    for item in data {
        let Some(id) = item.get("id").and_then(id_str) else { continue };
        if camp_only {
            if let Some(t) = str_attr(item, "type") {
                if !t.contains("Camp") {
                    continue;
                }
            }
        }
        let dates = dates_of(item, &included);
        let mut group_names: Vec<String> = Vec::new();
        for g in item.get("attributes").and_then(|a| a.get("group_ids")).and_then(Value::as_array).into_iter().flatten() {
            if let Some(name) = id_str(g).and_then(|id| names.get(&id).cloned()) {
                if !group_names.contains(&name) {
                    group_names.push(name);
                }
            }
        }
        out.push(MidataEventSummary {
            id,
            name: str_attr(item, "name").unwrap_or_default(),
            start_at: dates.iter().map(|d| d.start_at.clone()).min(),
            finish_at: dates.iter().map(|d| d.finish_at.clone()).max(),
            location: str_attr(item, "location"),
            group_names,
            overlap_days: None,
        });
    }
    Ok(out)
}

/// Days since a fixed epoch for a valid civil date (Howard Hinnant's algorithm).
fn day_number(s: &str) -> Option<i64> {
    let (y, m, d) = parse_date(s)?;
    let y = i64::from(y) - i64::from(m <= 2);
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = i64::from((m + 9) % 12);
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe)
}

/// Inclusive overlap in days of two date ranges; 0 when disjoint, None when a date is unparsable.
fn overlap_between(a: (&str, &str), b: (&str, &str)) -> Option<i64> {
    let (a0, a1, b0, b1) = (day_number(a.0)?, day_number(a.1)?, day_number(b.0)?, day_number(b.1)?);
    Some((a1.min(b1) - a0.max(b0) + 1).max(0))
}

/// Client-side filter and ranking of the picker list. Events that clearly do not overlap
/// `[from, to]` are dropped; events without dates are kept at the end. `overlap_days` is the overlap
/// with the camp period (`camp_start`/`camp_end`, falling back to `[from, to]`). Order: largest
/// overlap first, then nearest start date to the camp start, then name.
pub fn rank_events(
    events: Vec<MidataEventSummary>,
    from: &str,
    to: &str,
    camp_start: Option<&str>,
    camp_end: Option<&str>,
) -> Vec<MidataEventSummary> {
    let (cs, ce) = match (camp_start, camp_end) {
        (Some(a), Some(b)) if day_number(a).is_some() && day_number(b).is_some() => (a, b),
        _ => (from, to),
    };
    let anchor = day_number(cs).unwrap_or(0);
    let mut dated: Vec<(MidataEventSummary, i64, i64)> = Vec::new();
    let mut undated: Vec<MidataEventSummary> = Vec::new();
    for mut e in events {
        let range = match (e.start_at.clone(), e.finish_at.clone().or_else(|| e.start_at.clone())) {
            (Some(a), Some(b)) => Some((a, b)),
            _ => None,
        };
        let Some((a, b)) = range else {
            e.overlap_days = None;
            undated.push(e);
            continue;
        };
        match overlap_between((&a, &b), (from, to)) {
            Some(0) => continue,
            Some(_) => {}
            None => {
                e.overlap_days = None;
                undated.push(e);
                continue;
            }
        }
        let ov = overlap_between((&a, &b), (cs, ce)).unwrap_or(0);
        e.overlap_days = u32::try_from(ov).ok();
        let dist = (day_number(&a).unwrap_or(anchor) - anchor).abs();
        dated.push((e, ov, dist));
    }
    dated.sort_by(|x, y| y.1.cmp(&x.1).then(x.2.cmp(&y.2)).then_with(|| x.0.name.cmp(&y.0.name)));
    let mut out: Vec<MidataEventSummary> = dated.into_iter().map(|t| t.0).collect();
    undated.sort_by(|x, y| x.name.cmp(&y.name));
    out.extend(undated);
    out
}

struct PersonAgg {
    leader_label: Option<String>,
    is_leader: bool,
    /// Main leader (Hauptleitung): role type segment exactly `Leader`.
    is_main: bool,
    is_participant: bool,
    /// Has the PBS coach role (`Event::Camp::Role::Coach`).
    is_coach: bool,
    person_id: Option<String>,
}

/// One entry per person (deduped over all participations), in first-seen order.
fn collect_people(pages: &[Value]) -> Vec<PersonAgg> {
    let refs: Vec<&Value> = pages.iter().collect();
    let included = index_included(&refs);
    let mut order: Vec<String> = Vec::new();
    let mut map: HashMap<String, PersonAgg> = HashMap::new();
    for page in pages {
        let Some(data) = page.get("data").and_then(Value::as_array) else { continue };
        for p in data {
            if p.get("attributes").and_then(|a| a.get("active")).and_then(Value::as_bool) == Some(false) {
                continue;
            }
            let part = {
                let r = rel_ids(p, "participant");
                if r.is_empty() { rel_ids(p, "person") } else { r }
            };
            let is_guest = part.first().is_some_and(|(t, _)| t == "event_guests");
            let person = part.into_iter().next().map(|(t, id)| if t == "event_guests" { format!("guest:{id}") } else { id });
            let key = match (&person, p.get("id").and_then(id_str)) {
                (Some(id), _) => format!("p:{id}"),
                (None, Some(pid)) => format!("n:{pid}"),
                (None, None) => continue,
            };
            let mut is_leader = false;
            let mut is_main = false;
            let mut is_participant = false;
            let mut is_coach = false;
            let mut label: Option<String> = None;
            for rk in rel_ids(p, "roles") {
                let Some(role) = included.get(&rk) else { continue };
                let rtype = str_attr(role, "type").unwrap_or_default();
                match classify_role(&rtype) {
                    RoleClass::Leader if !is_guest => {
                        is_leader = true;
                        is_main |= rtype.rsplit("::").next().map(str::trim) == Some("Leader");
                        if label.is_none() {
                            label = str_attr(role, "label").or_else(|| rtype.rsplit("::").next().map(String::from));
                        }
                    }
                    RoleClass::Coach => is_coach |= !is_guest,
                    RoleClass::Participant | RoleClass::Leader => is_participant = true,
                    RoleClass::Other => {}
                }
            }
            let agg = map.entry(key.clone()).or_insert_with(|| {
                order.push(key.clone());
                PersonAgg { leader_label: None, is_leader: false, is_main: false, is_participant: false, is_coach: false, person_id: person.clone() }
            });
            agg.is_leader |= is_leader;
            agg.is_main |= is_main;
            agg.is_participant |= is_participant;
            agg.is_coach |= is_coach;
            if agg.leader_label.is_none() {
                agg.leader_label = label;
            }
        }
    }
    order.into_iter().filter_map(|k| map.remove(&k)).collect()
}

/// Person ids (as strings) of all participations with a leader role, for the qualifications query.
pub fn leader_person_ids(participation_pages: &[Value]) -> Vec<String> {
    collect_people(participation_pages)
        .into_iter()
        .filter(|a| a.is_leader)
        .filter_map(|a| a.person_id)
        .filter(|id| !id.starts_with("guest:"))
        .collect()
}

/// `links.next` of a JSON:API document, if any (MiData may return a relative URL; resolve against the current page).
pub fn next_link(doc: &Value) -> Option<String> {
    doc.get("links")?.get("next")?.as_str().filter(|s| !s.is_empty()).map(String::from)
}

fn u32_of(v: Option<&Value>) -> Option<u32> {
    match v? {
        Value::Number(n) => n.as_u64().and_then(|n| u32::try_from(n).ok()),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// One qualification of a person: kind label and whether it is valid over the whole camp.
struct QualRec {
    person: String,
    label: String,
    valid: bool,
}

/// Parses qualification pages. Validity (strict): valid over the WHOLE camp, i.e. the start
/// (`start_at`, else `qualified_at` when `start_at` is null) is empty or `<= camp_start` and
/// `finish_at` is empty or `>= camp_end`.
fn parse_qualifications(pages: &[Value], camp_start: &str, camp_end: &str) -> Vec<QualRec> {
    let refs: Vec<&Value> = pages.iter().collect();
    let included = index_included(&refs);
    let mut out = Vec::new();
    for page in pages {
        let Some(data) = page.get("data").and_then(Value::as_array) else { continue };
        for q in data {
            let Some((_, person)) = rel_ids(q, "person").into_iter().next() else { continue };
            let Some(kind_key) = rel_ids(q, "qualification_kind").into_iter().next() else { continue };
            let Some(kind) = included.get(&kind_key) else { continue };
            let Some(label) = str_attr(kind, "label") else { continue };
            let start = str_attr(q, "start_at")
                .and_then(|s| day_string(&s))
                .or_else(|| str_attr(q, "qualified_at").and_then(|s| day_string(&s)));
            let finish = str_attr(q, "finish_at").and_then(|s| day_string(&s));
            let ok_start = start.is_none_or(|s| s.as_str() <= camp_start);
            let ok_finish = finish.is_none_or(|f| f.as_str() >= camp_end);
            out.push(QualRec { person, label, valid: ok_start && ok_finish });
        }
    }
    out
}

struct KindAcc {
    label: String,
    keys: Vec<QualKey>,
    valid: BTreeSet<String>,
    expired: BTreeSet<String>,
}

/// Reduces raw MiData documents to the aggregate. Pure; never logs.
pub fn reduce_aggregate(raw: &RawEventData<'_>) -> Result<MidataAggregate, CoreError> {
    let camp_start = day_string(raw.camp_start).ok_or_else(|| CoreError::Invalid("Lagerbeginn ungültig".into()))?;
    let camp_end = day_string(raw.camp_end).ok_or_else(|| CoreError::Invalid("Lagerende ungültig".into()))?;
    let event = raw
        .event
        .get("data")
        .filter(|d| d.is_object())
        .ok_or_else(|| CoreError::Invalid("MiData-Antwort enthält keinen Anlass".into()))?;
    let event_id = event.get("id").and_then(id_str).ok_or_else(|| CoreError::Invalid("MiData-Anlass ohne Kennung".into()))?;
    let ev_included = index_included(&[raw.event]);

    let advisor = event.get("attributes").and_then(|a| a.get("advisor_id")).and_then(id_str);
    let coach_in = raw.coach_person_id.map(str::trim).filter(|c| !c.is_empty());

    let refs: Vec<&Value> = raw.participation_pages.iter().collect();
    let people_idx = index_included(&refs);
    let people = collect_people(raw.participation_pages);
    let qual_recs =
        if raw.qualifications_readable { parse_qualifications(raw.qualification_pages, &camp_start, &camp_end) } else { Vec::new() };
    let coach = people.iter().find(|p| p.is_coach);
    let coach_match = match coach {
        Some(c) => match (coach_in, c.person_id.as_deref()) {
            (Some(a), Some(b)) => Some(a == b),
            _ => None,
        },
        None => match (coach_in, advisor) {
            (Some(c), Some(a)) => Some(a == c),
            _ => None,
        },
    };

    let person_attr = |id: &Option<String>, attr: &str| -> Option<String> {
        let rec = people_idx.get(&("people".to_string(), id.clone()?))?;
        str_attr(rec, attr)
    };

    let mut bands: Vec<AgeBand> = AGE_BANDS.iter().map(|(f, t)| AgeBand { from: *f, to: *t, count: 0 }).collect();
    let (mut participants_count, mut js_age, mut without_bd) = (0u32, 0u32, 0u32);
    let (mut min_age, mut max_age): (Option<u32>, Option<u32>) = (None, None);
    let mut by_year: BTreeMap<u32, u32> = BTreeMap::new();
    let camp_year = parse_date(&camp_start).map(|d| d.0);
    let mut leaders: Vec<MidataLeader> = Vec::new();
    let mut anon = 0u32;

    let coach_nickname =
        coach.and_then(|c| person_attr(&c.person_id, "nickname").or_else(|| person_attr(&c.person_id, "first_name")));

    // Qualifications of leaders only: per person the valid keys, plus per-label statistics.
    let leader_ids: BTreeSet<&str> = people.iter().filter(|p| p.is_leader).filter_map(|p| p.person_id.as_deref()).collect();
    let mut quals: HashMap<String, BTreeSet<QualKey>> = HashMap::new();
    let mut kinds: BTreeMap<String, KindAcc> = BTreeMap::new();
    for r in qual_recs.iter().filter(|r| leader_ids.contains(r.person.as_str())) {
        let keys = qual_keys_with_mapping(&r.label, raw.qual_mapping);
        if r.valid {
            quals.entry(r.person.clone()).or_default().extend(keys.iter().copied());
        }
        let acc = kinds.entry(r.label.trim().to_lowercase()).or_insert_with(|| KindAcc {
            label: r.label.clone(),
            keys,
            valid: BTreeSet::new(),
            expired: BTreeSet::new(),
        });
        if r.valid {
            acc.valid.insert(r.person.clone());
        } else {
            acc.expired.insert(r.person.clone());
        }
    }
    let qualification_kinds: Vec<QualKindInfo> = kinds
        .into_values()
        .map(|k| QualKindInfo {
            label: k.label,
            keys: k.keys,
            valid_leaders: u32::try_from(k.valid.len()).unwrap_or(u32::MAX),
            expired_leaders: u32::try_from(k.expired.difference(&k.valid).count()).unwrap_or(u32::MAX),
        })
        .collect();

    for p in &people {
        if p.is_leader {
            let nickname = person_attr(&p.person_id, "nickname").or_else(|| person_attr(&p.person_id, "first_name")).unwrap_or_else(|| {
                anon += 1;
                format!("Leiter/in {anon}")
            });
            let have: BTreeSet<QualKey> = p.person_id.as_ref().and_then(|id| quals.get(id)).cloned().unwrap_or_default();
            let qualifications: BTreeMap<QualKey, bool> = ALL_QUAL_KEYS.iter().map(|k| (*k, have.contains(k))).collect();
            leaders.push(MidataLeader {
                nickname,
                main_leader: p.is_main,
                role_label: p.leader_label.clone().unwrap_or_else(|| "Leitung".into()),
                qualifications,
            });
        } else if p.is_participant {
            participants_count += 1;
            let birthday = person_attr(&p.person_id, "birthday");
            if let (Some(cy), Some((by, _, _))) = (camp_year, birthday.as_deref().and_then(parse_date)) {
                if let Ok(u) = u32::try_from(by) {
                    *by_year.entry(u).or_insert(0) += 1;
                }
                if (5..=20).contains(&(cy - by)) {
                    js_age += 1;
                }
            }
            match birthday.and_then(|b| age_on(&b, &camp_start)) {
                Some(age) => {
                    min_age = Some(min_age.map_or(age, |m| m.min(age)));
                    max_age = Some(max_age.map_or(age, |m| m.max(age)));
                    if let Some(b) = bands.iter_mut().find(|b| age >= b.from && b.to.is_none_or(|t| age <= t)) {
                        b.count += 1;
                    }
                }
                None => without_bd += 1,
            }
        }
    }
    leaders.sort_by(|a, b| a.nickname.cmp(&b.nickname));

    Ok(MidataAggregate {
        zone: "red-derived".into(),
        base_url: raw.base_url.to_string(),
        event_id,
        event_name: str_attr(event, "name").unwrap_or_default(),
        event_dates: dates_of(event, &ev_included),
        location: str_attr(event, "location"),
        maximum_participants: u32_of(event.get("attributes").and_then(|a| a.get("maximum_participants"))),
        participants_count,
        participants_js_age_count: js_age,
        participants_without_birthday: without_bd,
        participants_by_birth_year: by_year,
        min_age,
        max_age,
        age_bands: bands,
        leaders_count: u32::try_from(leaders.len()).unwrap_or(u32::MAX),
        leaders,
        coach_match,
        coach_nickname,
        qualifications_readable: raw.qualifications_readable,
        qualification_kinds,
        fetched_at: raw.fetched_at.to_string(),
    })
}

/// PBS camp field names looked for in the classic export (plus any name
/// containing `expected_participants`).
pub const PBS_CAMP_FIELDS: [&str; 24] = [
    "coach",
    "advisor_mountain_security",
    "advisor_snow_security",
    "advisor_water_security",
    "camp_submitted",
    "camp_submitted_at",
    "canton",
    "j_s_kind",
    "j_s_security_snow",
    "j_s_security_mountain",
    "j_s_security_water",
    "al_present",
    "al_visiting",
    "coach_visiting",
    "local_scout_contact_present",
    "camp_reminder_sent",
    "total_expected_leading_participants",
    "total_expected_participants",
    "expected_participants_wolf_f",
    "expected_participants_wolf_m",
    "expected_participants_pfadi_f",
    "expected_participants_pfadi_m",
    "expected_participants_pio_f",
    "expected_participants_pio_m",
];

/// Extracts PBS camp field names present in a classic event JSON export
/// (`/groups/{g}/events/{e}.json`). Returns (pbs_fields_present, attribute_names). Names only.
pub fn probe_classic_fields(doc: &Value) -> (Vec<String>, Vec<String>) {
    let obj = doc
        .get("events")
        .and_then(Value::as_array)
        .and_then(|a| a.first())
        .or_else(|| doc.get("event").filter(|e| e.is_object()))
        .unwrap_or(doc);
    let names: BTreeSet<String> = obj.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
    let pbs: Vec<String> =
        names.iter().filter(|n| PBS_CAMP_FIELDS.contains(&n.as_str()) || n.contains("expected_participants")).cloned().collect();
    (pbs, names.into_iter().collect())
}
