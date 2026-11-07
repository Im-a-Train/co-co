# co-co – Coach Cockpit

**co-co** is a desktop app for J+S camp coaches (J+S-Coach / Lagercoach). It reads camps planned in
[eCamp v3](https://github.com/ecamp/ecamp3) with the coach's own eCamp login, checks them against
J+S and PBS rules, and helps the coach give structured feedback to the camp leaders. It has no backend
of its own: the app talks directly to the eCamp API and keeps its data on the local machine.

Status: **M0–M6 built** (login, cockpit + rules, feedback, documents, rounds + backup, optional AI,
findings triage). **M7 MiData** built (live spike M7-0 pending, see `docs/m7-spike-protocol.md`). Spec and live status: [`docs/spec/co-co-spec.html`](docs/spec/co-co-spec.html).

## Features

- **Login** with any eCamp instance (prod, dev, self-hosted), including PBS MiData / Cevi.DB / Jubla /
  Google OAuth via the real eCamp login page in a sandboxed window.
- **Meine Lager** – your camps with role, review status, finding counts and the next deadline.
- **Cockpit** – KPIs, Lagertag-Rechner (week grid with J+S time per day and Sozialzeit gaps), activity
  details, Lager-Angaben and category mapping (LS / LA / LP / ES).
- **Rule engine** – rule pack «co-co Basis 2026.1» (J+S core, completeness, safety heuristics, PBS best
  practice); each finding has a source, severity and confidence. Rules can be ignored per finding or
  disabled per camp / globally.
- **Befunde durchgehen** – step through findings with the activity shown inline, write feedback or
  ignore with one key, auto-advance to the next open finding.
- **Feedback** – Lob / Auflage / Anregung / Frage for the whole camp or one activity; templates per
  review moment; WhatsApp / e-mail / text via clipboard; activity items can be posted as eCamp comments.
- **Documents** – drag & drop, file picker and watched folders (e.g. synced Dropbox); PDF / DOCX / GPX /
  text extraction, safety-concept checklist, GPX Leistungskilometer, linking to activities, full-text search.
- **Rounds** – review status workflow, snapshots and «what changed since the last round», JSON backup.
- **Optional AI** (off by default) – own Anthropic API key in the OS keychain, data zones, redaction
  preview before every request; personal data from MiData/NDS never goes to AI.

## Quick start

Prerequisites: Node.js 22 (npm workspaces), Rust stable via rustup, and the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS. On Windows that means
Visual Studio Build Tools with the C++ workload + Windows SDK and the `stable-msvc` toolchain.

```bash
npm install
npm run dev          # Vite dev server on :1420 + the desktop window
```

Then: *Verbindung* → choose an instance → log in → *Meine Lager*.

## Development

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `vue-tsc` type check |
| `npm test` | Vitest unit tests |
| `npm run build:vite -w apps/desktop` | Frontend production build |
| `npm run test:ui -w apps/desktop` | UI harness: drives the installed Edge (playwright-core) with mocked Tauri IPC (`?mock=1`, dev only), checks every route and the main flows, writes screenshots to `apps/desktop/e2e-ui/shots/` |
| `npm run test:live -w apps/desktop` | Live test against an eCamp instance; needs `ECAMP_E2E_URL`, `ECAMP_E2E_USER`, `ECAMP_E2E_PASSWORD` in the environment (never commit credentials) |
| `cargo test --workspace` (in `apps/desktop/src-tauri`) | Rust tests; `cargo clippy --workspace --all-targets -- -D warnings` must be clean |
| `npm run build` | Installer for the current OS (`tauri build`) |

Contributor and agent guides: [CLAUDE.md](CLAUDE.md) (rules + commands), [CONTRIBUTING.md](CONTRIBUTING.md)
(recipes), [docs/](docs/README.md) (architecture, ADRs, contracts).

## Repository layout

```
apps/desktop/                 Vue 3 + Vuetify 3 + vue-i18n (German UI) + TypeScript
  src/domain/                 framework-free logic (campFacts, rules, feedback, documents, rounds, zones, …)
  src/composables/ views/ components/
  src/locales/de/             UI strings and feedback templates
  src-tauri/                  Tauri 2 (Rust): eCamp session, HTTP, files, keychain, AI call
    crates/coco-core/         pure Rust logic, testable without Tauri
  e2e-ui/                     browser UI harness
docs/                         architecture, ADRs, contracts, spec page
.github/workflows/ci.yml      CI (self-hosted runner)
```

## CI

CI runs on the **self-hosted runner** (`self-hosted, Linux, X64`) and builds **Windows only** by default:

| Job | Runner | When |
| --- | --- | --- |
| `check`: typecheck, vitest, vite build, cargo test | self-hosted Linux | every push and PR |
| `windows-cross`: NSIS installer cross-compiled with `cargo-xwin` | self-hosted Linux | every push and PR |
| `windows-native`: NSIS + MSI | self-hosted Windows | repo variable `WINDOWS_BUILD=native` |
| `linux`: deb + AppImage | self-hosted Linux | manual run, input `linux` |
| `macos`: dmg | GitHub-hosted `macos-latest` | manual run, input `macos` |

The Linux runner needs the packages in `APT_PACKAGES` (`ci.yml`); CI installs missing ones if the runner
user has passwordless sudo. Installers are unsigned, so Windows SmartScreen warns on first run.
Download the latest installer as the artifact `co-co-windows-x64` of a green run.

## Security and privacy

- The eCamp login page runs in its own window without any IPC access.
- Session cookies, passwords and the API key stay in Rust / the OS keychain; the UI only sees cookie names.
- The UI has no direct network access (strict CSP); API calls are limited to the logged-in instance.
- eCamp is only written to for comments.
- AI is opt-in; requests go through one gateway with redaction and a preview. MiData/NDS data (red zone)
  never reaches AI.

Details: [ADRs](docs/adr/) – 0001 Tauri, 0002 Vue/Vuetify, 0003 login via webview cookies, 0004 no
backend, 0005 data zones and AI, 0006 MiData red zone.

## Licence

**Not decided yet** – no licence file, so all rights are reserved for now. eCamp v3 is AGPL-3.0; co-co
only uses its public HTTP API and copies no eCamp code. Decide before the first public release
(and before copying any eCamp code).
