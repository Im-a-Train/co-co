/**
 * Shared domain types of co-co (M1-M5). Shared by all modules; change with care.
 *
 * Framework-free: no Vue, no Tauri, no Dexie imports here. A module that needs an extra type
 * defines and exports it inside its own module folder instead of editing this file.
 *
 * Conventions
 * - IRIs are eCamp API paths without host, e.g. `/api/activities/b29d387cc403`.
 * - Dates: `YYYY-MM-DD` strings. Date-times: ISO 8601 strings as eCamp returns them.
 * - IMPORTANT eCamp time semantics: schedule entry / day times are camp-local wall-clock times that
 *   eCamp serialises with a `+00:00` offset ("2031-01-24T08:00:00+00:00" means 08:00 in the camp).
 *   Always read hours/minutes with UTC getters (getUTCHours) or by string slicing, never local getters.
 * - Persisted records are plain JSON (no class instances, no Date objects) so that export/import
 *   (M4 backup) is a straight JSON dump.
 */

// ---------------------------------------------------------------------------------------------
// Generic
// ---------------------------------------------------------------------------------------------

export type Iri = string
/** `YYYY-MM-DD` */
export type IsoDate = string
/** ISO 8601 date-time */
export type IsoDateTime = string

/** Injected HTTP GET against the eCamp API (path relative to the instance, e.g. `/api/camps?...`). */
export type ApiGet = <T = unknown>(path: string) => Promise<T>

export interface Source {
  title: string
  url: string
}

// ---------------------------------------------------------------------------------------------
// CampFacts: normalised camp graph (M1, built by domain/campFacts)
// ---------------------------------------------------------------------------------------------

export type CollaboratorRole = 'guest' | 'member' | 'manager'
export type CollaboratorStatus = 'invited' | 'established' | 'inactive'

export interface CampAddress {
  name: string | null
  street: string | null
  zipcode: string | null
  city: string | null
}

export interface CampInfo {
  iri: Iri
  /** Last path segment of the IRI, used in routes (/lager/:campId). */
  id: string
  title: string
  shortTitle: string | null
  motto: string | null
  kind: string | null
  organizer: string | null
  coachName: string | null
  courseKind: string | null
  courseNumber: string | null
  trainingAdvisorName: string | null
  address: CampAddress
  isPrototype: boolean
  /** Earliest period start / latest period end (null without periods). */
  start: IsoDate | null
  end: IsoDate | null
  /** M7: MiData event link set by eCamp when the camp was created from MiData (null/absent otherwise). */
  hitobitoEventId?: string | null
  hitobitoProvider?: string | null
}

export interface PeriodFact {
  iri: Iri
  description: string | null
  start: IsoDate
  end: IsoDate
}

export interface DayFact {
  iri: Iri
  periodIri: Iri
  /** 1-based day number within the period. */
  number: number
  dayOffset: number
  /** Camp-local calendar date of this day. */
  date: IsoDate
  start: IsoDateTime
  end: IsoDateTime
}

export interface ScheduleEntryFact {
  iri: Iri
  activityIri: Iri
  periodIri: Iri
  /** Day the entry starts on (null if eCamp did not link one). */
  dayIri: Iri | null
  start: IsoDateTime
  end: IsoDateTime
  durationMinutes: number
  dayNumber: number | null
  scheduleEntryNumber: number | null
  /** Display number, e.g. "1.2" */
  number: string | null
  left: number
  width: number
  ysPhysicalActivityDurationMinutes: number | null
}

/** Flattened content of one activity, derived from its content node tree (root == rootContentNode). */
export interface ActivityContent {
  /** Plain text of all Storyboard sections (columns joined), in section order. */
  storyboardText: string
  /** Plain text of all SafetyConsiderations nodes. */
  safetyText: string
  /** Plain text of Notes nodes. */
  notesText: string
  /** Plain text of LearningObjectives nodes. */
  learningObjectivesText: string
  /** Plain text of Material nodes (if any text present). */
  materialText: string
  /** Checked option keys (data.options[key].checked) of LAThematicArea multiselects. */
  laThematicAreas: string[]
  /** Checked option keys of LearningTopics multiselects. */
  learningTopics: string[]
  /** Checked option keys of YSActivityCharacteristics multiselects. */
  ysCharacteristics: string[]
  /** Sum of YSPhysicalActivityDuration content nodes (minutes), null if none. */
  ysPhysicalActivityDurationMinutes: number | null
  /** contentTypeName of every node in the tree (with duplicates removed). */
  contentTypes: string[]
  hasStoryboard: boolean
  hasSafetyConsiderations: boolean
  contentNodeCount: number
}

