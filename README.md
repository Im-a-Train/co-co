# co-co – Coach Cockpit

**co-co** is a standalone desktop app for J+S camp coaches (J+S-Coach / Lagercoach). It reads camps from
[eCamp v3](https://github.com/ecamp/ecamp3) with the coach's existing eCamp account and helps them
review camp programmes. It has no backend of its own: the app talks directly to the eCamp API and
keeps all of its own data on the local machine.

> Status: **M0 – login spike.** This is a prototype. It does not yet do anything useful for coaching.

## M0 scope: login spike

M0 answers one question: can a Tauri 2 desktop app log in to eCamp with the user's normal eCamp
account, **including PBS MiData OAuth**, and then make authenticated API calls, all without a custom
backend?

What M0 contains:

- **Instance picker:** eCamp production `https://app.ecamp3.ch`, eCamp dev `https://dev.ecamp3.ch`,
  or a custom URL. "Prüfen" auto-discovers the instance from `{instance}/environment.js` and the API
  root links.
- **Webview login (primary):** "Mit eCamp anmelden (inkl. MiData)" opens the real eCamp login page in
  a separate, sandboxed window (`ecamp-login`, no IPC access). After the login, the Rust side reads the
  eCamp session cookies (`*jwt_hp`, `*jwt_s`, `*refresh_token`) from the webview cookie store, copies
  them into its own HTTP cookie jar and closes the window. See [ADR 0003](docs/adr/0003-login-via-webview-cookies.md).
- **Password login (fallback):** `POST /api/authentication_token`, done in Rust.
- **Session card:** user, token expiry, auto-refresh (at half the remaining lifetime, clamped to
  2–30 min), manual refresh, logout.
- **Camps card:** lists your camps (`/api/camps`). Clicking a camp loads its activities, which proves
  that deeper reads work.
- **Spike protocol card:** live auth log, a results checklist and "Ergebnis kopieren", which copies a
  Markdown report for the spike issue/ADR.

Out of scope for M0: any coaching features, offline storage of camp data, AI features, signing and
auto-update.

## Repository layout

```
package.json               npm workspaces root (scripts proxy to apps/desktop)
apps/desktop/              Vue 3 + Vuetify 3 + vue-i18n (German UI) + TypeScript, built with Vite
apps/desktop/src-tauri/    Tauri 2 app (Rust): login window, cookie jar, eCamp API calls
  crates/coco-core/        pure Rust logic (parsing, JWT payload decode, URL checks), testable everywhere
docs/adr/                  architecture decision records
docs/m0-spike-protocol.md  manual test plan for the login spike
.github/workflows/ci.yml   CI: typecheck, vitest, cargo test, Windows installer (macOS/Linux opt-in)
```

## CI

CI runs on the **self-hosted runner** (`self-hosted, Linux, X64`, currently `isengard`). It builds **Windows only** by default:

| Job | Runner | When |
|---|---|---|
| `check`: typecheck, vitest, vite build, cargo test | self-hosted Linux | every push and PR |
| `windows-cross`: NSIS installer cross-compiled with `cargo-xwin` | self-hosted Linux | every push and PR (default) |
| `windows-native`: NSIS + MSI, native build | self-hosted Windows | when the repo variable `WINDOWS_BUILD` = `native` |
| `linux`: deb + AppImage | self-hosted Linux | manual run, input `linux` |
| `macos`: dmg | GitHub-hosted `macos-latest` | manual run, input `macos` |

Runner host requirements:

- **Linux runner:** the apt packages listed in `APT_PACKAGES` in `ci.yml`. These are the Tauri deps plus `nsis lld llvm clang` for the cross build. CI installs any missing ones itself if the runner user has passwordless sudo; otherwise it fails with an install command for you to run on the host.
- **Windows runner (optional):** register it with the labels `self-hosted, Windows, X64`. Install VS Build Tools (C++ workload), the Windows SDK, Node 22 and rustup. Then set `WINDOWS_BUILD=native`.
- **Cross build:** cargo-xwin downloads the MSVC CRT and the Windows SDK, under Microsoft's licence terms, and caches them on the runner. The installer is unsigned, so Windows SmartScreen will warn when it runs.

## Prerequisites

All platforms:

- **Node.js 22** (≥ 22.12) with npm 10. The repo uses npm workspaces, not pnpm or yarn.
- **Rust stable** via [rustup](https://rustup.rs).
- The Tauri 2 system prerequisites for your OS: <https://v2.tauri.app/start/prerequisites/>.

### Windows

- **Microsoft C++ Build Tools** ("Desktop development with C++") **and the Windows 10/11 SDK**, with
  the default Rust toolchain `stable-x86_64-pc-windows-msvc`. You need these for any real build
  (`npm run tauri dev`, `npm run tauri build`) and for release builds. CI does not need them: it cross-compiles on Linux, or builds natively on an optional self-hosted Windows runner.
- **WebView2 runtime** (preinstalled on Windows 11).

> **Note on the M0 development machine.** M0 was written on a Windows 11 machine without MSVC Build
> Tools or the Windows SDK, using the `stable-x86_64-pc-windows-gnu` toolchain. On that setup, only the
> pure-Rust core crate (`coco-core`) and the frontend (typecheck, vitest, vite build) can be built and
> tested. The Tauri crate itself does **not** build with the self-contained GNU toolchain:
> - Current `windows-sys` / `windows-link` crates use `raw-dylib`, which needs a real `dlltool` + `as`.
> - `tauri-build` needs a resource compiler.
> - `reqwest`'s TLS stack needs a C compiler.
>
> To run the app locally on Windows, either install MSVC Build Tools + the Windows SDK (recommended), or
> install a complete MinGW-w64 toolchain (e.g. MSYS2/WinLibs with `dlltool`, `as`, `windres`, `gcc`).
> Until then, the full app is compiled and bundled only in CI. Download the `co-co-windows-x64` artifact
> from the latest green run.

### macOS

- Xcode Command Line Tools: `xcode-select --install`.

### Linux (Debian/Ubuntu 22.04+/24.04)

```sh
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## Getting started

```sh
npm install
npm run tauri dev -w apps/desktop      # or from the root: npm run dev
```

Other scripts (run from the repo root):

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `vue-tsc` type check of the frontend |
| `npm test` | Vitest unit tests (pure helpers) |
| `npm run dev` | Same as `tauri dev` (Vite dev server on port 1420 + desktop window) |
| `npm run build` | Full `tauri build`: installers/bundles for the current OS |
| `npm run vite:build -w apps/desktop` | Frontend production build only (`vue-tsc` + Vite) |
| `cargo test --workspace` in `apps/desktop/src-tauri` | Rust unit tests |

On the GNU-toolchain Windows setup described above, only the Rust core tests run locally:

```sh
cd apps/desktop/src-tauri
cargo test -p coco-core
```

Live smoke tests against the real eCamp instance (no credentials; network required; `#[ignore]`d by
default; set `COCO_LIVE_INSTANCE=https://dev.ecamp3.ch` to target another instance):

```sh
cd apps/desktop/src-tauri
# curl-based, runs everywhere (also on the GNU toolchain): discovery + invalid login -> 401
cargo test -p coco-core --test live_ecamp -- --ignored
# same checks through reqwest and the real command code (needs a machine that can build Tauri)
cargo test -p co-co live_ -- --ignored
```

If you open the frontend in a plain browser (`vite` dev server only), the app shows
"Nur in der Desktop-App verfügbar". All eCamp access goes through Rust commands, so the frontend
only works inside the Tauri window.

## Running the login spike

1. Start the app (`npm run tauri dev -w apps/desktop`) or install a CI bundle (GitHub Actions →
   workflow run → artifact `co-co-<platform>`).
2. Follow the step-by-step plan in **[docs/m0-spike-protocol.md](docs/m0-spike-protocol.md)**:
   MiData login, password login, token refresh, camp read, logout, re-login.
3. Click **"Ergebnis kopieren"** in the spike protocol card and paste the Markdown report into the M0
   spike GitHub issue, one comment per OS. The report contains only cookie *names* and decoded token
   metadata (expiry, user IRI, roles), never cookie values or passwords.

## Security and privacy in short

- The eCamp login page runs in its own window. That window has **no** Tauri capabilities and no IPC
  access.
- Session cookies stay inside the Rust process. Cookie values are never sent to the UI or written to
  logs.
- Passwords are never stored or logged.
- The main window has a strict CSP and does not talk to the network directly.
- API calls are allowed only to the origin of the instance you logged in to.

See also the ADRs:

- [0001 Tauri desktop app](docs/adr/0001-tauri-desktop.md)
- [0002 Vue 3 + Vuetify 3 stack](docs/adr/0002-vue-vuetify-stack.md)
- [0003 Login via webview cookies](docs/adr/0003-login-via-webview-cookies.md)
- [0004 No backend, local storage only](docs/adr/0004-no-backend-local-storage.md)
- [0005 Data zones and AI](docs/adr/0005-data-zones-and-ai.md)

## Licence

**Not decided yet.** For now the repository has no licence file, so all rights are reserved.

Open question: eCamp v3 is licensed under **AGPL-3.0**. co-co is meant to be a separate program that
only uses eCamp's public HTTP API and copies no eCamp code, so we expect AGPL copyleft does not apply
to it. However:

- If we ever copy eCamp code (e.g. helpers, translations, components) into co-co, co-co would have to
  be AGPL-3.0-compatible.
- J+S/PBS stakeholders may prefer an open licence anyway.

Decide this before the first public release.
