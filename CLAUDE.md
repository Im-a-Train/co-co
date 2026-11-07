# co-co – agent guide

co-co ("Coach Cockpit") is a **Tauri 2 desktop app** for J+S camp coaches (Swiss Jugend+Sport /
scouts). It reads camps planned in [eCamp v3](https://github.com/ecamp/ecamp3) with the coach's own
eCamp login, checks them against versioned J+S / PBS rule packs, and helps the coach write feedback.
There is **no backend of our own**: Rust talks to the eCamp API; co-co's own data lives in IndexedDB.

Product spec and status page: `docs/spec/co-co-spec.html`, published as the Claude artifact
https://claude.ai/artifact/LapapyFcaJDqyD4yMME3Bz (see "Working agreements" below).
Decisions: `docs/adr/`. Module map and invariants: `docs/architecture.md`. Read those before larger work.

## Working agreements (maintainer, do not skip)

- **Keep the spec artifact current.** Every feature, milestone or behaviour change also updates
  `docs/spec/co-co-spec.html` (status badges, milestone cards, feature `DONE` set, open points) **and
  republishes it** to the artifact URL above with the Artifact tool (`action: read` the live version
  first, merge, then publish with `url`). A change is not done while the artifact is stale.
- **Implementation via cheap subagents.** The main session plans, writes the shared contract (types,
  command signatures, stubs) and verifies. The coding itself goes to cheaper subagents (Sonnet) that work
  in parallel on disjoint files. Reviews may use a stronger model. The main session re-runs the checks
  itself before reporting; it does not trust "all green" from an agent.
- **"Start it locally" means the Windows app**, not `npm run dev`/Vite: in `apps/desktop` run
  `npx tauri build --no-bundle` and launch `src-tauri/target/release/co-co.exe`.
- **UI harness port:** other worktrees/sessions often keep a Vite server on port 1420 that serves
  *their* code, so `test:ui` silently tests the wrong app. Run it on a free port, e.g.
  `UI_PORT=1431 npm run test:ui -w apps/desktop`, and never kill other sessions' servers.
- The maintainer writes in German; answer in German. Code, comments and docs stay English, UI German.

## Stack and layout

| Path | What |
| --- | --- |
| `apps/desktop/src/` | Vue 3 + Vuetify 3 + vue-i18n + TypeScript (Vite). UI is **German only**. |
| `apps/desktop/src/domain/` | Framework-free logic (campFacts, rules, feedback, documents, rounds, backup, zones, triage, storage). Keep it pure and unit-tested. |
| `apps/desktop/src/composables/` | Vue state per feature (`useFindings`, `useFeedback`, …). |
| `apps/desktop/src/views/`, `components/` | Screens and UI components, grouped by feature. |
| `apps/desktop/src/lib/tauri.ts` | Typed wrappers for **all** Tauri commands and events. |
| `apps/desktop/src/locales/de/<area>.json` | UI strings, one file per area; `feedback-templates/*.md`. |
| `apps/desktop/src/domain/rules/packs/basis/` | Rule pack: `rules/*.yaml` (metadata, German texts, source) + `predicates/*.ts`. |
| `apps/desktop/src-tauri/` | Rust: eCamp session + cookie jar, HTTP, file access scope, folder watcher, keychain, AI call. |
| `apps/desktop/src-tauri/crates/coco-core/` | Pure Rust logic (parsing, URL/path checks), testable without Tauri. |
| `apps/desktop/e2e-ui/` | Browser UI harness (Edge via playwright-core, mocked IPC). |
| `docs/contracts/` | `commands.md` (Tauri command contract), `ecamp-api.md` (verified eCamp API facts). |

## Commands

Run from the repo root unless noted. Node 22 + npm workspaces (no pnpm/yarn).

```bash
npm install
npm run dev                                  # tauri dev (Vite on :1420 + desktop window)
npm run typecheck                            # vue-tsc
npm test                                     # vitest (domain + helpers, Node env)
npm run build:vite -w apps/desktop           # vue-tsc + vite production build
UI_PORT=1431 npm run test:ui -w apps/desktop # Edge UI harness on a free port, screenshots to e2e-ui/shots/
npm run test:live -w apps/desktop            # opt-in live test, needs ECAMP_E2E_URL/USER/PASSWORD env vars
# Rust (in apps/desktop/src-tauri)
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
npx tauri build --debug --no-bundle          # in apps/desktop: debug exe without installer
```

Definition of done for a change: typecheck, `npm test`, `build:vite`, `cargo test --workspace` and
clippy are green; UI changes also pass `test:ui` and you have looked at the screenshots.
`/verify` (`.claude/commands/verify.md`) runs all of these.

## Rules that must not be broken

- **Network only through Rust.** The webview never calls eCamp, MiData or Anthropic directly (strict
  CSP). Add a Tauri command instead.
- **Secrets stay in Rust / the OS keychain.** Cookie values, refresh tokens, passwords and API keys never
  reach the UI, IndexedDB, logs, error messages or events. Only cookie *names* may be shown.
- **New Tauri command checklist:** Rust command → `build.rs` `COMMANDS` → `allow-<name>` in
  `capabilities/default.json` (window `main` only; the remote `ecamp-login` window gets no IPC) →
  wrapper in `src/lib/tauri.ts` → row in `docs/contracts/commands.md` → tests in `coco-core` if pure.
- **eCamp writes are limited to comments**: `POST /api/comments` (`textHtml` ≤ 1024 chars, no HTML
  except `<br>`) and `PATCH` with `resolved` only. Do not add other write endpoints without an ADR.
- **AI only through `src/domain/zones/aiGateway.ts`** – the only importer of `src/lib/tauriAi.ts`
  (enforced by `src/__tests__/contracts/aiGuard.test.ts`). Data zones: green (co-co data) may go to AI;
  yellow (camp content, documents) only redacted, after the preview dialog, and documents only with
  `aiAllowed`; **red (MiData/NDS personal data) never**. AI findings are never severity `must`.
- **Rules:** confidence `unverified`/`conflict` can never be `must` (engine enforces it). Every rule
  has a source URL, German texts in its YAML and tests in `domain/rules/__tests__`. J+S day rules
  stay inactive until the coach confirmed the category mapping.
- **i18n:** no hard-coded user-visible strings; add keys under your area's namespace in
  `src/locales/de/<area>.json`. Duplicate keys throw at start-up.
- **IndexedDB (Dexie, `domain/storage/db.ts`):** never edit an existing schema version; add
  `version(n+1)` with an upgrade. Backup export/import must keep covering all tables.
- **Credentials never in the repo.** Live tests read env vars only. Fixtures under
  `src/__tests__/fixtures/dev-camp/` are dev.ecamp3.ch test data – keep real personal data out.

## eCamp API gotchas (see `docs/contracts/ecamp-api.md`)

- HAL+JSON; send `Accept: application/hal+json`. Collections: `_embedded.items`, follow `_links.next`.
- Required filters: `/api/camps?campCollaborator=<userIri>`, `/api/schedule_entries?period=<iri>`,
  `/api/day_responsibles?day.period=<iri>` – unfiltered calls return HTTP 400.
- Times with `+00:00` are camp-local wall-clock times: read them with UTC getters, never convert.
- Instances: prod `https://app.ecamp3.ch`, dev `https://dev.ecamp3.ch`; `{instance}/environment.js`
  gives API root, cookie prefix and feature flags. Cloudflare rejects non-browser User-Agents
  (relevant for Node-based tests).

## MiData API gotchas (see `docs/contracts/midata-api.md`)

- Check every MiData query against https://db.scout.ch/api/openapi.json (see `docs/contracts/midata-api.md`); include/filter names are validated and unknown ones return HTTP 400.

## Environment notes

- Windows dev needs MSVC Build Tools (C++ workload) + Windows SDK and the `stable-msvc` Rust
  toolchain. In Git Bash, cargo may not be on PATH: `export PATH="$HOME/.cargo/bin:$PATH"`.
- `tauri dev` fails with "port 1420 in use" if a Vite server from a previous run is still alive –
  stop it first.
- The UI harness loads the app with `?mock=1` (`src/dev/mockTauri.ts`, dev builds only). Never let
  mock code reach production builds (`grep -r mockIPC apps/desktop/dist` must be empty).
- CI (`.github/workflows/ci.yml`) runs on the self-hosted Linux runner: checks + a cross-compiled
  Windows NSIS installer. macOS/Linux bundles are manual (workflow_dispatch).

## Git workflow

- Branch from `main`, open a PR, wait for green CI. Do not push to `main` directly.
- Small, focused commits; end commit messages with the `Co-Authored-By` trailer when an agent wrote
  the change.
- Update `docs/` (ADR, contracts, architecture, spec status) in the same PR when behaviour or
  contracts change.
