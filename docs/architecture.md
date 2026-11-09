# Architecture

All paths are relative to `apps/desktop/` unless noted. For decisions see `docs/adr/`, for the
Tauri command contract `docs/contracts/commands.md`, for eCamp API facts `docs/contracts/ecamp-api.md`.

## Big picture

```
┌──────────────── co-co (Tauri 2, local machine) ────────────────┐
│ Webview (Vue 3)                                                │
│  views/ components/  →  composables/  →  domain/ (pure TS)     │
│                              │              │                  │
│                     lib/tauri.ts       storage/db.ts (Dexie,   │
│                     (invoke/listen)     IndexedDB)             │
│──────────────────────────────┼─────────────────────────────────│
│ Rust (src-tauri)             ▼                                 │
│  session + cookie jar · api_get / comments · login window      │
│  file scope · folder watcher · dialogs · keychain · ai_complete│
└───────────────┬──────────────────────────────┬─────────────────┘
                ▼                              ▼
        eCamp API (any instance)      Anthropic API (optional)
```

The webview has no network access of its own (CSP). Everything external goes through Rust commands.

## Domain modules (`src/domain/`)

| Module | Responsibility | Main exports |
| --- | --- | --- |
| `types.ts` | Shared types: CampFacts, Finding, FeedbackItem, DocumentRecord, Round, Zone, AppSettings … | types only |
| `campFacts/` | Load the eCamp camp graph via an injected `apiGet` and normalise it; guess category classes; mapping + coach-input persistence | `loadCampFacts`, `loadCampList`, `guessCategories`, `classOf`, `htmlToText` |
| `rules/` | Rule engine, J+S day calculator, deadlines, ignores (`Override`), rule enable/disable state, camp summaries; bundled packs `packs/jslst` + `packs/pbs` (see «Rule set v2») | `evaluate`, `computeJsDays`, `computeDeadlines`, `loadBundledPacks` |
| `triage/` | Finding status (Offen / Feedback erstellt / Ignoriert), next-open navigation, triage URLs | `findingStatus`, `nextOpen`, `triageLocation` |
| `feedback/` | Feedback items: ordering, lint, renderers (WhatsApp / E-Mail / text), templates, comment splitting, finding → draft | `itemFromFinding`, `render*`, `splitForComment` |
| `documents/` | Text extraction (PDF, DOCX, GPX, TXT/MD), safety-concept checklist, GPX stats, document ↔ activity linking, search index | `extract`, `checkSafetyConcept`, `gpxStats`, `buildSearchIndex` |
| `rounds/` | Review status workflow, snapshots with per-entity hashes, diff | `snapshot`, `diff`, `allowedTransitions` |
| `backup/` | Export / import of all Dexie tables (versioned JSON) | `exportAll`, `importAll`, `validateExport` |
| `zones/` | Data zones, redaction, **aiGateway** (only AI path), AI features | `redact`, `aiGateway.send`, features |
| `cockpit/` | Pure helpers for KPIs and the week grid | `buildGrid`, `jsDayBars`, … |
| `midata/` | Event link resolution, `midata` table store, rule facts from the aggregate | `resolveEventLink`, `getMidataRecord`, `saveMidataAggregate` |
| `selfCheck/` | Leader self-check («Entwurfsrunde»): runs, progress vs. last run, plain-text report; store writes the run + a snapshot (`selfcheck:<id>`) | `planSelfCheckRun`, `compareWithRun`, `renderSelfCheckReport` |
| `storage/` | Encrypted Dexie database `coco2` (legacy `coco` only for migration) and app settings sections | `getDb`, `getAppSettings`, `updateAppSettings` |

## Composables (`src/composables/`)

| Composable | Provides | Used by |
| --- | --- | --- |
| `useSession`, `useInstances` | login state, token refresh, instance discovery | router, connection view, settings |
| `useCampList` | camps of the user + summaries | Meine Lager, deadlines |
| `useCampFacts(campIri)` | facts, loading, progress, reload | camp layout + every camp view |
| `useCampSettings(campIri)` | category mapping (+ confirmed), coach inputs, `classOf` | rules, cockpit, documents |
| `useFindings(campIri)` | findings, counts, `jsDays`, ignore, AI findings | cockpit views, triage, feedback |
| `useRuleState` | rule disable state (per camp / global), ignore-threshold prompt | Befunde, Regeln catalogue |
| `useFeedback(campIri)` | feedback CRUD, post as eCamp comment | feedback view, triage |
| `useDocuments(campIri)` | ingest, watched folders, drag-drop, search | documents view, activity drawer, rules |
| `useRounds(campIri)` | review status, rounds, diff since last round | runden, Übersicht, Meine Lager |
| `useMidata(campIri)` | connection status, per-camp link + aggregate, explicit refresh, event search, probe | MiData card, adopt dialog, settings, rules |
| `useAi` | AI enabled + key present (`ready`), settings | AI buttons, settings |

