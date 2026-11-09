# ADR 0008: Versioning and releases (SemVer, alpha pre-release per merge)

- Status: accepted
- Date: 2026-11-08

## Context

Coaches who test co-co need a download they can install without a Rust/Node toolchain. CI already
builds a Windows NSIS installer, but only as a short-lived Actions artifact behind a GitHub login, and
every build claimed version `0.1.0`. Bug reports, backups (`appVersion` in the export) and the spike
protocol therefore could not tell builds apart. The project is in its **alpha** phase: anything may
still change, including stored data.

## Decision

1. **SemVer 2.0.** The repo holds the *base* version `MAJOR.MINOR.PATCH` (currently `0.1.0`) in all
   manifests: root and `apps/desktop` `package.json`, `package-lock.json`, `tauri.conf.json`,
   `src-tauri/Cargo.toml` (+ `Cargo.lock`). `npm run version:check` (CI `check` job) fails if they
   disagree or carry a pre-release suffix.
2. **Every push to `main` (= every merged PR) is a release** with version
   `<base>-<channel>.<n>`, e.g. `0.1.0-alpha.7`. The channel is `releaseChannel` in the root
   `package.json` (`alpha` now, later `beta`/`rc`); `n` is one more than the highest existing tag
   `v<base>-<channel>.*` (`scripts/version.mjs next`). A new base or channel starts again at `.1`.
3. **CI stamps, it does not commit.** The `version` job computes the version; the Windows job runs
   `node scripts/version.mjs set <version>` in its working copy before `tauri build`, so the binary,
   installer name, `__APP_VERSION__` (UI, backup export) and Windows file properties match. No bot
   commit lands on `main`; the git tag `v<version>` is the record.
4. **GitHub pre-release per version.** The `release` job creates tag `v<version>` on the built commit
   and a GitHub release marked *pre-release* (while `0.x` / a channel is set) with generated notes and:
   - `co-co_<version>_x64-setup.exe` – NSIS installer (recommended),
   - `co-co_<version>_x64-portable.exe` – the bare app exe, runs without installing (needs WebView2).
   - `co-co_<version>_universal.dmg` – macOS (Apple Silicon + Intel), ad-hoc signed, not notarised;
     added since 09.11.2026 when the macOS job succeeded (a failed Mac build does not block the release).
   MSI is not published: WiX only accepts numeric pre-release identifiers.
5. **Raising the base version is a normal PR**: `npm run version:bump -- minor` (or `patch`/`major`)
   rewrites all manifests. In `0.x`: `minor` for new milestones/features or breaking data changes,
   `patch` for fix-only stretches. `1.0.0` marks the first stable release; then the channel moves to
   stable and releases drop the suffix (needs a small change to `version.mjs next`).

## Consequences

- Each merge produces a downloadable, uniquely versioned build; bug reports and backups carry it.
- Release builds are unsigned; SmartScreen warns on first run. Code signing is a separate decision.
- Main CI runs are no longer cancelled by newer pushes (a half-published release would leave a tag
  gap); concurrent merges queue instead.
- No auto-updater yet. Tauri's updater plugin can later read the GitHub releases (needs a signing key).
