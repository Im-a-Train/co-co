# ADR 0004: No co-co backend; data stays local

- Status: accepted
- Date: 2026-11-07

## Context

co-co is a volunteer project for J+S coaches. Running a backend would mean:

- hosting costs and operations;
- a GDPR/DSG data-processing role for camp and participant data;
- a security target, since it would hold eCamp sessions of many users.

eCamp already is the system of record for camp planning, and its API gives the coach everything needed
for reading.

## Decision

- co-co has **no server component**. The desktop app talks **only** to the eCamp instance the user
  chose. There are no analytics or telemetry endpoints.
- eCamp sessions (JWT and refresh-token cookies) are held **in memory in the Rust process** for M0.
  - Later persistence, if any, goes to the OS credential store (Windows Credential Manager, macOS
    Keychain, Secret Service). It never goes to plain files or localStorage.
- UI preferences that are not sensitive may be stored in the main window's `localStorage`, e.g. the
  list of eCamp instances and the selected instance. Every access is wrapped in try/catch.
- Coach-specific data that eCamp does not store may later be stored in the app data directory of the
  OS (Tauri `app_local_data_dir`), e.g. review notes and checklists. This needs its own ADR on format,
  encryption and backup.
- co-co reads from eCamp. Write access (e.g. posting comments when `FEATURE_COMMENTS` is on) needs a
  separate decision.

## Consequences

- No operating costs and no central data store. Each coach's data stays on their own machine.
- No sync between devices or coaches. Sharing goes through eCamp, or through explicit export.
- Lost device: there is no server-side session to revoke. Mitigation: sessions are short-lived
  (JWT plus a single-use refresh token), and logout clears everything.
- Updates are delivered as new installers (CI artifacts / releases). Auto-update is a later decision.