export interface ActivityFact {
  iri: Iri
  title: string
  location: string | null
  categoryIri: Iri | null
  progressLabelIri: Iri | null
  rootContentNodeIri: Iri | null
  /** camp_collaboration IRIs of the activity responsibles. */
  responsibleIris: Iri[]
  scheduleEntryIris: Iri[]
  content: ActivityContent
}

export interface CategoryFact {
  iri: Iri
  short: string
  name: string
  color: string
  numberingStyle: string | null
}

export interface CollaboratorFact {
  /** camp_collaboration IRI */
  iri: Iri
  userIri: Iri | null
  role: CollaboratorRole
  status: CollaboratorStatus
  /** Best display name: nickname, else "firstname surname", else invite e-mail local part, else "?". */
  displayName: string
  nickname: string | null
  firstname: string | null
  surname: string | null
  abbreviation: string | null
  isCurrentUser: boolean
}

export interface DayResponsibleFact {
  iri: Iri
  dayIri: Iri
  collaborationIri: Iri
}

export interface ActivityResponsibleFact {
  iri: Iri
  activityIri: Iri
  collaborationIri: Iri
}

export interface ProgressLabelFact {
  iri: Iri
  title: string
  position: number
}

export interface CommentFact {
  iri: Iri
  activityIri: Iri | null
  parentIri: Iri | null
  textHtml: string
  /** camp_collaboration or user IRI as returned by eCamp. */
  authorIri: Iri | null
  authorDisplayName: string | null
  createTime: IsoDateTime | null
  resolvedAt: IsoDateTime | null
}

export interface CampFacts {
  /** Schema version of this structure (bump when the shape changes; snapshots store it). */
  schemaVersion: 1
  loadedAt: IsoDateTime
  /** Base URL of the eCamp instance the facts came from. */
  instanceBaseUrl: string | null
  /** IRI of the logged-in user (coach). */
  userIri: Iri | null
  camp: CampInfo
  periods: PeriodFact[]
  days: DayFact[]
  scheduleEntries: ScheduleEntryFact[]
  activities: ActivityFact[]
  categories: CategoryFact[]
  collaborators: CollaboratorFact[]
  dayResponsibles: DayResponsibleFact[]
  activityResponsibles: ActivityResponsibleFact[]
  progressLabels: ProgressLabelFact[]
  comments: CommentFact[]
}

export interface LoadProgress {
  /** Machine step id, e.g. 'camp', 'periods', 'contentNodes'. */
  step: string
  done: number
  total: number
}

/** One row of "Meine Lager" (cheap: from /api/camps + periods, without full CampFacts). */
export interface CampListEntry {
  iri: Iri
  id: string
  title: string
  shortTitle: string | null
  motto: string | null
  start: IsoDate | null
  end: IsoDate | null
  /** Role of the current user in this camp (null if unknown). */
  role: CollaboratorRole | null
  isPrototype: boolean
}

// ---------------------------------------------------------------------------------------------
// Category mapping (M1)
// ---------------------------------------------------------------------------------------------

/** LS=Lagersport, LA=Lageraktivität, LP=Lagerprogramm, ES=Essen, NONE=no J+S relevance. */
export type CategoryClass = 'LS' | 'LA' | 'LP' | 'ES' | 'NONE'
/** Categories that count as J+S units. */
export const JS_UNIT_CLASSES: readonly CategoryClass[] = ['LS', 'LA'] as const

export interface CategoryGuess {
  categoryIri: Iri
  guess: CategoryClass
  confidence: 'high' | 'low'
  /** Short machine-readable reason, e.g. 'short:LS', 'name:lagersport', 'ys-characteristics'. */
  reason: string
}

/** Stored per camp; confirmed once by the coach. */
export interface CategoryMapping {
  campIri: Iri
  entries: Record<Iri, CategoryClass>
  confirmed: boolean
  confirmedAt: IsoDateTime | null
  updatedAt: IsoDateTime
}

// ---------------------------------------------------------------------------------------------
// Coach inputs ("Lager-Angaben", M1)
// ---------------------------------------------------------------------------------------------

