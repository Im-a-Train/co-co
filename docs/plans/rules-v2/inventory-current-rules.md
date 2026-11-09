# co-co rule set inventory: what exists and what packs can see

Repo: `C:\Users\melvi\dev\co-co\apps\desktop\src\domain\rules\`. All paths below are relative to `apps/desktop/src/domain/` unless stated otherwise.

## (1) The rules: 48 in one pack, `coco-basis`

The pack is `coco-basis` (name "co-co Basis 2026.1", version 2026.1.0, validFrom 2026-01-01). It has 48 rules: 14 J+S, 21 completeness, 8 safety and 5 best practice. The README still says "33 rules", which is out of date. All rules have version 1.0.0 and validFrom 2026-01-01, except JS-BWZ-27, which starts 2027-01-01. "jsApplies" means the rule is skipped only when `coachInputs.isJsCamp === false`.

Source URLs:
- **L** = https://www.jugendundsport.ch/de/lager
- **C** = https://www.jugendundsport.ch/de/leitfaden-coach
- **LT** = https://www.jugendundsport.ch/de/lagersport-trekking
- **H** = https://hering.scout.ch/de
- **MD** = https://db.scout.ch

### Group `js`

| id | sev | conf | scope | inputs | predicate actually checks | src |
|---|---|---|---|---|---|---|
| JS-CAMP-01 | must | verified | camp | – | Longest run of consecutive `facts.days` dates must be ≥ 4. | L |
| JS-CAMP-02 | must | verified | camp | coachInputs | Uses `participantsJsAgeCount`, else `participantsCount`. Fires if the value is < 12. If the value is missing, it fires as a hint ("Angabe fehlt"). Adds a MiData "Stand" if the field came from MiData. | L |
| JS-DAY-01 | must | verified | day | mapping | Needs a confirmed mapping. If no category is LS/LA, gives one camp hint. Skips the first and last day (JS-DAY-04 handles them) and days with 0 units (JS-FREE-01 handles them). Fires unless the day has ≥ 2 units and ≥ 240 min (`quantityOk`). | L |
| JS-DAY-02 | must | verified | scheduleEntry | mapping | Every LS/LA unit must be ≥ 30 min. | L |
| JS-DAY-03 | must | verified | day | mapping | Gaps between merged J+S blocks must be ≥ 30 min (Sozialzeit). | L |
| JS-DAY-04 | must | verified | day | mapping | Fires unless the first and last days are both valid, or they are `validCombined` (together ≥ 2 units and ≥ 240 min, and both pass unit length and gaps). Downgrades to hint when the combined minutes are 0. Targets are `[first, last]`. | L |
| JS-DAY-05 | should | heuristic | activity | mapping | Looks at the first 400 characters of a J+S activity's storyboard for a WARMUP keyword: `einstimm, aufwärm, aufwaerm, warm-up, warmup, warm up, einlauf, einspiel, ankommen, aufwaermen`. Skips activities with an empty storyboard. | L |
| JS-DL-01 | must | verified | camp | coachInputs | Due date is start − 30 days (`ndsRegistered`/`ndsRegisteredOn`). Fires if late, or if overdue and not done. Hint if due within ≤ 14 days. An approval date taken over from NDS is never treated as "late". | L |
| JS-DL-02 | must | verified | camp | coachInputs | Due date is the last J+S day (else camp end) + 30 days (`ndsClosed`/`ndsClosedOn`). Fires on overdue or late. Hint inside the final 14 days. | L |
| JS-DL-03 | should | verified | camp | coachInputs | Leihmaterial: start − 35 days. Landeskarten: start − 21 days, or − 35 days if the camp starts in June–August. Fires if overdue, not ordered, and the camp has not started. Targets are `[camp, kind]`. | L |
| JS-LL-01 | must | verified | camp | coachInputs | `lagerleiterAttested` must be true. If null, it fires as a hint. If false and the value came from MiData, the message says so. | C |
| JS-STAFF-01 | should | conflict | camp | coachInputs | Needed leaders = max(`MIN_LEADERS`=2, ceil(p / `MAX_PARTICIPANTS_PER_LEADER`=10)). Fires if leaders < needed. | C |
| JS-FREE-01 | should | conflict | day | mapping | Fires for days with 0 J+S units that are not part of the arrival/departure combination. | L |
| JS-BWZ-27 | hint | unverified | day | – | Sums `ysPhysicalActivityDurationMinutes` per date: the schedule-entry value, else the activity value if the activity has only one entry. Fires if the sum is < `BWZ_MINUTES`=120. With no data at all it gives one camp hit. | L |

### Group `completeness`

| id | sev | conf | scope | inputs | checks | src |
|---|---|---|---|---|---|---|
| CMP-ACT-01 | should | best-practice | activity | – | `responsibleIris` is empty. | H |
| CMP-ACT-02 | should | best-practice | activity | mapping | LS/LA activity without storyboard text. | H |
| CMP-ACT-03 | should | heuristic | activity | mapping | Activity is LS, or its title, location or storyboard matches OUTDOOR, WATER, MOUNTAIN or ROPE; and its safety text is empty. Works without a mapping too (then keywords only). | LT |
| CMP-LA-01 | should | best-practice | activity | mapping | LA activity with empty `laThematicAreas`. | L |
| CMP-DAY-01 | hint | best-practice | day | – | Day has no `dayResponsible`. | H |
| CMP-CAMP-01 | hint | best-practice | camp | – | `camp.coachName` is empty, or shares no name token with `userDisplayName`. Also fires if `midata.coachMatch === false`. | C |
| CMP-MD-01 | hint | best-practice | camp | – | eCamp dates vs. the MiData date range (`datesDiffer`); MiData `location` vs. camp city/name by substring (`locationDiffers`). | MD |
| CMP-NDS-01 | hint | best-practice | camp | – | `ndsDatesDiffer`: eCamp start/end ≠ NDS start/end. | L |
| CMP-NDS-02 | should | best-practice | camp | – | After the camp end, fires if `nds.activities.attendanceOpenCount` > 0. | C |
| CMP-NDS-03 | hint | best-practice | camp | – | NDS `planned.totalParticipants` vs. MiData `participantsCount`, else the coach's count. Fires above 20 % difference relative to the larger value (`participantsDiffer`, threshold 0.2). | L |
| CMP-PROG-01 | hint | best-practice | camp | – | From start − 21 days onwards, fires if activities are not on the highest-position progress label. | H |
| CMP-CON-01 | hint | conflict | camp | – | MiData date range ≠ NDS start/end. | L |
| CMP-CON-02 | hint | conflict | camp | – | Leader counts disagree. eCamp counts active collaborators (status established, role member or manager). MiData uses `leadersCount`. NDS uses `planned.totalInstructors`, else the sum of `supervisorCounts`. | L |
| CMP-CON-03 | hint | heuristic | camp | – | Matches the eCamp team to MiData leader nicknames by normalized name. Only judged if at least one name matches. Lists who is only in eCamp or only in MiData (at most 10 names). | L |
| CMP-CON-04 | should | conflict | camp | – | NDS `planned.jsInstructors` > number of MiData leaders with `leiterLsT` or `lagerleiter`. | L |
| CMP-CON-05 | should | conflict | camp | – | `qualificationKinds` with `expiredLeaders` > 0 whose keys (after `settings.midata.qualMapping`) include leiterLsT, lagerleiter, wasser, berg, winter or slrg. | L |
| CMP-CON-06 | hint | conflict | camp | – | No MiData leader has `mainLeader === true`. Only judged if the field is present. | L |
| CMP-CON-07 | hint | conflict | camp | – | NDS `planned.campDays` ≠ `facts.days.length` (or the length of the date span). | L |
| CMP-CON-08 | hint | conflict | camp | – | MiData `participantsCount` > `maximumParticipants`. | L |
| CMP-CON-09 | hint | conflict | camp | – | MiData `participantsWithoutBirthday` > 0. | L |
| CMP-CON-10 | hint | conflict | camp | – | NDS `participantCount` vs. MiData `participantsCount`, more than 20 % apart. | L |

### Group `safety`

| id | sev | conf | scope | inputs | checks | src |
|---|---|---|---|---|---|---|
| SAFE-WATER-01 | should | heuristic | activity | – | All activity text matches WATER, and any of these is true: no responsible person; empty safety text; or the responsible people matched in MiData have neither `wasser` nor `slrg`. | LT |
| SAFE-MTN-01 | should | heuristic | activity | documents | All activity text matches MOUNTAIN, no document is linked, and the text has none of the phrases `zeitberechnung, alternativroute, alternativ-route, alternative route`. | LT |
| SAFE-MTN-02 | should | heuristic | activity | documents, settings | Marching time estimated from a linked GPX file is longer than the longest schedule-entry slot. Pace is `settings.gpx.paceLkmPerHour` (4), or `paceWoelfeLkmPerHour` (3.5) if stufe = woelfe. `includeDescent` also applies. Targets are `[activity, docId]`. | LT |
| SAFE-MTN-03 | should | heuristic | activity | – (uses midata) | Activity matches MOUNTAIN; its responsible people are matched to MiData leaders by name; none of them has `berg`. Skipped if `qualificationsReadable === false`. Winter is not checked. | LT |
| SAFE-ROPE-01 | should | heuristic | activity | – | Title, location or storyboard matches ROPE, and either the safety text is < `ROPE_MIN_CHARS`=200 or it mentions none of `sicherung, verankerung, bremse`. | LT |
| SAFE-NIGHT-01 | hint | heuristic | activity | – | Triggered by the NIGHT keyword, or by an entry ending after 22:00 (`NIGHT_END_MINUTES`) or running past midnight. Fires if the safety text is empty, or if the next start the following morning (between 05:00 and 14:00) leaves < `MIN_REST_MINUTES`=510 (8.5 h). | H |
| SAFE-WX-01 | hint→should* | heuristic | day | documents | For a day with at least one OUTDOOR, WATER, MOUNTAIN or ROPE activity, fires if no activity text on that day contains a SCHLECHTWETTER_PHRASE. Skipped entirely if any document's docCheck has `badWeather` found. | H |
| SAFE-DOC-01 | should | heuristic | document | documents | Takes the document with the most docCheck items found and lists the missing items (8 keys). If no checked document exists, gives a camp hint. Targets are `[camp, docId]`. | LT |

\*SAFE-WX-01's YAML severity is `should`.

### Group `best-practice`

| id | sev | conf | scope | inputs | checks | src |
|---|---|---|---|---|---|---|
| BP-REST-01 | hint | best-practice | day | mapping | Needs a mapping. A day passes if it has an entry whose category is NONE, or a free gap of ≥ `REST_GAP_MINUTES`=60 between 07:00 and 22:00 (`REST_WINDOW`). | H |
| BP-SLEEP-01 | hint | heuristic | day | coachInputs | Time from the last end of day i−1 to the first start of day i must be ≥ `SLEEP_HOURS[stufe]`: biber 11, woelfe 10, pfadi 9, pios 8.5, rover 8, gemischt 9. | H |
| BP-WOLF-01 | hint | best-practice | camp | coachInputs | When stufe = woelfe, fires if leaders < ceil(participants / 6). | H |
| BP-WATER-01 | hint | best-practice | camp | coachInputs | If any activity matches WATER, fires if `slrgCount` < ceil(participants / 12). | H |
| BP-VAR-01 | hint | best-practice | camp | mapping | With ≥ 4 J+S units, fires if max(distinct categories, distinct `ysCharacteristics`) < 2. | H |

### Keyword sets (`packs/basis/predicates/util.ts`)

Matching syntax: a plain stem matches if the token contains it; `=word` is an exact match, also allowing the endings e/en/n/s; `^` is a prefix match; `$` is a suffix match. Exclusions are token prefixes. The tokenizer also strips "baden-powell".

- **WATER:** `=baden, badi, schwimm, =see, $see, fluss, =bach, $bach, =aare, =reuss, =rhein, kanu, kajak, kayak, =boot, $boot, wasser, rafting, tauchen, weiher, =teich, strand, ruder`. Excludes `trinkwasser, wasserflasche, wasserkanister, wasserhahn, wasserstelle, abwasser, seeland`.
- **MOUNTAIN:** `wanderung, wandern, hike, hiking, berg, gipfel, =pass, biwak, bivouac, =ski, ^skitour, ^skifahr, ^skilager, kletter, trekking, höhenmeter, hoehenmeter, alpwanderung`. Excludes `bergfest`.
- **ROPE:** `seil, pionier, abseil, hochseil, flying fox, flyingfox`. Excludes `seilziehen, seilspringen, seilspiel`. Note: "flying fox" can never match because tokens have no spaces.
- **NIGHT:** `^nacht`. Excludes `nachtessen, nachtisch, nachtrag, nachtmahl, nachtruhe`.
- **OUTDOOR:** about 35 stems: `draussen, outdoor, wald, wiese, gelände…, wanderung, berg, biwak, ausflug, =feuer, ^feuerstelle, orientierungslauf, postenlauf, schnitzeljagd, rakete, bräteln, zeltplatz, lagerplatz, spielplatz, hajk, abseil, seilbahn, pionier, kanu, baden, schwimm, velo, radtour…`.
- **SCHLECHTWETTER_PHRASES:** `schlechtwetter, schlechtes wetter, regenprogramm, regenvariante, bei regen, bei schlechtem wetter, regenwetter, plan b`.
- **Local lists in predicates:** `WARMUP` in js.ts, `MTN_SATISFIED` and `ROPE_TOPICS` in safety.ts, `RECOGNITION_KEYS` in consistency.ts.

## (2) Data available to predicates (`RuleContext` in `types.ts`)

**`facts: CampFacts`** (schemaVersion 1):
- **`camp`:** iri, id, title, shortTitle, motto, kind, organizer, coachName, courseKind, courseNumber, trainingAdvisorName, `address{name,street,zipcode,city}`, isPrototype, start, end, hitobitoEventId, hitobitoProvider.
- **`periods[]`:** iri, description, start, end.
- **`days[]`:** iri, periodIri, number (within the period), dayOffset, date, start, end.
- **`scheduleEntries[]`:** iri, activityIri, periodIri, dayIri, start, end (wall clock, "+00:00"), durationMinutes, dayNumber, scheduleEntryNumber, number, left, width, `ysPhysicalActivityDurationMinutes`.
- **`activities[]`:** iri, title, location, categoryIri, progressLabelIri, rootContentNodeIri, responsibleIris, scheduleEntryIris, plus a `content` object:
  - texts: storyboardText, safetyText, notesText, learningObjectivesText, materialText
  - checked option keys: laThematicAreas, learningTopics, ysCharacteristics
  - ysPhysicalActivityDurationMinutes, contentTypes[], hasStoryboard, hasSafetyConsiderations, contentNodeCount
  - Source content types: Storyboard, SafetyConsiderations, Notes, LearningObjectives, Material, LAThematicArea, LearningTopics, YSActivityCharacteristics, YSPhysicalActivityDuration.
- **`categories[]`:** iri, short, name, color, numberingStyle.
- **`collaborators[]`:** iri, userIri, role (guest/member/manager), status (invited/established/inactive), displayName, nickname, firstname, surname, abbreviation, isCurrentUser.
- **Also:** dayResponsibles, activityResponsibles, `progressLabels{iri,title,position}`, `comments{…textHtml, author, createTime, resolvedAt}`, loadedAt, instanceBaseUrl, userIri.

**`mapping: CategoryMapping | null`:**
- Passed only when the coach has confirmed it.
- `entries: categoryIri → 'LS'|'LA'|'LP'|'ES'|'NONE'`. Only LS and LA count as J+S units (`JS_UNIT_CLASSES`).
- The automatic guess (`campFacts/index.ts` `guessCategories`) uses the hard-coded regex list `NAME_RULES`.

**`coachInputs: CoachInputs | null`:**
- isJsCamp, participantsCount, participantsJsAgeCount, minAge, maxAge, stufe (biber/woelfe/pfadi/pios/rover/gemischt), leadersCount, slrgCount, lagerleiterAttested.
- Deadline fields: ndsRegistered, ndsRegisteredOn, ndsClosed, ndsClosedOn, leihmaterialOrdered, landeskartenOrdered, lagerbewilligungDone.
- notes, updatedAt.
- `midataFields{field→timestamp}`, `ndsFields{field→timestamp}`, `milestonesDone{id→date}`.
- There are no fields yet for an LS/T discipline, a Sicherheitsbereich (Berg, Wasser, Winter), an offer type or trekking.

**`midata: MidataAggregate | null`** (red-derived, aggregates only):
- eventId, eventName, `eventDates[]`, location, maximumParticipants.
- participantsCount, participantsJsAgeCount, participantsWithoutBirthday, minAge, maxAge, `ageBands[{from,to,count}]`.
- leadersCount, `leaders[{nickname, roleLabel, mainLeader?, qualifications{lagerleiter, leiterLsT, wasser, berg, winter, slrg}}]`.
- coachMatch, coachNickname, qualificationsReadable, `qualificationKinds[{label, keys, validLeaders, expiredLeaders}]`, fetchedAt.
- Qualification labels are mapped to keys in Rust: `src-tauri/crates/coco-core/src/midata.rs` `qual_keys_for_label`, using hard-coded substrings such as `lagerleit, zusatz lager, lagersport, trekking, ls/t, wasser, modul see/fluss/pool, berg, winter, schnee, slrg, brevet…`. The coach can override this per label via `settings.midata.qualMapping`.

**`nds: NdsAggregate | null`** (red-derived):
- offerBusinessId, campBusinessId, offerNumber, start, end, offerState, offerItemState, approvedOn.
- `statistics.planned` and `statistics.actual`: `{children, adolescents, totalParticipants, totalInstructors, jsInstructors, campDays, totalActivities}`; plus coachAuthorizedForContribution.
- supervisorCounts{involvementType→n}, participantCount, participantCountsByAudience{code→n}.
- `activities{total, byState, byType, lastActivityDate, attendanceOpenCount}`.
- campAgendaUploaded, `rentalOrders[{orderState, dispatchmentDate, returnDate}]`, fetchedAt.
- `campAgendaUploaded`, `rentalOrders`, `byType` and `actual.*` exist but no rule reads them.

**Other context:**
- **`documents: DocumentRecord[]`:**
  - Each record has: text, kind, activityIris (confirmed links), linkSuggestions, `docCheck{items[{key, found, snippets}]}`, `gpx{distanceKm, ascentM, descentM, lkm, lkmWithDescent, estimatedMinutes, highest/lowest point…}`, zone, aiAllowed.
  - The docCheck keys and regexes are hard-coded in `documents/index.ts`: `EMERGENCY_NUMBERS` (144, 1414, 117, 118, 145; 144 plus ≥ 2 others required) and `PATTERNS` (hospital, crisisContact, evacuation, badWeather, threeByThree, firstAid, plus `COORD_RE`).
- **`settings: AppSettings`:** `gpx{paceLkmPerHour 4, paceWoelfeLkmPerHour 3.5, includeDescent}`, `rulePacks: string[]`, `midata.qualMapping`, ai, nds, backup.
- **Also:** `now`, `userDisplayName`, `overrides`.

**Shared helpers predicates use:**
- `jsDays.ts`: `MIN_UNIT_MINUTES`=30, `MIN_GAP_MINUTES`=30, `MIN_DAY_MINUTES`=240, `MIN_DAY_UNITS`=2, plus `computeJsDays`, `quantityOk`, `trainingFreeDays`, `wallDate/wallMinutes`.
- `deadlines.ts`: `NDS_REGISTRATION_LEAD_DAYS`=30, `NDS_CLOSING_DAYS`=30, `LEIHMATERIAL_LEAD_DAYS`=35, landeskarten 21/35 (June–August), `BEWILLIGUNG_LEAD_DAYS`=21; "soon" means ≤ 14 days.
- `milestones.ts` with `milestones/pbs.yaml`: 8 PBS milestones, all `unverified`, defined as offsets from camp start or end. This list is not a rule; it feeds the deadline radar.

## (3) Pack loading and how hard a second pack or module would be

**How packs load today** (`packs/index.ts`):
- `import.meta.glob('./*/rules/*.yaml')` and `./*/pack.yaml` are loaded eagerly as raw text at build time.
- The pack directory name is looked up in a hand-written `PREDICATES` registry (`{ basis: basisPredicates }`). A missing registry throws.
- `assemblePack` joins YAML to predicates by rule id and throws on a missing predicate, an orphan predicate, or a duplicate id within the pack.
- The result is cached as a module singleton.

**How evaluation picks packs:**
- `composables/useFindings.ts` `enabledPacks()` filters by `settings.rulePacks`; an empty list means all packs. This filter is global, not per camp.
- The engine skips a pack or rule when the camp start date is outside its validFrom/validTo. It skips rule ids in `disabledRuleIds`, which come from `ruleState` (per camp or global).
- Findings are de-duplicated by `ruleId:targets`, across packs.

**What a second pack (for example `js-lst` for Lagersport/Trekking) needs:**
1. A new folder `packs/<dir>/{pack.yaml, rules/*.yaml, predicates/index.ts}`.
2. One line in `PREDICATES`. That is the easy part.
3. Predicates can import the shared helpers from `basis/predicates/util.ts`, `jsDays.ts` and `deadlines.ts`. Those should move to a shared `rules/lib/` folder first.

**Blockers and friction:**
- **Fixed groups.** `RuleGroup` (`js | completeness | safety | best-practice`) is fixed in `types.ts` and duplicated in `engine.ts` `GROUPS`, `views/cockpit/FindingsView.vue` `groupOptions`, `RulesCatalogView` and i18n `rules.catalog.group.*`. A new group such as "lst" or "trekking" means touching all of them.
- **Group from id prefix.** `cockpit/index.ts` `ruleGroupOf(ruleId)` works out the group from the id prefix (`JS-`, `CMP-`, `SAFE-`, else best-practice). New prefixes such as `LST-` would wrongly fall into best-practice. The group should come from the rule meta instead.
- **Global rule ids.** Rule ids must be globally unique in practice. Finding ids, overrides, `ruleState`, explain and `useFindings` title lookup (`flatMap(p.rules).find(id)`) do not include `packId`, but `assemblePack` checks duplicates only within one pack.
- **No per-camp activation.** `settings.rulePacks` is app-wide and has no UI (no view references it). Choosing modules such as "Lagersport/Trekking", "Berg" or "Wasser" per camp needs:
  - new fields in `coachInputs`, or a new Dexie table version for the per-camp pack choice;
  - an "applies when" condition on the pack or rule (for example `appliesWhen: { offer: 'lst', module: 'berg' }`);
  - an engine filter for that condition;
  - backup coverage of the new data.
- **J+S gating is a convention.** It lives only in `jsApplies(ctx)` (`isJsCamp !== false`). There is no meta-level gating such as `requires: [js]`.
- **Tests assume one pack.** `rules/__tests__/packs.test.ts` asserts `loadBundledPacks()` has length 1 and that `packId === 'coco-basis'`. Both will need updating.
- **Overall effort:** an additive second pack that is always on is low effort (about half a day, plus the group and prefix fixes). Per-camp or per-module selection is medium effort, touching types, storage, the UI, the engine filter and docs.

## (4) Hard-coded values that should become configurable or data-driven

**Official thresholds** (should become pack-level parameters, versioned with validFrom/To):
- `jsDays.ts`: `MIN_UNIT_MINUTES` 30, `MIN_GAP_MINUTES` 30, `MIN_DAY_MINUTES` 240, `MIN_DAY_UNITS` 2.
- JS-CAMP-01: 4 consecutive days, literal in the code.
- JS-CAMP-02: 12 participants; the age range 5–20 appears only in texts and the MiData aggregate.
- `deadlines.ts`: the 30/30/35/21 lead times and the June–August rule. JS-DL-02 also uses a hint window of −30 days plus ≤ 14 days.
- JS-BWZ-27: `BWZ_MINUTES` 120.

**Heuristic and best-practice thresholds:**
- JS-STAFF-01: `MIN_LEADERS` 2, `MAX_PARTICIPANTS_PER_LEADER` 10.
- BP-WOLF-01: 6, literal.
- BP-WATER-01: 12, literal.
- BP-SLEEP-01: `SLEEP_HOURS` per Stufe.
- BP-REST-01: `REST_GAP_MINUTES` 60 and `REST_WINDOW` 07:00–22:00.
- BP-VAR-01: at least 4 units, at least 2 variety.
- SAFE-NIGHT-01: 22:00, 8.5 h, and the morning window 05:00–14:00.
- SAFE-ROPE-01: 200 characters.
- JS-DAY-05: storyboard head of 400 characters.
- CMP-PROG-01: −21 days.
- `participantsDiffer`: 0.2. This is also written into the CMP-NDS-03 and CMP-CON-10 texts as "20 %" and as `tolerancePercent: 20`.
- `MAX_EVIDENCE` 25 and `MAX_NAMES` 10.
- GPX pace values already live in `settings`, which is fine.

**Keyword lists** (should become YAML data per pack, so a Lagersport/Trekking module can extend them; for example winter, snow and trekking terms are currently missing):
- WATER, MOUNTAIN, ROPE, NIGHT, OUTDOOR, SCHLECHTWETTER_PHRASES (util.ts).
- WARMUP (js.ts).
- MTN_SATISFIED and ROPE_TOPICS (safety.ts).
- `RECOGNITION_KEYS` (consistency.ts).
- `SAFETY_CHECK_LABELS` (safety.ts).
- The docCheck `PATTERNS`, `EMERGENCY_NUMBERS` and `COORD_RE` (documents/index.ts).
- Category guessing `NAME_RULES` (campFacts/index.ts).
- The MiData qualification label mapping in Rust (`coco-core/src/midata.rs` `qual_keys_for_label`; it can be overridden via `settings.midata.qualMapping`).

**Fixed enums** (limit new modules unless extended):
- `MidataQualKey` covers only 6 keys. There is no key for e.g. Schneesport, Kanu, Velo, Klettern or Sicherheitsmodul specifics.
- `SafetyCheckKey` has 8 keys.
- `Stufe`.
- `CategoryClass` (LS/LA/LP/ES/NONE): there is no LS/T discipline or "Trekking" class.
- `RuleGroup`.
- `RuleInput` (mapping/coachInputs/documents/settings): there is no `midata` or `nds` input, so rules that read MiData or NDS declare no inputs.

**Hard-coded German text inside predicates:**
- `_message` strings and detail texts are built in TypeScript (for example "Angabe fehlt…", all the CMP-CON messages, and the JS-DL detail texts).
- They bypass the YAML message templates. The project rules require UI strings to live in i18n or YAML, so these should move as well.