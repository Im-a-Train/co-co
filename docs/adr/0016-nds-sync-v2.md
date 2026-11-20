# ADR 0016: NDS sync v2: attendance, camp details, protocol, coach data

- Status: accepted
- Date: 2026-11-20
- Builds on: [ADR 0007](0007-nds-red-zone.md) (NDS red zone), [ADR 0009](0009-personal-data-in-ui.md)
  (personal data in the UI), [ADR 0011](0011-rule-set-v2.md) (rule set), [ADR 0012](0012-openai-compatible-and-mcp.md) (MCP)
- Milestone: M21. Contract: `crates/coco-core/src/nds_sync.rs`, `domain/types.ts`, `lib/tauri.ts`

## Context

The 2026-11-15 browser capture (`docs/contracts/nds-api/`) showed more of the NDS than the M8 sync reads:
attendance lists per activity (with double bookings), camp details with the NDS minimum-requirement check,
the offer protocol (status history), the coach's own recognitions and organisations. Coaches asked for:

1. Attendance and double bookings (a participant or leader who is booked in another offer at the same time).
2. Camp details NDS already holds (risk answers, subsidies, present counts, flags such as late submission).
3. The real submission, approval and closing dates instead of typing them in.
4. Their own J+S recognitions in the Fristen radar (when does my recognition expire?).
5. Picking the right NDS camp without scrolling through all of them.

Person-level reconciliation (name by name against eCamp or MiData) stays out of scope.

## Decision

### 1. Attendance as counts only

- `ParticipantAttendances` / `SupervisorAttendances` (service `youthtraining`, one call per activity and
  list) are read per activity of the camp and reduced in `coco_core::nds_sync::reduce_attendances` to
  `NdsAttendance` (counts, distinct overlap offer numbers, dates, per-date maxima).
- Person ids (`person { businessId }`) are the only person field requested. They are used **inside Rust** to
  count distinct persons and are dropped; names, birth dates and addresses are not requested.
- Volume: at most `MAX_ATTENDANCE_ACTIVITIES` = 60 activities per refresh, 2 calls each (up to 120 calls),
  only when the coach clicks «Von NDS laden». More activities set `truncated`; failing activities lower
  `activitiesRead` and also set `truncated`. Nothing runs in the background.
- `ActivityListForCamp` now also selects `overlapCount` per activity.
- The element shape of `overlaps` is unknown beyond the selected `offerNumber` and `activityType`
  (unverified live).

### 2. Camp details

`NdsCampDetails` (`reduce_camp_details`) combines three inputs: `camp/details` (risk answers, flags, camp days
with/without activities, activity durations, subsidies, `minimalRequirementsCheckResultMessages`), the
`offerItem` of the **first** activity's `GET .../activity/{id}/timelineElement` (effective present counts)
and `GET /youthtraining/offer/offer/{id}` (flags: late submitted items, items in correction, handicap
registration, evaluation state). Every field is optional. NDS minimum-requirement messages are kept as
German texts (max 20, each at most `MAX_LABEL_CHARS` = 160 characters); the message shape is unverified
(only null observed), so strings and objects with `de` / `message` / `text` are accepted and anything else
is skipped.

### 3. Offer protocol

- `SpecificProtocolEntityList` with `primaryEntityClassName` =
  `com.queomedia.nds.youthtraining.offer.domain.Offer` (observed in the capture) and the offer id. Requested:
  `protocolId`, `createdTimestamp`, `protocolType {de fr it}`. **Not** requested: `protocolContent`,
  `triggeringPerson`, free texts.
- `classify_protocol_label` classifies the German label by keywords; specific ones win over the generic
  submission words: bewillig, beurteil/prüfung, abgeschlossen/abschluss/abgerechnet/abrechnung,
  bezahlt/zahlung, then eingereicht/gesuch («Gesuch bewilligt» = approved). The label texts are
  **unverified** (the capture is redacted); unknown labels are kept as `other`.
- Derived dates: `submittedOn` (first Submitted), `approvedOn` (first Approved), `closedOn` (first Closed,
  else first Assessment). Up to `MAX_PROTOCOL_EVENTS` = 100 events (oldest kept).
- Use: `submittedOn` becomes the suggestion for `ndsRegisteredOn` and lets JS-DL-01 judge lateness (until now
  NDS only gave the approval date, which made lateness undecidable); `closedOn` feeds the `ndsClosed` flag
  and the new coach-input field `ndsClosedOn` as a suggestion. As before, the coach accepts each suggestion
  («Aus NDS übernehmen»).

### 4. The coach's own recognitions, profile, own person id

