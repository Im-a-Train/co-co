# ADR 0014: Coach findings, AI guidance rules, structured feedback, overview progress and in-app viewer

- Status: accepted
- Date: 2026-11-09
- Builds on: [ADR 0005](0005-data-zones-and-ai.md) (data zones), [ADR 0007](0007-nds-red-zone.md) (NDS),
  [ADR 0009](0009-personal-data-in-ui.md) (personal data in the UI), [ADR 0010](0010-encryption-at-rest.md),
  [ADR 0011](0011-rule-set-v2.md) (rule set v2), [ADR 0012](0012-openai-compatible-and-mcp.md) (MCP),
  [ADR 0013](0013-resources-and-rule-edits.md) (Hilfsmittel, rule edits)

## Context

Coach feedback after the first real reviews:

1. Many keyword rules produced noisy findings. Keyword matching cannot judge a camp; an AI reading the
   program with the rules as guidance can.
2. The coach sees things no rule finds (a good game, a missing safety measure on page 3 of the SiKo) and
   had nowhere to record them next to the rule findings.
3. Feedback was a flat list. Camp leaders expect it ordered like the camp: general points, then day by day,
   activity by activity.
4. The Übersicht showed «Wichtigste Befunde», but not how far the review is, nor whether NDS/MiData and Rega
   registration match.
5. Documents could only be read as extracted text; PDFs, spreadsheets and tracks need to be looked at.

## Decision

### 1. Rule kind `hard` | `ai`

- `RuleMeta.kind` (`RuleKind`, `RULE_KINDS` in `domain/types.ts`) is required in the model. The YAML key is
  optional and defaults to `hard` (`parseRuleYaml`).
- `kind: ai` = **guidance**. The engine skips these rules (`evaluate`), so they create no finding. They keep
  their texts, sources and keyword wiring for the Regelbuch and explain. `validateRuleMeta` rejects unknown
  kinds and `ai` combined with severity `must`.
- 47 former keyword rules in `packs/jslst` and `packs/pbs` are now `ai`. Rules whose output drives J+S day
  counting, Sicherheitsbereich detection, a binding requirement or a coach input stay `hard`
  (allowlist `HARD_KEYWORD_RULES` in `rules/__tests__/aiKind.test.ts`; e.g. BP-WATER-01 reads the SLRG count).
- **AI camp review** (`AiFeature` `campReview`; `zones/features.ts`: `reviewCamp`, `runCampReview`,
  `parseCampReviewFindings`; button `components/ai/AiCampReviewButton.vue` in the Befunde toolbar): the
  request contains the guidance (`rules/aiGuidance.ts`: `aiGuidanceRules` lists `ai` rules first, then hard
  rules, filtered by validity, disabled rules and modules switched off for the camp; `guidanceText` renders one
  compact German line per rule), the engine's hard findings and a redacted camp program. All of it goes
  through `aiGateway` (yellow zone, preview first). The gateway limit per request is
  `maxPromptChars(feature)`: 60000 for `campReview`, 24000 otherwise; `reviewCamp` shrinks the program until
  the finished request fits. Results are AI findings (`origin: 'ai'`), never `must`, never red data.
- Hard rules remain deterministic findings with their source and confidence.

### 2. Manual findings (coach findings)

- Dexie **v4** table `manualFindings` (`'id, campIri'`), zone **yellow** (camp content written by the
  coach): encrypted like the other tables (ADR 0010) and part of the backup. Record `ManualFinding`
  (`domain/types.ts`): id `manual:<uuid>`, `scope` `camp | activity | document`, optional `activityIri`,
  `documentId`, `anchor` (`DocumentAnchor`: page, sheet/cell, km/lat/lon, label), `category`, `comment`
  (max 1000 characters, `MANUAL_COMMENT_MAX`), timestamps.
- Categories: positive, safety, program, js, pedagogy, organisation, documents, question, other
  (`MANUAL_FINDING_CATEGORIES`).
- `manualToFinding` maps a record to a regular `Finding` with `origin: 'manual'`, pseudo rule id `MANUAL`
  and no rule source. `useFindings` appends them after rule and AI findings. They are not run through
  category exclusions, are not counted in the camp summary and never offer «disable rule MANUAL».
  Triage status works by id.
- Refining into feedback: `itemFromFinding` supports `origin: 'manual'` (positive becomes `kudos`, question
  `question`, the rest `suggestion`; `feedbackKindOf`). Document findings keep `documentId` and
  `documentAnchor` on the `FeedbackItem`. The dialog «Befunde übernehmen» (`RefineFindingsDialog`) creates
  items in bulk and carries the red-derived flag over.
