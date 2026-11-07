# Ownership map (M1–M5 parallel build)

Eight builders work in parallel. Each builder writes **only** inside the paths it owns.
All paths are relative to `apps/desktop/` unless they start with `docs/`.

## Ground rules

1. **Frozen shared files** (see the last section) are not edited by builders. If a builder needs a
   change there (a new type, table, command, route or dependency), it does the work in its own module
   and reports the need to the orchestrator. It does not edit the frozen file.
2. **New types:** define and export them from your own module, e.g. `domain/feedback/types.ts`.
   `domain/types.ts` is frozen.
3. **No new npm dependencies.** Installed for M1–M5: `vue-router 4.6.4`, `dexie 4.4.7`, `minisearch 7.2.0`,
   `pdfjs-dist 6.5.438`, `mammoth 1.13.0`, `yaml 2.9.1`. The Rust builder may add crates, but only in
   `src-tauri`.
4. **i18n:** all UI strings are German and live in your own locale file(s)
   `src/locales/de/<area>.json`, namespaced under your area key (e.g. `{ "feedback": { ... } }`).
   - Add keys only under your own namespace. A duplicate leaf key throws at start-up.
   - Shared keys you may *use* (not edit): `common.*`, `nav.*`, `campTabs.*`, `severity.*`,
     `confidence.*`, `categoryClass.*`, `reviewStatus.*`.
5. **Stubs → implementations:** every exported signature in the stubs is a contract other builders code
   against. Keep names, parameters and return types. You may add exports. Remove the `notImplemented(...)`
   calls when implementing.
6. **Consumers of not-yet-implemented stubs** must handle them gracefully:
   - composable stubs return empty/null values;
   - domain stubs throw `NotImplementedError` (from `domain/stub.ts`). Catch it in the UI.
7. **Tests:** `<your folder>/__tests__/*.test.ts` (vitest, Node environment, no IndexedDB, no DOM).
   - Keep logic pure so it can be tested.
   - Use `src/__tests__/fixtures/devCampApi.ts` (`createDevCampApi()`, a fake `ApiGet` over the
     dev-camp dump) for realistic data.
8. **Database:** schema in `domain/storage/db.ts` is frozen. Use `getDb()` and only write the tables you
   own. App settings: `getAppSettings()` / `updateAppSettings({ <yourSection>: ... })` from
   `domain/storage/settings.ts`. Write only your section.
9. eCamp times: `+00:00` means camp-local wall-clock time. Read them with UTC getters
   (see `docs/contracts/ecamp-api.md`).
10. Do not `git commit` / `git push`. The orchestrator integrates.

## Builders

### `data`: CampFacts, Meine Lager, mapping, coach inputs, connection

- `src/domain/campFacts/**`: `index.ts` (`loadCampFacts`, `loadCampList`, `guessCategories`,
  `mappingFromGuesses`, `classOf`, `htmlToText`), `store.ts` (mapping and coach-input persistence),
  `__tests__/**`
- `src/composables/useCampFacts.ts`, `src/composables/useCampList.ts`, `src/composables/useCampSettings.ts`
- `src/views/connection/**` (ConnectionView)
- `src/views/camps/**`: CampsView (`/lager`), CoachInputsView (`angaben`), MappingView (`zuordnung`)
- `src/components/camps/**` (new)
- `src/components/settings/InstancesSection.vue`, `src/components/settings/DiagnosticsSection.vue`
- M0 legacy files:
  - `src/components/{InstanceCard,LoginCard,SessionCard,SpikeProtocolCard,CampsCard}.vue`
  - `src/composables/{useCamps,useInstances,useSpikeProtocol}.ts`
  - `src/lib/{camps,hal,instances,jwt,refresh,report,clipboard}.ts` and `src/lib/__tests__/**`

  `src/composables/useSession.ts` may be changed only without breaking its public API, because
  the router and App.vue use `init`, `isLoggedIn` and `session`.
