//! NDS sync v2 (M21, ADR 0016, red zone, read-only): attendance per activity, camp details,
//! offer protocol, the coach's own recognitions and coach profile. Pure parsing and reduction only;
//! the HTTP side lives in `src-tauri/src/nds.rs`.
//!
//! Red-zone rules (same as `nds`):
//! - Attendance lists are reduced to COUNTS. Person ids are used only inside
//!   [`reduce_attendances`] to count distinct persons and are never returned.
//! - Names, birth dates, addresses, AHV numbers, `triggeringPerson`, `protocolContent`,
//!   `reason*` free texts are never requested (see the `Q_*` documents) and never returned.
//! - The coach's own recognitions and profile ([`NdsRecognitionsResult`], [`NdsCoachProfile`]) are the
//!   coach's own data; they are returned to the UI but kept in memory only (never persisted).
//!
//! CONTRACT (M21): the serialized shapes below are mirrored in `apps/desktop/src/domain/types.ts`
//! (`NdsAttendance`, `NdsCampDetails`, `NdsProtocol`, `NdsRecognition*`, `NdsCoachProfile`,
//! `NdsPersonDetection`). Change both sides together.

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ------------------------------------------------------------------ constants

/// `primaryEntityClassName` of an offer for `SpecificProtocolEntityList` (observed in the
/// 2026-11-15 capture, service `youthtraining`).
pub const PROTOCOL_OFFER_CLASS: &str = "com.queomedia.nds.youthtraining.offer.domain.Offer";
/// Upper bound of activities whose attendance lists are read per camp (2 calls per activity).
pub const MAX_ATTENDANCE_ACTIVITIES: usize = 60;
/// Upper bound of protocol entries kept in [`NdsProtocol::events`] (newest first are dropped last).
pub const MAX_PROTOCOL_EVENTS: usize = 100;
/// Max length of a protocol label / NDS message kept (chars).
pub const MAX_LABEL_CHARS: usize = 160;
/// Observed activity state for a finished attendance check.
pub const ATTENDANCE_CHECKED_STATE: &str = "ATTENDANCE_CHECKED";
/// `educationField` values queried for the coach's own recognitions (observed filter values).
pub const RECOGNITION_EDUCATION_FIELDS: [&str; 2] = ["JS_COACH", "JS_LEADER_AND_EXPERT"];
/// Minimum share (0..=1) of visible offers whose coach is the same person for [`detect_person`]
/// to return that person.
pub const DETECT_MIN_SHARE: f64 = 0.5;

// ------------------------------------------------------------------ GraphQL documents
//
// Reduced from docs/contracts/nds-api/operations.graphql. Person fields are limited to
// `person { businessId }` (needed to count distinct persons) – no names, birth dates, addresses.

pub const OP_PARTICIPANT_ATTENDANCES: &str = "ParticipantAttendances";
pub const OP_SUPERVISOR_ATTENDANCES: &str = "SupervisorAttendances";
pub const OP_PROTOCOL: &str = "SpecificProtocolEntityList";
pub const OP_RECOGNITIONS: &str = "PersonGrantedRecognitionList";
pub const OP_PERSON_SUPPLEMENTS: &str = "PersonSupplementList";
pub const OP_ORG_RELATIONS: &str = "CurrentYouthTrainingOrganisationRelationsList";
pub const OP_COACH_BIOGRAPHY: &str = "FinishedYouthTrainingOfferRelationsAsCoachBiographyList";
/// Same operation name as `nds::OP_OFFER_LIST`, different (coach id only) selection.
pub const OP_OFFER_COACHES: &str = "OfferList";

/// Service `youthtraining`. No chunk parameter: one call returns all rows of the activity.
pub const Q_PARTICIPANT_ATTENDANCES: &str = "query ParticipantAttendances($activityBusinessId: ID!) {
  participantAttendances(activityBusinessId: $activityBusinessId) {
    content { businessId participantTargetAudienceGroup eligibleForSubsidies wasPresent overlaps { offerNumber activityType } person { businessId } }
    totalElements totalPages number size
  }
}";