## Storage (IndexedDB via Dexie)

Tables: `settings` (sections incl. `ai`, `backup`, `gpx`, `rulePacks`, `ruleState`), `coachInputs`,
`mappings`, `overrides` (ignores), `campSummaries`, `feedback`, `reviews`, `rounds`, `snapshots`,
`documents`, `watchedFolders`, `aiLog`, `midata` (v2, red-derived aggregates), `nds` (v3), `selfChecks` (v4, leader self-check runs), `campRuleConfig` (v5, per-camp module states, activity tags, camp context). Schema changes: add a new Dexie version with an upgrade,
never edit an existing one. Backup covers every table in `TABLE_NAMES`.

### Encryption at rest (ADR 0010)

- **Middleware:** `getDb()` returns a Dexie `coco2` with `storage/encryptionMiddleware.ts`. Each row is stored as its plaintext
  allowlist fields (primary key, indexed ids) plus one AES-256-GCM envelope `_enc` (WebCrypto, non-extractable key). Reads decrypt, so callers see plain rows. `encryptionConfig.ts` lists the plaintext fields per table; the guard test `encryptionGuard.test.ts` forbids bypasses (raw IndexedDB, other storage).
- **Unlock flow:** after the eCamp login Rust verifies the session (`GET /api/users/<id>`), reads or creates
  the 32-byte key in the OS keychain and returns it once (`unlock_data_store`); the UI imports it as a
  non-extractable `CryptoKey`, opens `coco2` and checks a `_canary` row. Logout / `lock_data_store` drops the
  key and closes the database. Rust uses the same key for `allowed-paths.json`.
- **coco2 / legacy migration:** on first unlock the old plaintext `coco` is copied table by table into
  `coco2` (encrypting), counts are verified, then `coco` is deleted (`storage/migrate.ts`, progress in an
  internal `_`-prefixed settings row, resumable). `legacyDb.ts` is frozen.
- **Caveat, non-atomic transactions:** `CocoDb.transaction()` is overridden: WebCrypto is async and would let
  a real IndexedDB transaction auto-commit. `rw` scopes are serialised (read-modify-write is safe) but a
  failure does not roll back. Multi-write operations therefore order their writes (`startRound`: snapshot,
  round, close old; undo on failure) or keep an in-memory copy (`importWithRollback` for backup import).
  Never nest transactions.
- **Backups stay unencrypted** (plain JSON); the UI warns.

## Key flows

- **Camp load:** `useCampFacts` → `loadCampFacts(apiGet)` → `api_get` (Rust) → eCamp. Period-scoped
  requests for schedule entries and day responsibles.
- **Evaluation:** `useFindings` builds the `RuleContext` (facts, confirmed mapping or `null`, coach
  inputs, documents, ignores, disabled rules) → `evaluate(packs, ctx, { disabledRuleIds })`.
- **Category exclusions:** the coach can exclude eCamp activity categories from the rule check, for all
  rules or for a single rule (per camp, since category IRIs are per camp). Stored in `RuleState.excludedCategories`
  (settings key `ruleState`, no schema change, covered by backup). `filterExcludedFindings`
  (`domain/rules/categoryExclusions.ts`) post-filters the engine output in `useFindings`, so counts, triage,
  self-check and grid all see the filtered list; camp/day-scoped findings are never dropped.
- **Triage:** Befunde → `FindingTriage` (finding + `ActivityPreview` + inline editor) → save feedback /
  ignore / skip → next open finding. Position in `?befund=<id>`; Übersicht and GP link there via
  `triageLocation`.
- **Camp tabs / routes** (`CAMP_TABS` in `router/index.ts`): Übersicht, GP (`raster`, Grobprogramm incl. the
  category-mapping panel), DP (`aktivitaeten`, Detailprogramm), Befunde, Selbstcheck, Angaben, Feedback,
  Dokumente, Runden. `zuordnung` is no tab any more: route `camp-mapping` redirects to `raster?zuordnung=1`,
  which opens the mapping panel in the GP view. The GP grid hours are dynamic (07–23 h, widened by entries).
- **Feedback out:** activity items → `api_post_comment`; everything → renderer → clipboard.
- **Documents:** picker / drag-drop / watched folder → Rust scope check → `read_document` → extract →
  `documents` table → rules SAFE-DOC-01, SAFE-MTN-01/02.
- **AI:** button → `useAiFlow` → redaction preview dialog → `aiGateway.send` (zone checks) →
  `ai_complete` (Rust, key from keychain).

## Rust side (`src-tauri/`)