export type Stufe = 'biber' | 'woelfe' | 'pfadi' | 'pios' | 'rover' | 'gemischt'

export interface CoachInputs {
  campIri: Iri
  /** Camp is announced as a J+S camp (rules of group 'js' only apply when true; null = unknown -> apply). */
  isJsCamp: boolean | null
  participantsCount: number | null
  /** Participants aged 5-20 (J+S age). */
  participantsJsAgeCount: number | null
  minAge: number | null
  maxAge: number | null
  stufe: Stufe | null
  leadersCount: number | null
  /** Persons with SLRG (or equivalent) water-safety qualification. */
  slrgCount: number | null
  /** Coach attests that the camp leader holds the "Zusatz Lagerleiter" (JS-LL-01). */
  lagerleiterAttested: boolean | null
  /** Deadline status flags (coach-maintained). */
  ndsRegistered: boolean
  ndsRegisteredOn: IsoDate | null
  ndsClosed: boolean
  ndsClosedOn: IsoDate | null
  leihmaterialOrdered: boolean
  landeskartenOrdered: boolean
  lagerbewilligungDone: boolean
  /** Free notes of the coach (zone yellow). */
  notes: string
  updatedAt: IsoDateTime
  /**
   * M7: fields whose current value was accepted from MiData («Aus MiData übernehmen»), with the
   * «Stand MiData» timestamp of the aggregate it came from. A manual edit of a field removes its entry.
   */
  midataFields?: Partial<Record<MidataField, IsoDateTime>>
  /**
   * M8: fields whose current value was accepted from NDS («Aus NDS übernehmen»), with the «Stand NDS»
   * timestamp of the aggregate it came from. A manual edit of a field removes its entry.
   */
  ndsFields?: Partial<Record<NdsField, IsoDateTime>>
}

// ---------------------------------------------------------------------------------------------
// MiData (M7, red zone). Shapes mirror coco-core/src/midata.rs (serde camelCase). Only aggregates
// ever reach the webview; raw person data stays in Rust. Never send any of this to the AI.
// ---------------------------------------------------------------------------------------------

export type MidataQualKey = 'lagerleiter' | 'leiterLsT' | 'wasser' | 'berg' | 'winter' | 'slrg'
export const MIDATA_QUAL_KEYS: readonly MidataQualKey[] = ['lagerleiter', 'leiterLsT', 'wasser', 'berg', 'winter', 'slrg']

export interface MidataAgeBand {
  from: number
  /** null = open-ended (21+) */
  to: number | null
  count: number
}

export interface MidataLeader {
  /** Yellow zone: nickname (or first name), never the full name. */
  nickname: string
  roleLabel: string
  /** Main leader (Hauptleitung); absent in aggregates stored before this field existed. */
  mainLeader?: boolean
  qualifications: Record<MidataQualKey, boolean>
}

export interface MidataAggregate {
  zone: 'red-derived'
  baseUrl: string
  eventId: string
  eventName: string
  eventDates: { startAt: IsoDate; finishAt: IsoDate }[]
  location: string | null
  maximumParticipants: number | null
  participantsCount: number
  /** Participants aged 5-20 at camp start. */
  participantsJsAgeCount: number
  participantsWithoutBirthday: number
  minAge: number | null
  maxAge: number | null
  ageBands: MidataAgeBand[]
  leadersCount: number
  leaders: MidataLeader[]
  /** event advisor == coach's MiData person id (null = unknown). */
  coachMatch: boolean | null
  /** «Stand MiData» */
  fetchedAt: IsoDateTime
}

export interface MidataEventSummary {
  id: string
  name: string
  startAt: IsoDate | null
  finishAt: IsoDate | null
  location: string | null
  /** Organisations (groups) running the event. */
  groupNames?: string[]
  /** Days overlapping the eCamp camp; null when the event has no dates. */
  overlapDays?: number | null
}

export interface MidataProbe {
  authMethod: string | null
  eventStatus: number
  participationsStatus: number
  participationsReadable: boolean
  peopleBirthdayReadable: boolean
  qualificationsStatus: number
  classicJsonStatus: number | null
  pbsFieldsPresent: string[]
  classicAttributeNames: string[]
}

export interface MidataStatus {
  connected: boolean
  baseUrl: string | null
  method: 'session' | 'token' | null
  cookieNames: string[]
}