/// Service `youthtraining`. No chunk parameter.
pub const Q_SUPERVISOR_ATTENDANCES: &str = "query SupervisorAttendances($activityBusinessId: ID!) {
  supervisorAttendances(activityBusinessId: $activityBusinessId) {
    content { businessId involvementType wasPresent mountainGuide overlaps { offerNumber activityType } person { businessId } }
    totalElements totalPages number size
  }
}";

/// Service `youthtraining` with [`PROTOCOL_OFFER_CLASS`]. `protocolContent` and `triggeringPerson`
/// are deliberately NOT requested.
pub const Q_PROTOCOL: &str = "query SpecificProtocolEntityList($chunk: Chunk, $filter: SpecificProtocolEntityFilter, $primaryEntityClassName: String!, $primaryEntityId: ID!) {
  specificProtocolEntityList(chunk: $chunk, filter: $filter, primaryEntityClassName: $primaryEntityClassName, primaryEntityId: $primaryEntityId) {
    content { protocolId createdTimestamp protocolType { de fr it } }
    totalElements totalPages number size
  }
}";

/// Service `perorgfin`. `$filter` is required, see [`recognition_filter`]. `reason` is NOT requested.
pub const Q_RECOGNITIONS: &str = "query PersonGrantedRecognitionList($personBusinessId: ID!, $chunk: Chunk, $filter: GrantedRecognitionFilter!) {
  grantedRecognitionList(personBusinessId: $personBusinessId, chunk: $chunk, filter: $filter) {
    content { businessId rowTitle { de fr it } recognitionState activeDateRange { first last } omittedSince invalidSince archivedSince cadre { name { de fr it } educationField } targetAudienceGroup sport { title { de fr it } } grantedRecognitionSupplements { stateDateRange { first last } recognitionSupplement { businessId name { de fr it } } } }
    totalElements totalPages number size
  }
}";

/// Service `perorgfin`.
pub const Q_PERSON_SUPPLEMENTS: &str = "query PersonSupplementList($personBusinessId: ID!, $chunk: Chunk, $filter: PersonSupplementFilter) {
  personSupplementList(personBusinessId: $personBusinessId, filter: $filter, chunk: $chunk) {
    content { businessId rowTitle { de fr it } educationSupplement { name { de fr it } } }
    totalElements totalPages number size
  }
}";

/// Service `perorgfin`. No chunk parameter.
pub const Q_ORG_RELATIONS: &str = "query CurrentYouthTrainingOrganisationRelationsList($person: ID!) {
  currentYouthTrainingOrganisationRelationsList(person: $person) {
    content { relationType organisation { businessId name { de fr it } } offerGroups relationStartDate }
    totalElements totalPages number size
  }
}";

/// Service `perorgfin`.
pub const Q_COACH_BIOGRAPHY: &str = "query FinishedYouthTrainingOfferRelationsAsCoachBiographyList($person: ID!, $chunk: Chunk) {
  finishedYouthTrainingOfferRelationsAsCoachBiographyList(person: $person, chunk: $chunk) {
    content { businessId offerNumber sports { title { de fr it } } offerGroup duration { first last } organisation { businessId name { de fr it } } courseCount campCount }
    totalElements totalPages number size
  }
}";

/// Service `youthtraining`. Only the coach's person id (UNVERIFIED selection: the captured
/// operation selects only the coach's names via a `Person` fragment).
pub const Q_OFFER_COACHES: &str = "query OfferList($chunk: Chunk, $filter: OfferFilter) {
  offerList(chunk: $chunk, filter: $filter) {
    content { businessId coach { businessId } }
    totalElements totalPages number size
  }
}";

// ------------------------------------------------------------------ types: camp aggregate parts

/// Attendance per date (activities with a finished attendance check only). Counts only.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsDateAttendance {
    /// YYYY-MM-DD
    pub date: String,
    /// Checked activities on that date.
    pub activities: u32,
    /// Max over that date's checked activities of participants with `wasPresent == true`.
    pub participants_present: u32,
    /// Max over that date's checked activities of supervisors with `wasPresent == true`.
    pub supervisors_present: u32,
}