- `src/`: commands (`commands.rs`), session + refresh (`session.rs`, `auth.rs`), login window
  (`login_window.rs`), eCamp API (`api.rs`), instance discovery (`instance.rs`), files/scope/watcher,
  dialogs, keychain + AI.
- `crates/coco-core/`: pure logic (environment.js parsing, JWT payload, cookie selection, URL/path
  validation, scope rules) – unit-tested without Tauri.
- `build.rs` lists every command (`COMMANDS`) so the ACL applies; `capabilities/default.json` grants
  them to the `main` window only.

## MiData (M7, red zone, read-only)

Decision: [ADR 0006](adr/0006-midata-red-zone.md). Design: `docs/spec/co-co-spec.html` (section
«MiData connection»).

- **Rust:** `src-tauri/src/midata.rs` has its own reqwest client, cookie jar, login window
  (`midata-login`, no capability) and keychain token store (service `co-co-midata`), separate from
  eCamp. Seven `midata_*` commands ([contract](contracts/commands.md)). Event `midata://status`.
- **Pure logic:** `coco-core::midata` (base URL check, JSON:API paging, `reduce_aggregate`, leader
  qualification mapping, classic-export probe). Unit-tested with invented fixtures.
- **UI layer:** `domain/midata/` (event link resolution, store for the `midata` table, rule facts),
  `composables/useMidata.ts` (+ `midataSignal.ts`), `components/midata/` (`MidataCard`,
  `MidataEventPicker`, `MidataAdoptDialog`, `MidataBadge`, `QualificationMatrix`), Settings →
  MiData (connect, token, diagnose).
- **Storage:** Dexie v2 table `midata` (key `campIri`): aggregate + event link + `fetchedAt`, tagged
  `red-derived`. `CoachInputs.midataFields` records which fields the coach accepted from MiData.
  Backup export can omit it (`omitRedDerived`); `aiGateway` refuses it.
- **Rules:** `RuleContext.midata` feeds JS-CAMP-02, JS-LL-01, BP-WOLF-01, BP-WATER-01 and
  CMP-CAMP-01 (coach match); new CMP-MD-01 (hint) compares dates and location with eCamp. Findings
  say «Quelle: MiData, Stand <Datum>».

Data flow: coach clicks «Aktualisieren» → `useMidata.refresh` → `midata_fetch_aggregate` (Rust
fetches raw JSON:API, reduces, drops raw data) → `MidataAggregate` → `midata` table → `useFindings`
builds `RuleContext.midata` → rules. «Aus MiData übernehmen» shows MiData value next to the current
value; each accepted field is written to coach inputs and badged «MiData». Never refreshed in the
background.

## NDS (M8, red zone, read-only)

Decision: [ADR 0007](adr/0007-nds-red-zone.md). Unofficial, reverse-engineered web API
(`docs/contracts/nds-api/`).

- **Rust:** `src-tauri/src/nds.rs` has its own reqwest client, cookie jar, login window (`nds-login`,
  no capability) and keychain session store (service `co-co-nds`), separate from eCamp and MiData.
  Six `nds_*` commands ([contract](contracts/commands.md)). Event `nds://status`.
- **Pure logic:** `coco-core::nds` (GraphQL body/response handling, query-only guard, chunk paging,
  `reduce_aggregate`). Raw person data is dropped there; only counts cross to the UI.
- **UI layer:** `domain/nds/` (suggestions, state labels, field diffs, store for the `nds` table).
- **Storage:** Dexie v3 table `nds` (key `campIri`), tagged `red-derived`. `CoachInputs.ndsFields`
  records which fields the coach accepted from NDS. `AppSettings.nds = { enabled }`.

## M10: feedback loop + transparency

- **Comment sync** (`domain/feedback/commentSync.ts`): matches `CampFacts.comments` against posted
  feedback items (`postedCommentIris`) → `FeedbackItem.commentSync` (resolvedAt, replies with
  `inferred`, missing). Runs in `FeedbackView` whenever facts load; «Kommentare abgleichen» forces a
  reload. No extra API calls, no schema change. An empty comment list counts as «not loaded».
- **Explainability** (`domain/rules/explain.ts`): the engine attaches `Finding.explain` (pack/rule
  version, validity date, severity reasoning, inputs used/missing, facts from `RuleHit.inputs` + params).
  Hits with `redKeys` get the tags `midata` / `nds-quelle`. Findings that go to the AI must pass
  `zones/features.ts` `findingsForAi()` (strips `explain`, drops red findings). UI:
  `components/cockpit/FindingExplainPanel.vue` in `FindingCard`.
- **Leader self-check** (`domain/selfCheck/`, `useSelfCheck`, tab «Selbstcheck»): Dexie v4 table
  `selfChecks`, deliberately separate from review rounds. Backup with `omitRedDerived` strips red
  findings from the runs.
