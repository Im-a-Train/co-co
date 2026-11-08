# ADR 0008: Personal data (red zone) in the UI

- Status: Accepted (2026-11-08) for phase P1 as built; see "Implementation status (P1)" below
- Date: 2026-11-08
- Context for: `docs/plans/participants-and-nds-sync.md` («Personen» tab, MiData/NDS reconciliation)

## Context

[ADR 0006](0006-midata-red-zone.md) and [ADR 0007](0007-nds-red-zone.md) keep MiData and NDS data in
Rust and send only aggregates to the UI: names, birth dates and AHV numbers never leave Rust. The
planned «Personen» tab and the MiData-to-NDS reconciliation need the opposite: the coach must see and
check individual people (minors and adults), and possibly send them to NDS. That moves red data into
the webview. [ADR 0005](0005-data-zones-and-ai.md) stays untouched: red data never reaches an AI.

This ADR relaxes the «aggregates only» point of 0006/0007 **only for the Personen feature**, and only
under the rules below. Everything else keeps the aggregate rule.

## Decision

1. **Separate type family.** Person data uses its own types (`PersonRecord`, `PersonDiff`, ...) branded
   `Red` (TypeScript brand `{ __zone: 'red' }`). `aiGateway` and every AI request builder reject branded
   values; a contract test (next to `aiGuard.test.ts`) fails if a `Red` type is reachable from an AI
   request type or if `tauriAi.ts` is imported anywhere else.
2. **Minimum fields, decided per purpose.** Default set in the UI: nickname/first name, last name,
   birth date (or age at camp start), role, qualification state. Address, e-mail and phone are not
   fetched in v1. AHV number is fetched **only** for the NDS match/enrichment step, is held in Rust, and
   reaches the UI only masked (e.g. `756.****.****.97`). Health data, allergies, `additional_information`,
   medication and emergency contacts are **never** requested, stored or shown.
3. **Never in logs, events, errors.** No personal value in log output, Tauri events, error strings,
   panic messages, URLs or the clipboard. Errors name fields and counts only (as today for HTTP 400).
   Tests check the Rust error paths.
4. **Memory first.** Default is no persistence: data is fetched on click, held in Rust (and a reactive
   store in the webview), and cleared on logout, on «Sperren» (lock) and on app close. See the plan for
   the optional encrypted cache.
5. **If persisted: ciphertext only.** Anything written to disk or IndexedDB is encrypted in Rust
   (AEAD, key from the OS keychain, optionally wrapped by a passphrase). The webview never sees the key.
   Plaintext person data never goes into Dexie.
6. **Backup excludes it.** The backup export leaves person data out and cannot be configured to include
   it in v1. Restoring a backup does not restore people; one manual refresh does.
7. **Masked by default, explicit reveal.** AHV and full birth dates are masked until the coach clicks
   «anzeigen»; the reveal times out (e.g. 30 s) and is never persisted. No «copy AHV» button. If a copy
   is ever needed (for a manual NDS entry) it is an explicit action that clears the clipboard after
   30 s and is documented here first.
8. **No real data in the repo.** UI harness fixtures for the tab use synthetic people only; `e2e-ui`
   shots are checked for real data before commit. Mock data is obviously fake (invented names,
   placeholder AHV like `756.0000.0000.00`).
9. **Writes to NDS** are not part of this ADR. They need a separate ADR (allow-list of mutations,
   audit log, BASPO answer) before any mutation is enabled; `ensure_query_only` stays.
10. **Purpose limit for AHV.** AHVG Art. 153c ff. restricts systematic AHV use to permitted purposes.
    co-co would use it solely to identify a person in NDS for the coach's own J+S camp. Open: confirm
    with BASPO/PBS that this is covered. Fallback: never read `ahvn13`, show only the match result.

## Implementation status (P1, as built)

- «Personen» tab (`src/domain/persons`, `src/composables/usePersons.ts`, `src-tauri/src/persons.rs`):
  MiData and NDS person lists are loaded **read-only** on click and reconciled in the webview.
- **Memory only**: the lists live in Rust state (`PersonsState`) and in the webview store. Nothing goes to
  Dexie or the backup (no table, nothing exported).
- **Cleared** on logout (eCamp, MiData and NDS, in Rust too, via `persons_clear` / `clear_all_of`), on camp
  switch and when leaving the tab.
- **Fields loaded**: names, birth date, role, qualification state, ids. No AHV number, address, e-mail,
  phone or health data is loaded (point 2's AHV enrichment is not built). Birth dates are masked by default.
- **AI**: person types carry the `__red` brand; `aiGateway` refuses a payload containing it at any depth
  (`containsRedBrand`). Contract test `src/__tests__/contracts/personsGuard.test.ts` guards the rules.
- **NDS writes are not built.** They still need their own ADR (point 9).
- Still open: point 10 (AHV purpose, moot while AHV is not loaded), reveal timeout and clipboard rules
  (no reveal or copy feature exists yet).

## Consequences

- The Personen tab is possible without weakening the AI rule; the brand + test makes an accidental
  leak a build failure rather than a review finding.
- More attack surface than aggregates: a compromised webview could read the in-memory store. The strict
  CSP, no remote content in the main window and no third-party scripts become load-bearing.
- Encryption at rest protects against copied files, not against an attacker in the logged-in session.
- Offline use only works if the encrypted cache is enabled; otherwise a MiData login is needed each time.

## Alternatives considered

- **Keep aggregates only, do the diff in Rust and show counts.** Safest, but the coach cannot see
  *who* is missing, which is the whole point.
- **Plaintext in Dexie.** Rejected: any process of the user account, backups and file sync can read it.
- **Persist the full dataset in the OS keychain.** Keychains hold small secrets (Windows Credential
  Manager entries are only a few KB); use the keychain for the key, not the data.
- **Server-side storage.** Contradicts [ADR 0004](0004-no-backend-local-storage.md).