/// Attendance summary of a camp (from `ParticipantAttendances` / `SupervisorAttendances` per
/// activity). Counts only; «distinct» counts use `person.businessId` inside Rust and drop it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsAttendance {
    /// Activities of the camp (from ActivityListForCamp).
    pub activities_total: u32,
    /// Activities whose two attendance lists were read successfully.
    pub activities_read: u32,
    /// Of those, activities in state [`ATTENDANCE_CHECKED_STATE`].
    pub activities_checked: u32,
    /// Distinct participants / supervisors over all read activities.
    pub participants: u32,
    pub supervisors: u32,
    /// Distinct participants that appear in ≥1 checked activity but were never present in one.
    pub participants_never_present: u32,
    /// Distinct participants with `eligibleForSubsidies == false` in ≥1 read activity.
    pub participants_not_eligible: u32,
    /// Distinct participants / supervisors with a non-empty `overlaps` list in ≥1 read activity.
    pub overlap_participants: u32,
    pub overlap_supervisors: u32,
    /// Read activities with ≥1 overlap (participant or supervisor).
    pub overlap_activities: u32,
    /// Distinct `overlaps[].offerNumber` (other offers), sorted, max 20.
    pub overlap_offer_numbers: Vec<String>,
    /// Distinct dates (YYYY-MM-DD) of activities with an overlap, sorted.
    pub overlap_dates: Vec<String>,
    /// Distinct supervisors with `mountainGuide == true`.
    pub mountain_guides: u32,
    /// Checked activities per date, sorted by date.
    pub by_date: Vec<NdsDateAttendance>,
    /// True when not all activities were read (cap [`MAX_ATTENDANCE_ACTIVITIES`] or errors).
    pub truncated: bool,
}

/// Effective present counts (offerItem of the timeline element).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsPresentCounts {
    pub male_children: Option<u32>,
    pub female_children: Option<u32>,
    pub male_adolescents: Option<u32>,
    pub female_adolescents: Option<u32>,
    pub supervisors: Option<u32>,
}

/// Camp subsidies in CHF (organisation money, no personal data). Fractional values possible.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsSubsidies {
    /// `plannedCampSubsidies.total`
    pub planned: Option<f64>,
    /// `actualCampSubsidies.total`
    pub actual: Option<f64>,
    /// `totalCampSubsidies`
    pub total: Option<f64>,
}

/// Flags of the offer (`GET /youthtraining/offer/offer/{id}`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsOfferFlags {
    pub late_submitted_items: Option<bool>,
    pub late_submitted_items_unapproved: Option<bool>,
    pub items_in_correction: Option<bool>,
    pub handicap_registration: Option<bool>,
    /// Raw code (only null observed so far).
    pub evaluation_state: Option<String>,
}

/// Camp details: camp/details (risk fields, NDS minimum-requirement messages), the offerItem of
/// one activity's timeline element, and the offer flags. Every field optional.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsCampDetails {
    pub risk_activities_planned: Option<bool>,
    /// `riskActivityAnswer1..3` (meaning of the questions is NDS UI text; only booleans kept).
    pub risk_activity_answers: [Option<bool>; 3],
    pub supervisor_expertise_present: Option<bool>,
    pub overnight_stay: Option<bool>,
    pub late_submission: Option<bool>,
    pub approval_with_reservation: Option<bool>,
    pub camp_days_with_activities: Option<u32>,
    pub camp_days_without_activities: Option<u32>,
    /// Raw duration strings as delivered (format unverified).
    pub activity_duration_first_day: Option<String>,
    pub activity_duration_last_day: Option<String>,
    pub present: NdsPresentCounts,
    pub subsidies: NdsSubsidies,
    /// `minimalRequirementsCheckResultMessages` as German texts (max 20, each ≤ [`MAX_LABEL_CHARS`]).
    /// `None` = field null/absent (only null observed so far). Strings, or objects with `{de,fr,it}`
    /// / `message` / `text`, are accepted; anything else is skipped.
    pub minimal_requirements_messages: Option<Vec<String>>,
    pub offer_flags: NdsOfferFlags,
}