- **Personen (red zone, memory only)** (`domain/persons/`: `match`, `diff`, `age`, `view`; `usePersons`;
  tab «Personen», ADR 0009): MiData and NDS people are loaded on click via `persons_load_*`, held in
  module-level refs (and in Rust), reconciled by `diffPersons`, and wiped on logout, camp switch or
  «Aus dem Speicher entfernen» (`persons_clear`). All row types carry the `__red` brand; `aiGateway`
  refuses any payload containing it; no Dexie table, no backup, no clipboard
  (`__tests__/contracts/personsGuard.test.ts`). Birth dates are masked by default. P1 has no writes.
- **Deadline radar** (`domain/rules/milestones.ts` + `packs/*/milestones.yaml`, `domain/rules/ics.ts`): PBS
  milestones (confidence `unverified`) merged into Fristen, done flags in `CoachInputs.milestonesDone`,
  ICS export through `save_text_file` (dialog filter now follows the extension: json, ics, md, txt;
  `coco-core::savefile`).
- **Documents v2**: plan only, see `docs/plans/documents-v2.md`.

## Rule set v2 (modular packs)

Decision: [ADR 0011](adr/0011-rule-set-v2.md). Author API: `docs/plans/rules-v2/infra-api.md`; pack format:
`src/domain/rules/packs/README.md`; catalog: `docs/plans/rules-v2/catalog-final.md`.

Layout under `src/domain/rules/`:

```
lib/         util, keywords (matcher), params, sources, jsDays (legacy computeJsDays + buildJsDayModel),
             timeWindows, birthYear, deadlines, moduleState, context (completeContext), campRuleConfig,
             campConfigEdit, checklist, docCheck, holidays, mergePredicates
packs/
  sources.yaml            shared source registry (key, title, url, authority/date); old keys via formerKeys
  registry.ts index.ts    getSourceRegistry(); loader, validateBundle, selectPacks (alias coco-basis)
  jslst/                  pack coco-js-lst: pack.yaml (modules), params.yaml, keywords/*.yaml,
                          checklist.yaml, milestones.yaml, rules/<ID>.yaml, predicates/<module>.ts
  pbs/                    pack coco-pbs: same shape, module pbs
```

- **Rules per module** (108 active + JS-STAFF-01 retired): js 29, lst 28, lst-lager 11, lst-wasser 10,
  lst-trekking 9, lst-winter 8, pbs 6, lst-berg 4, lst-ebb 4.
- **Module state resolution** (`lib/moduleState.ts`): `appliesWhen` (jsCamp, sport, organizer, parent
  module) -> coach state (`campConfig.modules[id]`, default `auto`) -> module default -> tag triggers (`on`)
  -> suggest triggers (`suggested`, reasons as i18n keys). `suggested` caps hits at `hint` and adds
  `finding.moduleNote`. An unknown organizer counts as PBS; a coach `on` overrides an organizer mismatch.
- **RuleContext additions** (`completeContext`, lazy where costly): `ctx.params` (`get`, `isOverridden`,
  `def`; versioned by camp start date), `ctx.keywords` (`match`, `matchActivity`), `ctx.js` (J+S day model:
  days, J+S minutes/units, BWZ, short gaps, `jsDayCount`, `endDaysMode`, `trainingFreeDays`,
  `isJsActivity`), `ctx.campConfig` (resolved `campRuleConfig` incl. `tagsOf(activityIri)` and
  `moduleStates`). Coach activity tags override keyword detection.
- **Storage:** Dexie v5 table `campRuleConfig` (key `campIri`), accessed through `campRuleConfigStore.ts`;
  covered by backup export/import like every table.
- **Findings** carry `module`, `sources` (key, page, quote, binding) and, for suggested modules,
  `moduleNote`. Superseded rule ids sit in `formerIds`, so overrides/ruleState/disabled ids carry over.
- **Invariants (loader + tests):** `must` implies confidence `verified`; rule ids and `formerIds` are
  globally unique and a formerId never equals a live id; every referenced source, param and keyword set
  exists; a rule YAML without predicate (or vice versa) throws; predicates may only lower
  severity/confidence; no German text in TypeScript (texts live in YAML `message`/`messageVariants`, UI
  strings in `locales/de`).
- **Known small gaps:** document kinds `sicherheitskonzept`, `lagerregeln`, `lagerinfo` are matched by
  filename keyword sets (`DocumentKind` has no such kinds); the child age < 10 is the J+S definition
  constant in the trekking predicates; the 90 % threshold of LST-LAGER-02 is a TS constant; the PBS method
  keyword lists are provisional (Pfadiprofil missing).