/** Coach inputs that «Aus MiData übernehmen» can fill. */
export type MidataField =
  | 'participantsCount'
  | 'participantsJsAgeCount'
  | 'minAge'
  | 'maxAge'
  | 'leadersCount'
  | 'slrgCount'
  | 'lagerleiterAttested'

// ---------------------------------------------------------------------------------------------
// NDS (M8, red zone). Shapes mirror coco-core/src/nds.rs (serde camelCase). Only aggregates and
// counts cross the IPC boundary; no names, birth dates, AHV numbers, addresses, e-mails or IBANs.
// Unknown state codes are kept as raw strings.
// ---------------------------------------------------------------------------------------------

export interface NdsCounts {
  children: number | null
  adolescents: number | null
  totalParticipants: number | null
  totalInstructors: number | null
  jsInstructors: number | null
  campDays: number | null
  totalActivities: number | null
}

export interface NdsStatistics {
  planned: NdsCounts
  actual: NdsCounts
  coachAuthorizedForContribution: boolean | null
}

export interface NdsActivities {
  total: number
  /** activityState (raw code) -> count. */
  byState: Record<string, number>
  /** activityType (raw code) -> count. */
  byType: Record<string, number>
  lastActivityDate: IsoDate | null
  /** Activities in the known open-attendance state (ATTENDANCE_OPEN, inferred, not yet observed). */
  attendanceOpenCount: number
}

export interface NdsRentalOrder {
  orderState: string | null
  dispatchmentDate: IsoDate | null
  returnDate: IsoDate | null
}

export interface NdsAggregate {
  offerBusinessId: string
  campBusinessId: string
  offerNumber: string | null
  start: IsoDate | null
  end: IsoDate | null
  /** Raw state codes (see NDS_STATE_LABELS in domain/nds). */
  offerState: string | null
  offerItemState: string | null
  /** Date of approvalTimestamp («bewilligt am»). */
  approvedOn: IsoDate | null
  statistics: NdsStatistics
  /** involvementType (raw code) -> count. */
  supervisorCounts: Record<string, number>
  participantCount: number
  /** targetAudienceGroup (raw code) -> count. */
  participantCountsByAudience: Record<string, number>
  activities: NdsActivities
  campAgendaUploaded: boolean | null
  rentalOrders: NdsRentalOrder[]
  /** «Stand NDS» */
  fetchedAt: IsoDateTime
}

export interface NdsCampSummary {
  offerBusinessId: string
  campBusinessId: string
  offerNumber: string | null
  offerItemNumber: string | null
  groupName: string | null
  start: IsoDate | null
  end: IsoDate | null
  offerState: string | null
  offerItemState: string | null
}

export interface NdsProbeEndpoint {
  name: string
  status: number | null
  fieldsPresent: string[]
  fieldsMissing: string[]
}

/** Diagnosis: HTTP status per endpoint and field NAMES only. */
export interface NdsProbe {
  connected: boolean
  endpoints: NdsProbeEndpoint[]
}

export interface NdsStatus {
  connected: boolean
  /** Cookie names only, never values. */
  cookieNames: string[]
}

/** Coach inputs that «Aus NDS übernehmen» can fill. */
export type NdsField = 'ndsRegistered' | 'ndsRegisteredOn' | 'ndsClosed'

/** Dexie table `nds` (one per camp). Tagged red-derived: AI gateway refuses it; backup may omit it. */
export interface NdsRecord {
  campIri: Iri
  zone: 'red-derived'
  /** NDS ids the camp is linked to (null = not linked yet). */
  link: { offerBusinessId: string; campBusinessId: string } | null
  aggregate: NdsAggregate | null
  fetchedAt: IsoDateTime | null
  updatedAt: IsoDateTime
}

/** Dexie table `midata` (one per camp). Tagged red-derived: AI gateway refuses it; backup may omit it. */
export interface MidataRecord {
  campIri: Iri
  zone: 'red-derived'
  /** MiData event id the camp is linked to (null = not linked yet). */
  eventId: string | null
  /** 'ecamp' = from camp.hitobitoEventId, 'manual' = picked by the coach. */
  eventSource: 'ecamp' | 'manual' | null
  aggregate: MidataAggregate | null
  updatedAt: IsoDateTime
}

// ---------------------------------------------------------------------------------------------
// Rules + findings (M1)
// ---------------------------------------------------------------------------------------------