/// Classified protocol entry kind. Classification is a keyword match on the German
/// `protocolType` label (labels are UNVERIFIED; unknown labels are `Other`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NdsProtocolKind {
    Submitted,
    Approved,
    Assessment,
    Closed,
    Paid,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsProtocolEvent {
    /// `createdTimestamp` as delivered (wall clock, not converted).
    pub at: String,
    /// YYYY-MM-DD part of `at`.
    pub date: String,
    pub kind: NdsProtocolKind,
    /// German `protocolType` label, trimmed to [`MAX_LABEL_CHARS`].
    pub label: String,
}

/// Offer protocol (status history). `protocolContent` / `triggeringPerson` are never read.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsProtocol {
    /// Sorted ascending by `at`, max [`MAX_PROTOCOL_EVENTS`] (the oldest are kept).
    pub events: Vec<NdsProtocolEvent>,
    /// Date of the FIRST `Submitted` event.
    pub submitted_on: Option<String>,
    /// Date of the FIRST `Approved` event.
    pub approved_on: Option<String>,
    /// Date of the first `Closed` event, else the first `Assessment` event.
    pub closed_on: Option<String>,
    pub truncated: bool,
}

// ------------------------------------------------------------------ types: coach (memory only)

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsRecognitionSupplement {
    pub title: String,
    pub valid_from: Option<String>,
    pub valid_until: Option<String>,
}

/// One granted recognition of the coach (own data). `reason` is never read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsRecognition {
    pub business_id: String,
    /// `cadre.name` (German), else `rowTitle`.
    pub title: String,
    pub education_field: Option<String>,
    /// Raw `recognitionState` (observed: VALID, OMITTED).
    pub state: Option<String>,
    /// `activeDateRange.first` / `.last` (YYYY-MM-DD).
    pub valid_from: Option<String>,
    pub valid_until: Option<String>,
    pub omitted_since: Option<String>,
    pub invalid_since: Option<String>,
    pub archived_since: Option<String>,
    pub target_audience_group: Option<String>,
    pub sport: Option<String>,
    pub supplements: Vec<NdsRecognitionSupplement>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsRecognitionsResult {
    /// Deduplicated by business id, sorted by `valid_until` (None last), then title.
    pub recognitions: Vec<NdsRecognition>,
    /// German titles of `personSupplementList` entries (education supplements), deduplicated.
    pub person_supplements: Vec<String>,
    /// Education fields whose query failed (e.g. 403); the others are still returned.
    pub failed_fields: Vec<String>,
    pub fetched_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsCoachOrganisation {
    pub business_id: String,
    pub name: String,
    pub relation_type: Option<String>,
    pub offer_groups: Vec<String>,
    /// `relationStartDate` (YYYY-MM-DD).
    pub since: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsFinishedOffer {
    pub offer_business_id: String,
    pub offer_number: Option<String>,
    pub organisation_name: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub camp_count: Option<u32>,
    pub course_count: Option<u32>,
    pub sports: Vec<String>,
}

/// The coach's organisations and finished offers (own data, memory only).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsCoachProfile {
    pub organisations: Vec<NdsCoachOrganisation>,
    /// Sorted by start descending.
    pub finished_offers: Vec<NdsFinishedOffer>,
    pub fetched_at: String,
}

/// Result of the own-person detection (majority coach of the visible offers).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsPersonDetection {
    /// Numeric NDS person business id, or `None` when no person reaches [`DETECT_MIN_SHARE`].
    pub person_id: Option<String>,
    /// Offers that carried a coach id.
    pub offers_seen: u32,
    /// Offers whose coach is `person_id`.
    pub offers_matched: u32,
}

// ------------------------------------------------------------------ raw inputs

/// One activity of the camp as listed by ActivityListForCamp (no personal data).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NdsActivityRef {
    pub business_id: String,
    /// YYYY-MM-DD
    pub date: Option<String>,
    pub state: Option<String>,
    /// `overlapCount` if delivered.
    pub overlap_count: Option<u32>,
}

