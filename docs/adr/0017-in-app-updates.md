# ADR 0017: In-app updates and installer defaults

- Status: accepted
- Date: 2026-11-20

## Context

Releases (ADR 0008) were plain downloads: a coach had to notice a new version, uninstall the old one and
run the new setup. The NSIS finish page also pre-ticked «create desktop shortcut». All releases are GitHub
*pre-releases*, so GitHub's `/releases/latest` endpoint does not work for an update feed.

## Decision

1. **tauri-plugin-updater, wrapped by our own commands.** `app_update_check`, `app_update_auto_check_allowed`,
   `app_update_install` and `app_update_open_release` (Rust, `src/updater.rs`). The plugin's JS API and
   permissions are not exposed, so the webview keeps IPC to our commands only. Network access stays in Rust;
   the CSP is unchanged. The check contacts github.com only and sends no personal data.
2. **Feed.** CI publishes a static `latest.json` as asset of a rolling pre-release tagged `updater`
   (created on first use, asset replaced with `--clobber` after each real release). Endpoint:
   `https://github.com/Im-a-Train/co-co/releases/download/updater/latest.json`. The manifest is built by
   `scripts/updater-manifest.mjs` (unit-tested) from the version, the `.sig` and the release asset URL.
3. **Signing is mandatory.** Release builds run with `TAURI_SIGNING_PRIVATE_KEY` (GitHub secret, no password)
   and `--config {"bundle":{"createUpdaterArtifacts":true}}`; the public key is in `tauri.conf.json`.
   `createUpdaterArtifacts` is *not* in `tauri.conf.json`, so local and PR builds work without the key.
   Without the secret the release is built unsigned and the feed step is skipped with a warning.
4. **Install in place.** The plugin runs the NSIS setup with `/P /UPDATE /R` (passive): same install dir,
   shortcuts and app data kept, no new shortcuts. Install mode stays `currentUser`; `perMachine` would break
   silent updates. The app restarts itself afterwards.
5. **Portable and dev builds.** No `uninstall.exe` next to the exe = portable: no in-place update, the dialog
   offers the release page. Unstamped builds (`0.1.0` without pre-release) and debug builds skip the automatic
   check; the manual check still works.
6. **UI.** Start-up check once the data store is unlocked (its settings live in the encrypted store), at most
   once per 24 h; dialog with «Jetzt aktualisieren», «Später», «Diese Version überspringen»
   (`settings.update.skippedVersion`). Settings → Updates: version, auto-check switch (default on), manual check.
   co-co data is written to IndexedDB per operation, so installing does not lose saved data; text typed into an
   open, not yet saved field is lost on restart (the dialog says so).
7. **Installer.** `windows/installer-hooks.nsh` defines `MUI_FINISHPAGE_SHOWREADME_NOTCHECKED` at top
   level: the file is `!include`d before the finish page is declared, so the desktop shortcut option is unticked by
   default. (The `NSIS_HOOK_PREFINISHPAGE` macro some docs mention does not exist in the bundler version in use;
   a local build showed the macro would never be inserted.)

## Consequences

- **The private key lives outside the repo** (`~/.tauri/co-co-updater.key`). **If it is lost, installed apps can
  no longer be updated automatically** (they only trust the embedded public key): keep a backup. The maintainer
  must add the secret `TAURI_SIGNING_PRIVATE_KEY` in the repository settings.
- Versions before this feature have no updater; they need one manual install. Pre-release ordering is
  SemVer (`0.1.0-alpha.14 < 0.1.0-alpha.15 < 0.1.0`).
- Running a newer setup.exe by hand over an old install still preselects «vor der Installation deinstallieren»
  (template page, not configurable); app data survives either way unless «Daten löschen» is ticked.
- macOS and Linux do not self-update; the dialog offers the release page.
- The updater is unrelated to Windows code signing: SmartScreen warnings remain.

## Alternatives considered

- Own download + run of the setup: re-implements signature checking; rejected.
- `/releases/latest` as endpoint: unusable while every release is a pre-release.
- Changing the template's reinstall page: not possible with hooks/defines.
- `perMachine` install: needs elevation, breaks silent updates.