export type Severity = 'must' | 'should' | 'hint'
export type Confidence = 'verified' | 'conflict' | 'unverified' | 'best-practice' | 'heuristic'
export type FindingScope = 'camp' | 'day' | 'activity' | 'scheduleEntry' | 'document'
export type RuleGroup = 'js' | 'completeness' | 'safety' | 'best-practice'
export type FindingOrigin = 'rule' | 'ai'
/** Which extra inputs a rule needs; used by the UI to explain "needs coach input" etc. */
export type RuleInput = 'mapping' | 'coachInputs' | 'documents' | 'settings'

export interface Evidence {
  kind: 'camp' | 'day' | 'activity' | 'scheduleEntry' | 'document' | 'text'
  iri?: Iri
  /** Document id for kind 'document'. */
  documentId?: string
  label: string
  snippet?: string
}

/** Static rule metadata, loaded from the rule's YAML. */
export interface RuleMeta {
  id: string
  /** Version of this rule (semver-ish string), bumped on behaviour change. */
  version: string
  group: RuleGroup
  title: string
  description: string
  /** Message template with `{param}` placeholders filled from RuleHit.params. */
  message: string
  severity: Severity
  confidence: Confidence
  scope: FindingScope
  /** Rule applies to camps starting on/after validFrom and on/before validTo. */
  validFrom?: IsoDate
  validTo?: IsoDate
  source: Source
  inputs?: RuleInput[]
  tags?: string[]
}

/** What a predicate returns for each violation. Empty array = rule satisfied. */
export interface RuleHit {
  /** IRIs (or document ids) the finding is about; first one is the primary target. */
  targets: string[]
  evidence?: Evidence[]
  params?: Record<string, string | number>
  /** Optional severity downgrade for this hit (never upgrade above meta.severity). */
  severity?: Severity
}

export interface RuleContext {
  facts: CampFacts
  mapping: CategoryMapping | null
  coachInputs: CoachInputs | null
  /** M7: MiData aggregate of the camp (red-derived; null/absent = not connected). */
  midata?: MidataAggregate | null
  /** M8: NDS aggregate of the camp (red-derived; null/absent = not connected). */
  nds?: NdsAggregate | null
  documents: DocumentRecord[]
  settings: AppSettings
  /** Evaluation time (injected for testability). */
  now: Date
  /** Display name of the logged-in coach (for CMP-CAMP-01). */
  userDisplayName: string | null
  overrides: Override[]
}

export type RulePredicate = (ctx: RuleContext) => RuleHit[]

export interface Rule {
  meta: RuleMeta
  check: RulePredicate
}

export interface RulePack {
  id: string
  /** Display name, e.g. "co-co Basis 2026.1" */
  name: string
  version: string
  description: string
  validFrom?: IsoDate
  validTo?: IsoDate
  rules: Rule[]
}

export interface Finding {
  /** Stable id: `${ruleId}:${targets.join('|')}` (used for overrides + feedback links). */
  id: string
  ruleId: string
  ruleVersion: string
  packId: string | null
  severity: Severity
  confidence: Confidence
  title: string
  message: string
  scope: FindingScope
  targets: string[]
  evidence: Evidence[]
  source: Source | null
  origin: FindingOrigin
  /** e.g. ['KI-Einschätzung'] for AI findings. */
  tags: string[]
  /** Set when the coach overrode this finding. */
  override: Override | null
}

export interface FindingCounts {
  must: number
  should: number
  hint: number
  overridden: number
}

export interface Override {
  id: string
  campIri: Iri
  findingId: string
  ruleId: string
  reason: string
  createdAt: IsoDateTime
}

/** Cached per-camp summary for "Meine Lager" (written after each evaluation). */
export interface CampSummaryRecord {
  campIri: Iri
  title: string
  start: IsoDate | null
  end: IsoDate | null
  counts: FindingCounts
  validJsDays: number | null
  totalDays: number | null
  /** Date of the last J+S unit (null if unknown), for the deadlines page. */
  lastJsDate?: IsoDate | null
  evaluatedAt: IsoDateTime
}

export type DeadlineKind = 'nds-registration' | 'nds-closing' | 'leihmaterial' | 'landeskarten' | 'lagerbewilligung'