/// Raw attendance documents of one activity (`{content: [...]}` or array). Dropped after reduction.
pub struct RawActivityAttendance<'a> {
    pub activity: &'a NdsActivityRef,
    pub participants: &'a Value,
    pub supervisors: &'a Value,
}

// ------------------------------------------------------------------ functions (contract)

/// Activities from ActivityListForCamp items (list document or array), in delivered order.
/// Items without a valid numeric `businessId` are skipped.
pub fn activity_refs(activities: &Value) -> Vec<NdsActivityRef> {
    let _ = activities;
    todo!("M21 agent: implement")
}

/// Reduces the attendance lists of the read activities to counts. `activities_total` is the
/// number of activities of the camp; `truncated` is set by the caller when some were not read.
pub fn reduce_attendances(
    activities_total: u32,
    read: &[RawActivityAttendance<'_>],
    truncated: bool,
) -> NdsAttendance {
    let _ = (activities_total, read, truncated);
    todo!("M21 agent: implement")
}

/// Camp details from camp/details, one timeline element (`GET .../activity/{id}/timelineElement`,
/// read its `offerItem`) and the offer (`GET /youthtraining/offer/offer/{id}`). Any input may be
/// `Value::Null`. Returns `None` only when all three inputs are non-objects.
pub fn reduce_camp_details(camp_details: &Value, timeline: &Value, offer: &Value) -> Option<NdsCampDetails> {
    let _ = (camp_details, timeline, offer);
    todo!("M21 agent: implement")
}

/// Keyword classification of a German protocol label (case-insensitive):
/// `eingereicht|gesuch` → Submitted, `bewillig` → Approved, `beurteil|prüfung` → Assessment,
/// `abgeschlossen|abschluss|abgerechnet|abrechnung` → Closed, `ausbezahlt|bezahlt|zahlung` → Paid,
/// else Other. First matching rule in this order wins, except that a label matching both
/// Approved and a negation (`nicht`, `abgelehnt`, `zurück`) is Other.
pub fn classify_protocol_label(label: &str) -> NdsProtocolKind {
    let _ = label;
    todo!("M21 agent: implement")
}

/// Reduces protocol list items to an [`NdsProtocol`]. Items without a valid date are skipped.
pub fn reduce_protocol(items: &[Value], truncated: bool) -> NdsProtocol {
    let _ = (items, truncated);
    todo!("M21 agent: implement")
}

/// `GrantedRecognitionFilter` for the coach's own recognitions:
/// `{ "educationField": { "selected": field }, "person": { "selected": person_id } }`.
pub fn recognition_filter(person_id: &str, education_field: &str) -> Value {
    let _ = (person_id, education_field);
    todo!("M21 agent: implement")
}

/// Builds the recognitions result from the items of all queried education fields (may contain
/// duplicates) and the person supplement items.
pub fn reduce_recognitions(
    recognition_items: &[Value],
    supplement_items: &[Value],
    failed_fields: Vec<String>,
    fetched_at: &str,
) -> NdsRecognitionsResult {
    let _ = (recognition_items, supplement_items, failed_fields, fetched_at);
    todo!("M21 agent: implement")
}

/// Builds the coach profile from org relation items and biography items.
pub fn reduce_coach_profile(relation_items: &[Value], biography_items: &[Value], fetched_at: &str) -> NdsCoachProfile {
    let _ = (relation_items, biography_items, fetched_at);
    todo!("M21 agent: implement")
}

/// `offerBusinessId -> organisation name (German)` from OfferList items selected with
/// `nds::Q_OFFER_LIST` (`organisation.name.resolvedLocalizedString`). Offers without a name are
/// absent. The caller sets `NdsCampSummary::organisation_name` from this map.
pub fn offer_organisation_names(offer_items: &[Value]) -> std::collections::BTreeMap<String, String> {
    let _ = offer_items;
    todo!("M21 agent: implement")
}

/// Majority coach id over OfferList items selected with [`Q_OFFER_COACHES`]. Only numeric ids
/// (`validate`-style: optional '-', 1-20 digits) count. Ties → `None`.
pub fn detect_person(offer_items: &[Value]) -> NdsPersonDetection {
    let _ = offer_items;
    todo!("M21 agent: implement")
}
