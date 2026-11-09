# ADR 0010: Encryption at rest, unlocked by the eCamp login

- Status: Accepted, implemented (pending live check on WebView2) (2026-11-08)
- Date: 2026-11-08
- Plan: `docs/plans/encryption-at-rest.md` (facts, inventory, phases, tests)
- Builds on: [0003](0003-login-via-webview-cookies.md), [0004](0004-no-backend-local-storage.md) (which left
  "format, encryption and backup" to a later ADR), [0005](0005-data-zones-and-ai.md), [0009](0009-personal-data-in-ui.md)

## Context

Maintainer request: everything co-co persists is encrypted at rest and only readable after a successful
login. Today all co-co data is plaintext IndexedDB (database `coco`, 15 tables, `domain/storage/db.ts`) in the
WebView2 profile, plus plaintext `localStorage` and one JSON file in the app data dir. Backups are plaintext
JSON. Sessions live in Rust memory only (ADR 0004), so every app start already needs a fresh login.
The eCamp login runs in a webview (OAuth, ADR 0003); the app never sees the password, so no key can be
derived from it.

## Decision

1. **Threat model, stated honestly.** We protect data at rest against copied files, profile/cloud backups,
   disk images, other OS users and a lost or sold device. We do **not** protect against code running as the
   same logged-in OS user (it can ask the keychain) or against memory access while unlocked.
2. **Data key.** One random 256-bit AES key (the "data key") is created on first unlock and stored in the OS
   keychain through the existing `keyring` crate (new entry, own service/user, like `ai.rs:24`). Rust releases
   it only after a **verified** eCamp session: a successful authenticated eCamp API call (login or session
   restore), not merely cookies present. Locked state = no key in the webview, Dexie closed.
3. **Mechanics: Dexie DBCore middleware + WebCrypto AES-256-GCM** in the webview, key imported as a
   **non-extractable** `CryptoKey`. Per record: primary key and the few remaining indexed fields stay as is
   (see 5); all other fields go into one `_enc` envelope `{v, iv, ct}` (fresh 96-bit IV, table name and primary
   key as AAD so rows cannot be swapped). Rust-side per-record encryption (IPC) and moving persistence to
   Rust (SQLCipher) are rejected for v1 (cost / rewrite), see the plan.
4. **Amendment to "secrets stay in Rust".** The data key is the one secret that reaches the webview, as raw
   bytes once per unlock over IPC, then imported non-extractable and the buffer zeroed. Justification: it is
   not a credential for any external system (no eCamp/MiData/Anthropic access, nothing to replay), it protects
   only data the webview already holds in the clear while unlocked, and the strict CSP (`script-src 'self'`,
   `connect-src ipc:`) leaves no exfiltration channel. Credentials (cookies, tokens, passwords, API keys)
   stay Rust-only exactly as before. The data key is never persisted by the UI, logged or put in events.
5. **Index hygiene.** `version(5)` removes indexes that leak content and are never queried (`documents.path`,
   `contentHash`, `folder`, `[campIri+path]`, `watchedFolders.&path`, `feedback.status/updatedAt/activityIri`,
   `reviews.status`, ...). Remaining plaintext metadata: opaque ids, `campIri`, `findingId`, `ruleId`,
   `roundId`, `[campIri+number]`, `aiLog.at`. Record counts, sizes and these ids are an accepted leak
   (opaque eCamp IRIs, no names or text). Blind (HMAC) indexes are the documented upgrade path.
6. **Boot store.** A small unencrypted `localStorage` area stays for non-sensitive pre-login data only
   (instance list, selected instance, UI toggles). Nothing else is readable before unlock; all routes except
   `/verbindung` require unlock, including `/fristen`, `/regeln`, `/einstellungen`.
7. **Lock on logout.** Logout, session loss/expiry without refresh and app close drop the key reference, close
   Dexie and clear module-level state. Next login re-opens.
8. **Migration.** Existing plaintext data is migrated once at first unlock (read, encrypt, write into a new
   database, delete the old one), never by editing an existing schema version. The new Dexie database name is
   `coco2`; version(5) lives there with the reduced indexes.
9. **Key loss and backups.** If the keychain entry is gone, the data cannot be read. co-co then offers
   "reset local data" or restore from a backup. Backups stay **plaintext JSON** in v1; the export dialog
   shows a clear warning that the file is unencrypted. A password-encrypted backup is not part of v1
   (possible later).
10. **No app passphrase in v1** (maintainer decision). Unlock is the verified eCamp login only. A passphrase
    (Argon2id) wrapping the data key, enabling offline unlock and idle auto-lock, is a possible later
    addition. Windows Hello is a further option.
11. **Keychain on all platforms.** The `keyring` crate is already configured for Windows Credential Manager,
    macOS Keychain and Linux Secret Service in `src-tauri/Cargo.toml`.
12. **All routes except `/verbindung` require login/unlock**, including `/fristen` and `/regeln`.
13. **Enforcement.** A contract test asserts that every table in `TABLE_NAMES` is covered by the middleware
    (no table is added without it), and that no code outside `domain/storage` opens the raw database.

## Alternatives considered

| Option | Why not (now) |
| --- | --- |
| Passphrase only (Argon2id) | Extra login on top of eCamp; password loss = data loss; not what was asked ("until the login was successful") |
| Key derived from eCamp password | Impossible: OAuth login in webview, password unknown |
| Windows Hello only | No Linux/macOS parity, high cost; kept as later hardening |
| Per-record encryption over IPC | Hundreds of IPC calls per list view, large document `text` crossing IPC twice |
| SQLCipher in Rust | Rewrite of every store, composable and backup; revisit if Dexie limits bite |
| Encrypt whole IndexedDB file via OS (EFS/BitLocker) | Not under app control, not tied to login |

## Consequences

- Offline use stops: unlock needs a reachable eCamp (session verification). Offline unlock would need a later
  passphrase/Hello mode (not v1).
- Plain-text "boot" data remains: custom instance URLs and UI toggles.
- All future tables must pass through the middleware (contract test). Search over document text keeps
  working because MiniSearch is built in memory after decrypt (`domain/documents/index.ts:446`).
- WebView2/Chromium LevelDB may keep deleted plaintext blocks until compaction; migration cannot guarantee
  secure erase. Documented limitation; recommend BitLocker for full-disk.
- Red-derived (ADR 0006/0007/0009) tables become encrypted like everything else; their other rules
  (no AI, optional backup omission) are unchanged.
- The spec artifact, `docs/contracts/commands.md`, `docs/architecture.md` and ADR 0004 text ("no
  localStorage for secrets", "own ADR on encryption") are updated in the implementing PRs.