- New commands `nds_fetch_recognitions(personId)` and `nds_fetch_coach_profile(personId)`
  (perorgfin queries `PersonGrantedRecognitionList`, `PersonSupplementList`,
  `CurrentYouthTrainingOrganisationRelationsList`, `FinishedYouthTrainingOfferRelationsAsCoachBiographyList`).
  Recognitions are queried per education field (`JS_COACH`, `JS_LEADER_AND_EXPERT`, the observed filter
  values); a failing field is listed in `failedFields`, the others are still returned. `reason` is not
  requested.
- **Memory only**, like the Pendenzen: no Dexie table, not in the backup. Recognitions become Fristen-radar
  deadlines of the new kind `nds-recognition` (`domain/nds/recognitions.ts`, `ndsRecognitionsToDeadlines`,
  built inside `DeadlinesView` only). That kind is never sent to MCP or the AI (filtered out of the MCP
  deadline list); the ICS export includes it only by the coach's explicit action.
- Own person id: `nds_detect_person` reads `OfferList` with the selection `coach { businessId }` and returns
  the majority coach of the visible offers (at least `DETECT_MIN_SHARE` = 50 %, ties give none). The
  selection is **unverified live** (the captured operation selects the coach's names via a `Person`
  fragment). The coach can also enter the id manually. It is stored in `AppSettings.nds.personId` and is
  stripped from backups exported without red-derived data. It is NDS-derived and never goes to MCP or the AI.
- The three optional calls are tolerant: a 403 (or any failure) of one call never disconnects NDS and never
  fails the aggregate; the UI says that part is unavailable.

### 5. Camp ranking in the picker

`nds_find_camps` now also returns `organisationName` (`OfferList` selects the organisation name).
`domain/nds/match.ts` (`rankNdsCamps`) scores NDS camps against the eCamp camp (same or overlapping dates,
name match, organisation match with the coach's organisations) and marks at most one as the suggestion. It is
only a sort order and a hint; the coach still clicks the camp. No automatic link.

### 6. Rules

New rules `CMP-NDS-05` to `CMP-NDS-11` (pack `jslst` / coco-js-lst, next to CMP-NDS-01..04, from the attendance, details and protocol data). They
are hints or Soll, **never Muss**: the data is reverse-engineered, so their confidence is `unverified` or
`heuristic` (the engine already forbids Muss for `unverified`/`conflict`). Each has a source key from
`packs/sources.yaml`, German texts in its YAML and tests. JS-DL-01 uses `submittedOn` as described above.

### 7. Data handling

All new data is red-derived. `NdsAggregate` gains the optional fields `attendance`, `campDetails` and
`protocol` (serde default, so older stored aggregates still load); the `nds` table keeps them like the rest
of the aggregate. Nothing new goes to the AI or MCP (`ndsGuard`, `mcpGuard`, `aiGuard` tests). `NdsField`
gains `ndsClosedOn`.

## Unknowns (to verify live)

- Element shape of `overlaps` (only `offerNumber`, `activityType` selected).
- Shape of `minimalRequirementsCheckResultMessages` (only null observed).
- Exact German `protocolType` label texts (the keyword classification is a guess).
- The activity state code for an open attendance check (`ATTENDANCE_OPEN` is still inferred; only
  `ATTENDANCE_CHECKED` was observed).
- Recognition filter fields beyond the observed `educationField` and `person`.
- Whether `OfferList` accepts `coach { businessId }` for the own-person detection.

## Consequences

- Rules can say where a number came from (attendance, details, protocol) and judge NDS registration lateness.
- The coach types less (registration and closing dates, camp pick) and sees their own recognition expiry.
- **Terms-of-use risk is unchanged** (ADR 0007), but the **volume is higher**: up to 120 attendance calls plus
  the timeline, offer, protocol and details calls per camp refresh, and up to three calls for the coach data.
  It stays click-triggered and bounded; if BASPO objects, the feature is removed.
- AHV numbers, names and birth dates stay out of the requests; protocol free texts and `triggeringPerson`
  are not requested.
- Every assumption marked unverified may need a follow-up once a live check exists; unknown shapes are
  parsed tolerantly and drop to `null` instead of failing.

## Alternatives considered

- **Person-level reconciliation** (compare attendance names with eCamp/MiData). Rejected for now: puts names
  into the UI for little gain and is the part with the highest privacy cost.
- **Read attendance for all activities without a cap.** Rejected: the call count grows with camp length;
  60 activities cover normal camps, the rest is flagged `truncated`.
- **Persist recognitions and the coach profile in Dexie.** Rejected: red-derived and quickly stale; memory
  only (like the Pendenzen) avoids a schema change and a backup question.
- **Auto-link the best-ranked NDS camp.** Rejected: a wrong link silently feeds rules with the wrong camp.
- **Exact protocol label matching.** Rejected: the labels are not known; keyword classes with an `other`
  fallback degrade safely.
