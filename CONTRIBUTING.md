# Contributing

Read [CLAUDE.md](CLAUDE.md) first – it holds the commands, the non-negotiable rules and the git
workflow. This file has recipes for the most common changes.

## Workflow

1. Branch from `main` (`feat/…`, `fix/…`, `chore/…`, `docs/…`).
2. Make the change with tests. Keep logic in `src/domain/` pure so Vitest can cover it.
3. Run the checks (or `/verify` in Claude Code):
   `npm run typecheck`, `npm test`, `npm run build:vite -w apps/desktop`,
   `cargo test --workspace` + `cargo clippy --workspace --all-targets -- -D warnings` in
   `apps/desktop/src-tauri`, and for UI changes `npm run test:ui -w apps/desktop`.
4. Open a PR using the template; CI must be green before merging.
5. Merging to `main` publishes the next alpha pre-release automatically (ADR 0008). Do not edit version
   numbers by hand; for a new minor/patch/major base version run `npm run version:bump -- <part>` in a PR.

## Add or change a rule

1. Create `src/domain/rules/packs/basis/rules/<RULE-ID>.yaml` with id, title/message (German), group,
   severity, confidence, validity dates, scope, source `{ title, url }`.
   `confidence: unverified | conflict` ⇒ severity at most `should`.
2. Implement the predicate in `packs/basis/predicates/*.ts` and register it like the existing rules.
3. Add tests in `src/domain/rules/__tests__/` (positive, negative, edge cases).
4. If the rule needs coach input, add the field to `CoachInputs` (`domain/types.ts`), the Angaben form
   (`views/camps/CoachInputsView.vue`, `components/camps/inputsForm.ts`) and the input→rule hint map.
5. Keyword heuristics that cannot judge a camp reliably get `kind: ai` in the YAML: the engine then skips the
   rule and the AI camp review receives it as guidance (ADR 0014). Rules that feed J+S days, Sicherheitsbereich
   detection, a binding requirement or a coach input stay `hard` (allowlist `HARD_KEYWORD_RULES` in
   `__tests__/aiKind.test.ts`). `ai` rules can never be `must`.
6. Note the change in the spec status page if it is user-visible.

## Add a Tauri command

1. Implement it in `apps/desktop/src-tauri/src/` (pure parts in `crates/coco-core` with tests).
2. Add the name to `build.rs` `COMMANDS` and `allow-<name>` to `capabilities/default.json`.
3. Add a typed wrapper to `src/lib/tauri.ts` (or `tauriAi.ts` for AI – gateway only).
4. Document it in `docs/contracts/commands.md`.
5. Never return or log secrets; errors are German user-readable strings.

## UI text (i18n)

German only, via `src/locales/de/<area>.json` under the area's namespace. Feedback templates are
Markdown files in `src/locales/de/feedback-templates/`. Run `npm run test:ui -w apps/desktop` – it
fails on raw i18n keys in the UI.

## Database

Dexie schema in `src/domain/storage/db.ts`. Add `this.version(n+1).stores({...}).upgrade(...)`;
never edit an existing version. Make sure backup export/import (`domain/backup`) still covers every table.

## Live tests

`npm run test:live -w apps/desktop` with `ECAMP_E2E_URL`, `ECAMP_E2E_USER`, `ECAMP_E2E_PASSWORD`
set in your shell. Use a test instance and a test account; never commit credentials.