- UI: `ManualFindingDialog` / `ManualFindingList`, «Meine Befunde» in the activity drawer, «Befund erfassen»
  on documents (with the anchor from the viewer).

### 3. Structured feedback

- `domain/feedback/structure.ts` `groupFeedback(items, facts, documents)` returns `general` plus days and
  activities. Day labels use UTC getters (camp-local wall-clock times). Items without a date go to an
  undated group.
- Renderers write «Allgemein» first, then a heading per day and per activity; each line starts with its
  kind («Auflage», …; emoji on WhatsApp). Without `facts` no day headings are rendered; `{{items}}` in
  templates still works.
- Default general points (`domain/feedback/defaults.ts`, `GENERAL_POINTS`): siko, psa, notfall, rega, krise,
  wetter, hygiene, nachtruhe, stufengerecht, js-admin, each linked to existing rule and checklist ids. The
  panel «Allgemein» offers one «Übernehmen» per point; items carry `generalPointId`.

### 4. Overview: progress and sources (counts only)

- «Wichtigste Befunde» is removed from the Übersicht (the pure helper `topFindings` stays). Instead:
  `ReviewProgressCard`, driven by `domain/cockpit/progress.ts` (`reviewProgress`), with weighted steps:
  mapping 15, inputs 10, triage 25, documents 10, checklist 10, feedback 15, status 15. Empty triage and
  checklist count as done; each step chip links to its tab. The Dokumente tab moved to directly after
  Aktivitäten.
- `DataSourcesCard`: NDS/MiData differences from `usePersons().summary` (`summarizePersons`) and Rega
  registration counts. **Counts only** (ADR 0009): no names reach the card.
- Rega: NDS operations `regaParticipantsListForCamp` and `regaSupervisorsListForCamp`
  (`coco-core/src/nds.rs`), read-only, requesting `businessId`, person fields and `transmittedToRega`; the
  captured `privateAddress` field is deliberately not requested. The aggregate carries `NdsAggregate.rega`
  (`NdsRegaCounts`: total and transmitted for participants and supervisors); a failure of the Rega lists
  (including 403) yields `rega: null` and never fails the aggregate. The persons path attaches
  `regaTransmitted` per row in Rust, keyed by person id and personal number with separate prefixes so the
  two numeric spaces cannot collide. See `docs/contracts/nds-api/README.md`.

### 5. In-app document viewer

- `components/documents/DocumentViewer.vue` shows pdf (pdfjs-dist, one canvas per page rendered lazily and
  freed when far outside the view), docx (mammoth, then the own allowlist sanitiser
  `domain/documents/docxSanitize.ts`, rendered with Vue render functions; no `v-html`), xlsx
  (`read-excel-file`, lazy import, sheet tabs, at most 1000 rows and 60 columns) and gpx (SVG track and
  elevation profile, no map tiles, so fully offline). txt/md are shown as text. `xlsx` is a new
  `DocumentKind` (text extraction for search, file filter and Rust `DOCUMENT_EXTENSIONS`).
- The bytes are re-read from disk through the existing file commands (path scope applies) whenever the
  viewer opens and are **never stored** in Dexie. No new network access.
- A click in a viewer yields a `DocumentAnchor` (page, sheet+cell, km/lat/lon) used by «Befund erfassen».
  Deep link: `/dokumente?doc=<id>&page=<n>`; the page applies only to the linked document.
- Keyboard: the xlsx grid and the gpx profile are focusable and move with the arrow keys.

### 6. MCP tools and agent maintenance rule

- MCP clients get tools for the new data (manual findings, progress), following ADR 0012: write tools
  always ask for confirmation, results pass `assertMcpSendable`, MCP writes bump `mcpChanges` (new kind
  `manualFinding`, which `useManualFindings` observes with one shared watcher). Tool definitions live in
  `domain/mcp/catalog.ts`. **Status when this ADR was written: the `McpChangeKind` contract is in place and
  the tools are being added; the catalog is the source of truth.**
- `AGENTS.md` gets a maintenance rule: agents that change behaviour, contracts or modules update `docs/`
  (ADR, architecture, contracts, spec status) in the same change.

## Consequences

- Fewer, more trustworthy rule findings; the AI covers the fuzzy part and is clearly marked. Data leaves the
  device only after the coach confirms the preview.
- Coach judgement is first-class and survives rounds, backup and encryption. Being yellow-zone, it goes to AI
  or MCP only redacted.
- Feedback output changes shape (structured); items without `facts` still render.
- Viewers add dependencies (`pdfjs-dist`, `mammoth`, `read-excel-file`) and memory use for large PDFs,
  mitigated by lazy rendering and row/column caps.
- Rega state is a new personal-data-derived signal; it stays count-only in the Übersicht and per person only
  in the Personen tab (ADR 0009).
