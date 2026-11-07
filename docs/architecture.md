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
| `rules/` | Rule engine, J+S day calculator, deadlines, ignores (`Override`), rule enable/disable state, camp summaries; bundled pack `packs/basis` | `evaluate`, `computeJsDays`, `computeDeadlines`, `loadBundledPacks` |
| `triage/` | Finding status (Offen / Feedback erstellt / Ignoriert), next-open navigation, triage URLs | `findingStatus`, `nextOpen`, `triageLocation` |
| `feedback/` | Feedback items: ordering, lint, renderers (WhatsApp / E-Mail / text), templates, comment splitting, finding → draft | `itemFromFinding`, `render*`, `splitForComment` |
| `documents/` | Text extraction (PDF, DOCX, GPX, TXT/MD), safety-concept checklist, GPX stats, document ↔ activity linking, search index | `extract`, `checkSafetyConcept`, `gpxStats`, `buildSearchIndex` |
| `rounds/` | Review status workflow, snapshots with per-entity hashes, diff | `snapshot`, `diff`, `allowedTransitions` |
| `backup/` | Export / import of all Dexie tables (versioned JSON) | `exportAll`, `importAll`, `validateExport` |
| `zones/` | Data zones, redaction, **aiGateway** (only AI path), AI features | `redact`, `aiGateway.send`, features |
| `cockpit/` | Pure helpers for KPIs and the week grid | `buildGrid`, `jsDayBars`, … |
| `midata/` | Event link resolution, `midata` table store, rule facts from the aggregate | `resolveEventLink`, `getMidataRecord`, `saveMidataAggregate` |
| `storage/` | Dexie database `coco` and app settings sections | `getDb`, `getAppSettings`, `updateAppSettings` |

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
`documents`, `watchedFolders`, `aiLog`, `midata` (v2, red-derived aggregates). Schema changes: add a new Dexie version with an upgrade,
never edit an existing one. Backup covers every table in `TABLE_NAMES`.

## Key flows

- **Camp load:** `useCampFacts` → `loadCampFacts(apiGet)` → `api_get` (Rust) → eCamp. Period-scoped
  requests for schedule entries and day responsibles.
- **Evaluation:** `useFindings` builds the `RuleContext` (facts, confirmed mapping or `null`, coach
  inputs, documents, ignores, disabled rules) → `evaluate(packs, ctx, { disabledRuleIds })`.
- **Triage:** Befunde → `FindingTriage` (finding + `ActivityPreview` + inline editor) → save feedback /
  ignore / skip → next open finding. Position in `?befund=<id>`; Übersicht and Raster link there via
  `triageLocation`.
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
