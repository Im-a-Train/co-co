# ADR 0013: Hilfsmittel (resources) and coach-editable rules

- Status: accepted
- Date: 2026-11-09
- Builds on: [ADR 0005](0005-data-zones-and-ai.md) (data zones), [ADR 0010](0010-encryption-at-rest.md)
  (encrypted Dexie), [ADR 0011](0011-rule-set-v2.md) (rule set v2), [ADR 0012](0012-openai-compatible-and-mcp.md) (MCP)

## Context

The rules cite J+S / PBS documents and websites (`packs/sources.yaml`, 23 entries). Those documents are
updated during the year (new manual edition, new J+S tool module, PBS news). Until now a change needed a
new co-co release. Coaches asked to

1. see the referenced documents and links as their own list («Hilfsmittel», next to «Regeln»),
2. replace or update them (new URL, new edition, attach the current PDF),
3. search them from MCP clients and the built-in AI,
4. adjust rules when a Hilfsmittel changes – manually in the Regelbuch, or with an AI (built-in or MCP)
   proposing the change.

## Decision

### Hilfsmittel

- Dexie v3 table `resources` (key = source key, zone **green**: public reference material). Records are
  `ResourceRecord` (= `SourceRecord` + `origin`, `modified`, `summary`, `content`, `fileName`,
  `contentHash`, `updatedAt`, `updatedBy`, `history`).
- Defaults: every `sources.yaml` entry is seeded lazily (`origin: 'bundled'`). Unmodified bundled records
  follow `sources.yaml` on update; modified ones are kept and can be reset. Coaches can add `custom`
  entries. The PDFs are not bundled (copyright, size) – a coach attaches them; the text is extracted with
  the documents pipeline (Rust file scope applies) and stored as `content` for search.
- The **effective source registry** = bundled `sources.yaml` overlaid with the stored records
  (`setRegistryOverlay` in `packs/registry.ts`). Rule, checklist and finding source links point to
  `/hilfsmittel?key=<KEY>`; the original URL stays available as an external link.

### Rule edits

- Dexie v3 table `ruleEdits` (key = rule id, zone green): a minimal `RuleEditPatch` over the bundled
  rule meta (texts, severity, confidence, status, validity, sources, tags) plus reason, cited resource
  keys, origin and history. Predicates, scope, inputs, param and keyword wiring are **not** editable;
  thresholds are adjusted through the existing `settings.ruleParams` (only params with
  `overridable: admin | coach`).
- `loadEffectivePacks()` (bundled packs + valid edits) is used wherever rules apply or are shown
  (findings, camp rule config, Regelbuch, MCP). Invalid edits are skipped and reported, never applied.
- Policy on top of the engine: `must` requires `confidence: verified`; edits from **AI or MCP** may
  never set severity `must` or confidence `verified` – only a manual edit by the coach can. AI proposals
  are shown as a diff and applied only by the coach (`updatedBy: 'ai'`); MCP writes go through the
  existing write-tool confirmation (`updatedBy: 'mcp'`).

### MCP and AI

- New MCP read tools `list_resources`, `search_resources`, `get_resource` (paged content); write tools
  (default off) `update_resource`, `update_rule`. `get_rule_catalog` returns effective rules.
- Built-in AI: «Mit KI aktualisieren» in the rule edit dialog sends the rule meta and relevant
  Hilfsmittel excerpts (green) through `aiGateway` and expects a JSON `RuleEditPatch` + reason.

## Consequences

- Rule behaviour can now differ between coaches. Findings keep the rule id; the Regelbuch marks edited
  rules («geändert») and the backup carries both new tables, so a coach can share their state.
- A coach-attached document is treated as green. The UI tells the coach to attach only public J+S / PBS
  material; camp documents belong in «Dokumente» (yellow).
- A bundled rule update after a local edit: the edit keeps its `baseVersion`; the Regelbuch warns when
  the bundled version moved on so the coach can re-check or reset.
