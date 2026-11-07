# ADR 0001: Tauri 2 desktop app

- Status: accepted (to be confirmed by the M0 spike)
- Date: 2026-11-07

## Context

co-co (Coach Cockpit) helps J+S coaches review camps that are planned in eCamp v3. The requirements:

- Coaches use Windows, macOS and some Linux. They are volunteers and need a simple installer.
- We have no budget or wish to run a server (see [ADR 0004](0004-no-backend-local-storage.md)).
- The app must log in to eCamp with the existing account, including PBS MiData OAuth. eCamp's
  session cookies are `SameSite=strict` and host-only (see [ADR 0003](0003-login-via-webview-cookies.md)),
  so a plain web app on another origin cannot use them, and eCamp has no CORS/OAuth-client setup for
  third parties.
- Sensitive camp data (participants, health info in the future) should stay on the coach's machine.

Options considered:

| Option | Pros | Cons |
| --- | --- | --- |
| Web app (SPA) on own domain | No install | Cannot use eCamp cookies cross-site; would need a backend proxy that sees credentials |
| Browser extension | Runs in eCamp origin | Store review, per-browser builds, awkward UX for a "cockpit" |
| Electron | Mature, Chromium everywhere | ~100+ MB bundles, Node in main process, larger attack surface |
| **Tauri 2** | Small bundles, OS webview, Rust core, fine-grained capabilities, cookie-store API on webviews | Different webview engines per OS (WebView2 / WKWebView / WebKitGTK); Windows builds need MSVC |

## Decision

Build co-co as a **Tauri 2** desktop app (identifier `ch.imatrain.coco`, product name `co-co`):

- Vue frontend in the local `main` window.
- All eCamp HTTP traffic is done in **Rust** (`reqwest` with a cookie jar). The frontend calls typed
  Tauri commands and never sees tokens.
- Login runs in a second window, `ecamp-login`, which shows the real eCamp login page and gets **no**
  capabilities.
- Pin `tauri` to `2.12.x`. This version has `Webview::cookies_for_url`. The 3.0 alphas are excluded.
- Pure logic lives in a separate Rust crate without Tauri dependencies (`coco-core`), so it can be
  tested on any toolchain.

## Consequences

- One codebase gives installers for Windows (MSI/NSIS), macOS (dmg/app) and Linux (deb/rpm/AppImage)
  via `tauri-action` in CI.
- Windows release builds need **MSVC Build Tools + Windows SDK**. The `x86_64-pc-windows-gnu`
  toolchain without full MinGW binutils cannot build current Tauri, because `windows-link` uses
  raw-dylib and the build also needs `dlltool`, `as`, `windres` and a C compiler for TLS. Local
  development on such a machine is limited to `coco-core` and the frontend.
- The login has to be tested on all three webview engines, because cookie-store behaviour may differ.
  This is the purpose of the M0 spike protocol.
- Code signing (Windows Authenticode, Apple notarization) and auto-update are open and are not needed
  for M0.
- Known Tauri pitfall: on Windows, reading cookies from a sync command or event handler deadlocks
  (wry#583). Cookie access must run in async tasks.