export interface Deadline {
  campIri: Iri
  campTitle: string
  kind: DeadlineKind
  due: IsoDate
  done: boolean
  ruleId: string | null
  source: Source | null
}

// ---------------------------------------------------------------------------------------------
// Feedback (M2)
// ---------------------------------------------------------------------------------------------

export type FeedbackScope = 'camp' | 'activity'
export type FeedbackKind = 'kudos' | 'must' | 'suggestion' | 'question'
export type FeedbackStatus = 'draft' | 'posted' | 'sent'
export type FeedbackTemplateId =
  | 'grobprogramm'
  | 'programmbesprechung'
  | 'auflagen'
  | 'nach-dem-lagerbesuch'
  | 'abschluss'
export type FeedbackChannel = 'whatsapp' | 'email' | 'plain'

export interface FeedbackItem {
  id: string
  campIri: Iri
  scope: FeedbackScope
  activityIri?: Iri
  kind: FeedbackKind
  text: string
  /** Text quotes MiData (red-derived): refused by the AI gateway. */
  redDerived?: boolean
  ruleId?: string
  findingId?: string
  roundId?: string
  status: FeedbackStatus
  postedCommentIri?: Iri
  /** Number of comment parts already posted (resume after a partial failure). */
  postedParts?: number
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

// ---------------------------------------------------------------------------------------------
// Documents (M3)
// ---------------------------------------------------------------------------------------------

export type DocumentKind = 'pdf' | 'docx' | 'gpx' | 'txt' | 'md' | 'other'
export type DocumentSource = 'drop' | 'picker' | 'folder'
export type SafetyCheckKey =
  | 'emergencyNumbers'
  | 'hospital'
  | 'crisisContact'
  | 'evacuation'
  | 'badWeather'
  | 'threeByThree'
  | 'firstAid'
  | 'campAddress'

export interface DocCheckItem {
  key: SafetyCheckKey
  found: boolean
  snippets: string[]
}

export interface DocCheckResult {
  items: DocCheckItem[]
  complete: boolean
  checkedAt: IsoDateTime
}

export interface GpxStats {
  name: string | null
  pointCount: number
  distanceKm: number
  ascentM: number
  descentM: number
  /** km + ascent/100 */
  lkm: number
  /** km + ascent/100 + descent/150 */
  lkmWithDescent: number
  paceLkmPerHour: number
  estimatedMinutes: number
  highestPointM: number | null
  lowestPointM: number | null
}

export interface ActivityLinkSuggestion {
  activityIri: Iri
  /** 0..1 */
  score: number
  reason: string
}

export interface DocumentRecord {
  id: string
  campIri: Iri
  /** Absolute path on disk (original stays there). */
  path: string
  name: string
  kind: DocumentKind
  size: number
  modifiedMs: number
  importedAt: IsoDateTime
  source: DocumentSource
  /** Watched folder path when source === 'folder'. */
  folder: string | null
  /** SHA-256 (hex) of the original bytes. */
  contentHash: string
  text: string
  extractError: string | null
  /** Confirmed links. */
  activityIris: Iri[]
  /** Unconfirmed candidates ("bestätigen?"). */
  linkSuggestions: ActivityLinkSuggestion[]
  docCheck: DocCheckResult | null
  gpx: GpxStats | null
  /** Data zone; documents default to 'yellow'. */
  zone: Zone
  /** Coach must explicitly allow AI use per document; default false. */
  aiAllowed: boolean
  /** Optional AI summary (M5), only if aiAllowed. */
  aiSummary: string | null
}

export interface WatchedFolder {
  id: string
  campIri: Iri
  path: string
  addedAt: IsoDateTime
}

// ---------------------------------------------------------------------------------------------
// Rounds + review status + snapshots + diff (M4)
// ---------------------------------------------------------------------------------------------

export type ReviewStatus = 'neu' | 'in_review' | 'aenderungen_angefragt' | 'bewilligt' | 'bewilligt_mit_auflagen'

export interface ReviewStatusChange {
  status: ReviewStatus
  at: IsoDateTime
  note: string | null
}

export interface ReviewState {
  campIri: Iri
  status: ReviewStatus
  history: ReviewStatusChange[]
  updatedAt: IsoDateTime
}

export interface Round {
  id: string
  campIri: Iri
  /** 1..n */
  number: number
  startedAt: IsoDateTime
  closedAt: IsoDateTime | null
  snapshotId: string
  note: string
  /** Set when the coach exported a backup after this round. */
  exportedAt: IsoDateTime | null
}

export type SnapshotEntityType = 'camp' | 'period' | 'day' | 'activity' | 'scheduleEntry' | 'activityContent' | 'category'

export interface SnapshotEntity {
  type: SnapshotEntityType
  /** Human label (activity title, entry number + title, ...). */
  label: string
  /** Stable content hash (hex) of the normalised entity. */
  hash: string
}

export interface Snapshot {
  id: string
  campIri: Iri
  roundId: string
  createdAt: IsoDateTime
  /** Keyed by IRI; activity content uses key `${activityIri}#content`. */
  entities: Record<string, SnapshotEntity>
  /** Full facts for detail diffs. */
  facts: CampFacts
}

export type DiffChange = 'added' | 'changed' | 'removed'

export interface DiffEntry {
  key: string
  type: SnapshotEntityType
  label: string
  change: DiffChange
  /** Changed field names (for 'changed'), when known. */
  fields?: string[]
  /** Related activity IRI (for scheduleEntry / activityContent). */
  activityIri?: Iri
}

export interface Diff {
  campIri: Iri
  fromRoundId: string | null
  /** null = current (live) facts */
  toRoundId: string | null
  entries: DiffEntry[]
  counts: Record<DiffChange, number>
}

// ---------------------------------------------------------------------------------------------
// Data zones + AI (M5)
// ---------------------------------------------------------------------------------------------

/** See docs/adr/0005-data-zones-and-ai.md. Unclassified data counts as red. */
export type Zone = 'green' | 'yellow' | 'red'

export interface Zoned<T> {
  zone: Zone
  value: T
  /** True once redact() processed a yellow value; aiGateway refuses unredacted yellow. */
  redacted?: boolean
}

export type AiModel = 'claude-sonnet-5-5' | 'claude-opus-5-5' | 'claude-haiku-5-5'
export type AiFeature = 'rephrase' | 'summarise' | 'safetyReview'

export interface AiLogEntry {
  id?: number
  at: IsoDateTime
  feature: AiFeature
  model: AiModel
  campIri: Iri | null
  inputTokens: number
  outputTokens: number
  /** Number of replacements made by redaction. Never stores prompt or response text. */
  redactions: number
  ok: boolean
  error: string | null
}

// ---------------------------------------------------------------------------------------------
// App settings (stored in db.settings under key 'app')
// ---------------------------------------------------------------------------------------------

export interface AppSettings {
  ai: {
    enabled: boolean
    model: AiModel
  }
  gpx: {
    /** Leistungskilometer per hour (default 4). */
    paceLkmPerHour: number
    /** Pace for Wölfe (default 3.5). */
    paceWoelfeLkmPerHour: number
    /** Include descent/150 in Lkm (default false). */
    includeDescent: boolean
  }
  backup: {
    remindAfterRound: boolean
    lastExportAt: IsoDateTime | null
  }
  /** Enabled rule pack ids (empty = all bundled packs). */
  rulePacks: string[]
  /** M7: MiData connection settings (no secrets; token/cookies live in Rust/keychain). */
  midata: {
    /** Base URL of the MiData instance (default https://db.scout.ch). */
    baseUrl: string
    /** The coach's own MiData person id (for the coach match, CMP-CAMP-01). */
    personId: string | null
  }
  /** M8: NDS connection settings (no secrets; the session cookie lives in Rust/keychain). */
  nds: {
    enabled: boolean
  }
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  ai: { enabled: false, model: 'claude-sonnet-5-5' },
  gpx: { paceLkmPerHour: 4, paceWoelfeLkmPerHour: 3.5, includeDescent: false },
  backup: { remindAfterRound: true, lastExportAt: null },
  rulePacks: [],
  midata: { baseUrl: 'https://db.scout.ch', personId: null },
  nds: { enabled: false },
}

// ---------------------------------------------------------------------------------------------
// Backup (M4)
// ---------------------------------------------------------------------------------------------

export const EXPORT_FORMAT = 'co-co-export' as const
export const EXPORT_VERSION = 1 as const

export interface CocoExport {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  exportedAt: IsoDateTime
  appVersion: string
  /** Keyed by Dexie table name (see storage/db.ts TABLE_NAMES); aiLog is included. */
  tables: Record<string, unknown[]>
}