- Locales: `src/locales/de/camps.json`, `src/locales/de/connection.json`
- Tables: `coachInputs`, `mappings`
- Reads: `listCampSummaries()` (rules) and `listReviews()` (rounds) for the counts and status on Meine Lager.

### `rules`: rule engine, basic pack, J+S day calculator, deadlines, rules catalogue

- `src/domain/rules/**`:
  - `engine.ts`, `jsDays.ts`, `deadlines.ts`, `store.ts` (overrides, camp summaries);
  - `packs/index.ts`, `packs/basis/**` (pack.yaml, rules/*.yaml, predicates/*.ts, README.md);
  - `__tests__/**`.
- `src/composables/useFindings.ts`
- `src/views/rules/**`: RulesCatalogView (`/regeln`), DeadlinesView (`/fristen`)
- `src/components/rules/**` (new)
- Locale: `src/locales/de/rules.json`
- Tables: `overrides`, `campSummaries`. Settings section: `rulePacks`
- Reads: coach inputs and mapping (data), documents (`documents` table, with docCheck and gpx),
  `useCampList` / `listCoachInputs` for deadlines across camps.

### `cockpit`: overview, Lagertag-Rechner grid, findings list

- `src/views/cockpit/**`: OverviewView (`uebersicht`), GridView (`raster`), FindingsView (`befunde`)
- `src/components/cockpit/**`, `src/domain/cockpit/**` (new, pure helpers + `__tests__`)
- Locales: `src/locales/de/cockpit.json`, `src/locales/de/findings.json`
- Uses:
  - `useCampFacts`, `useCampSettings`, `useFindings` (findings, counts, `jsDays`, `override`);
  - `useRounds().diffSinceLastRound`;
  - `<AiSafetyReviewButton>` (ai), passing the emitted findings to `useFindings().addAiFindings`.
- "Feedback erstellen" works like this:
  1. `itemFromFinding()` + `saveFeedback()` (feedback domain);
  2. then `router.push({ name: 'camp-feedback', params, query: { item: id } })`.

### `feedback`: feedback composer (M2)

- `src/domain/feedback/**`: `index.ts` (order, render WhatsApp/E-Mail/plain, lint, comment split,
  `itemFromFinding`, `getTemplate`), `store.ts`, `__tests__/**`
- `src/views/feedback/**` (FeedbackView, `feedback` tab; reads `?item=<id>` to focus an item)
- `src/components/feedback/**`, `src/composables/useFeedback.ts` (new)
- Locales: `src/locales/de/feedback.json`, `src/locales/de/feedback-templates/*.md` (loaded via
  `feedbackTemplates` in `src/locales/messages.ts`, keys `de/<file>`)
- Table: `feedback`
- Uses: `commands.apiPostComment` (and `apiPatchComment`), `<AiRephraseButton>` (ai)

### `documents`: documents, safety concept, GPX, search (M3)

- `src/domain/documents/**`:
  - `index.ts` (detectKind, GPX stats, safety-concept check, link suggestions, search index);
  - `extract.ts` (pdfjs and mammoth loaders, keep them lazy; GPX parsing with DOMParser);
  - `store.ts`, `__tests__/**`.
- `src/views/documents/**` (DocumentsView, `dokumente` tab), `src/components/documents/**`,
  `src/composables/useDocuments.ts` (new)
- Locale: `src/locales/de/documents.json`
- Tables: `documents`, `watchedFolders`. Settings section: `gpx`
- Uses:
  - `commands.pickFiles`, `pickFolder`, `readDocument`, `listFolder`, `watchFolder`, `unwatchFolder`;
  - `onDocsChanged`, `onDocsDropped`, `base64ToBytes`;
  - `<AiSummaryButton>` (ai).
- The rules builder evaluates SAFE-DOC-01 and SAFE-MTN-01/02 from the stored
  `DocumentRecord.docCheck`, `.gpx` and `.activityIris`.

### `rounds`: review status, rounds, snapshots, diff, backup (M4)

- `src/domain/rounds/**` (`index.ts` snapshot, hash and diff; `store.ts`; `__tests__/**`)
- `src/domain/backup/**` (exportAll, validateExport, importAll, exportFileName; `__tests__/**`)
- `src/composables/useRounds.ts`
- `src/views/rounds/**` (RoundsView, `runden` tab), `src/components/rounds/**`, `src/components/backup/**`
- `src/components/settings/BackupSection.vue`
- Locales: `src/locales/de/rounds.json`, `src/locales/de/backup.json`
- Tables: `reviews`, `rounds`, `snapshots`. Settings section: `backup`. Export and import cover **all**
  tables in `TABLE_NAMES`.
- Uses: `commands.saveTextFile`, `commands.openTextFile`

### `ai`: data zones, redaction, AI gateway and features (M5)

- `src/domain/zones/**`:
  - `index.ts`, `redact.ts`;
  - `aiGateway.ts`, the ONLY importer of `src/lib/tauriAi.ts`;
  - `features.ts`, `__tests__/**`.
- `src/components/ai/**`: AiRephraseButton, AiSummaryButton and AiSafetyReviewButton (props and emits
  are frozen), preview dialog
- `src/components/settings/AiSection.vue`, `src/composables/useAi.ts` (new)
- Locale: `src/locales/de/ai.json`
- Table: `aiLog`. Settings section: `ai`
- Uses: `commands.aiSetKey`, `aiHasKey`, `aiClearKey`
- Guard: `src/__tests__/contracts/aiGuard.test.ts`

### `rust`: Tauri commands (contract: `docs/contracts/commands.md`)

- `src-tauri/**`: `src/*.rs`, `crates/**`, `Cargo.toml`, `Cargo.lock`, `build.rs` (`COMMANDS`),
  `capabilities/default.json`, `tauri.conf.json` (CSP and drag-drop), `permissions/**`
- Must not change the TS wrappers. If the contract is wrong, it reports to the orchestrator.

## Frozen (architect; builders read only)

- `package.json` (root + `apps/desktop`), `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `index.html`
- `src/main.ts`, `src/App.vue`, `src/router/**`, `src/layouts/**`, `src/views/settings/SettingsView.vue`
- `src/plugins/**`, `src/locales/messages.ts`, `src/locales/de/common.json`, `src/locales/de/settings.json`
- `src/domain/types.ts`, `src/domain/iri.ts`, `src/domain/stub.ts`, `src/domain/storage/**`
- `src/lib/tauri.ts`, `src/lib/tauriAi.ts`, `src/composables/useCampRoute.ts`, `src/env.d.ts`
- `src/__tests__/contracts/**`, `src/__tests__/fixtures/**`
- `docs/contracts/**`, `docs/adr/**`

## Cross-module API summary (who calls whom)

| Provider | API | Consumers |
| --- | --- | --- |
| data | `useCampFacts(campIri)` → facts, loading, error, progress, load | layout, every camp view |
| data | `useCampSettings(campIri)` → mapping, coachInputs, classOf, version | rules, cockpit, documents |
| data | `useCampList()`, `listCoachInputs()`, `htmlToText()` | rules (deadlines), feedback |
| rules | `useFindings(campIri)` → findings, counts, jsDays, override | cockpit, feedback, data (indirect) |
| rules | `computeJsDays`, `computeDeadlines`, `loadBundledPacks`, `listCampSummaries` | cockpit, data |
| feedback | `itemFromFinding`, `saveFeedback` | cockpit |
| documents | `DocumentRecord` rows in the `documents` table | rules, ai |
| rounds | `useRounds(campIri)` → review, rounds, diffSinceLastRound; `listReviews()` | cockpit, data |
| ai | `<AiRephraseButton>`, `<AiSummaryButton>`, `<AiSafetyReviewButton>` | feedback, documents, cockpit |
| rust | commands in `lib/tauri.ts` | feedback, documents, rounds, ai |
