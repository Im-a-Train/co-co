# Plan: encryption at rest, unlocked by the eCamp login

Status: accepted 2026-11-08 ([ADR 0010](../adr/0010-encryption-at-rest.md)), not implemented yet. Maintainer decisions are marked **Resolved** below. Decision record: [ADR 0010](../adr/0010-encryption-at-rest.md). All paths relative to
`apps/desktop/` unless noted. Line numbers are from the worktree `feedback-ux-round`.

## 0. Short answers

- Everything co-co writes is plaintext today (IndexedDB `coco`, localStorage, `allowed-paths.json`, JSON backups).
- Sessions are memory-only in Rust (ADR 0004), so a login already happens at every app start. That makes
  "unlock = successful login" natural.
- Recommended: random 256-bit data key in the OS keychain, released by Rust after a verified eCamp session,
  used by a Dexie middleware (WebCrypto AES-GCM, non-extractable key). No app passphrase in v1 (possible later); backups stay plaintext with a warning.
- Protects copied files, backups, other OS users, lost device. Does not protect against same-user malware.

## 1. Inventory of persisted data

### 1.1 IndexedDB `coco` (Dexie, `src/domain/storage/db.ts`)

Versions: v1 `:70` (12 tables), v2 `:85` (`midata`), v3 `:89` (`nds`), v4 `:93` (`selfChecks`). `TABLE_NAMES` at `:100`.
Singleton `getDb()` at `:123`; backup uses `TABLE_NAMES` (`domain/backup/index.ts`).

| Table | Primary key / indexes (v1-v4) | Content | Zone / sensitivity |
| --- | --- | --- | --- |
| `settings` | `key` | `app` = AppSettings (`types.ts:1053`: AI on/off+model, GPX pace, backup flags, rule packs, MiData baseUrl + **personId** + qualMapping, NDS enabled); `ruleState` (`ruleStateStore.ts:6`) | green; `midata.personId` is a personal id: medium |
| `coachInputs` | `campIri` | coach answers per camp | green-ish, medium |
| `mappings` | `campIri` | J+S category mapping | green, low |
| `overrides` | `id, campIri, findingId, ruleId` | muted/overridden findings | green, low |
| `campSummaries` | `campIri` | cached finding counts | green, low |
| `feedback` | `id, campIri, activityIri, roundId, status, updatedAt` | feedback text, may quote MiData (`redDerived`) | yellow, **high** (free text; red-derived flag) |
| `reviews` | `campIri, status` | review state | green, low |
| `rounds` | `id, campIri, [campIri+number]` | review rounds | yellow, medium |
| `snapshots` | `id, campIri, roundId` | full `CampFacts` per round (`types.ts:953`) | yellow, **high** (camp content) |
| `documents` | `id, campIri, path, contentHash, folder, [campIri+path]` | extracted full `text`, absolute file path, hash, AI summary (`types.ts:873`) | yellow, **high**; `path`/hash indexed = leak |
| `watchedFolders` | `id, campIri, &path` | folder paths | yellow, medium; `&path` leak |
| `aiLog` | `++id, at, feature, campIri` | token counts, no prompt text (`types.ts:1035`) | green, low |
| `midata` | `campIri` | aggregates, `red-derived` (`types.ts:537`) | red-derived, **high** |
| `nds` | `campIri` | aggregates + NDS ids, `red-derived` (`types.ts:526`) | red-derived, **high** |
| `selfChecks` | `id, campIri, createdAt` | leader self-check runs | yellow, medium |

Query patterns (grep): only `.where('campIri').equals()` (documents, feedback, rounds, overrides, selfChecks),
`.where('findingId').equals()` (`domain/rules/store.ts:14`), `aiLog.orderBy('at')` (`composables/useAi.ts:43`),
plain `.toArray()`/`.get()`/`.put()`. No range queries; no `path`/`contentHash`/`folder`/`status`/`updatedAt`
index is ever queried. So v5 can drop those indexes at no functional cost.
Red-derived person data (ADR 0009, `composables/usePersons.ts`, `domain/persons/types.ts:6`) is memory-only, never persisted.

### 1.2 localStorage (webview, plaintext)

| Key | Where | Content | Class |
| --- | --- | --- | --- |
| `coco.instances.v1` | `lib/instances.ts:17` | custom instance URLs + labels | low, needed pre-login (boot) |
| `coco.selectedInstance.v1` | `lib/instances.ts:18` | selected instance id | low, boot |
| `co-co.camps.phaseFilter` | `views/camps/CampsView.vue:48` | UI toggles | none; only after login, may move |
| `co-co.deadlines.showMilestones`, `co-co.deadlines.filters` | `views/rules/DeadlinesView.vue:34,51` | UI toggles | none |

No sessionStorage use.

### 1.3 Files and secrets written by Rust

| Item | Where | Content | Class |
| --- | --- | --- | --- |
| `allowed-paths.json` | `src-tauri/src/files.rs:26,39,49`, dir from `lib.rs:40` (`app_data_dir`) | allowed file/folder scope (absolute paths = names of coach files) | medium (filenames); read at `setup`, before any login; plaintext in v1 |
| Keychain `ch.imatrain.coco` | `ai.rs:24`, `coco-core/src/ai.rs:12` | Anthropic API key | secret, already protected |
| Keychain `co-co-nds`/`session` | `nds.rs:60,214` | NDS session cookie | secret, protected |
| Keychain MiData service + pointer | `midata.rs:220-238` | MiData token + base URL | secret, protected |
| WebView2 profile (`%LOCALAPPDATA%\ch.imatrain.coco\EBWebView`, identifier in `tauri.conf.json:5`) | Tauri default | IndexedDB LevelDB, localStorage, cache of the main window | where all of 1.1/1.2 physically lives |
| Login webview | `login_window.rs:101` `.incognito(true)`, cleared by `auth.rs:88` | cookies, ephemeral | already ephemeral |
| Logs | no file logger (`lib.rs` registers only dialog/opener); auth log is in memory (`useSpikeProtocol`) | n/a | none on disk |
| Exports | `files.rs:212` `save_text_file` (backup JSON, feedback text, reports) | user-chosen location | out of our control after save |
| MiniSearch index | `domain/documents/index.ts:446` | built in memory per search, not persisted | none |

## 2. What is read before login today

| Reader | Where | Reads | Plan |
| --- | --- | --- | --- |
| Router guard | `router/index.ts:106-109` | `session.init()` -> `commands.sessionStatus()` (`useSession.ts:113,121`), Rust memory only | stays; guard additionally awaits unlock |
| `/verbindung` | `ConnectionView.vue`, `useInstances` | localStorage instance list | boot store, unchanged |
| `/fristen` (no `requiresAuth`) | `DeadlinesView.vue:10-11` | `listCoachInputs`, `listCampSummaries` (Dexie) | **needs unlock** (also needs the eCamp camp list anyway) |
| `/regeln` (no `requiresAuth`) | `RulesCatalogView.vue:6-8` | `ruleState` row in `settings` | needs unlock for toggles; static catalog may render read-only while locked |
| `/einstellungen` | AI/NDS/MiData sections | `getAppSettings()` | needs unlock; instance management lives in `/verbindung` |
| `CampLayout` | `ExportReminder.vue`, `components/backup/useBackup.ts:18` | `settings.backup` | already behind `requiresAuth` |
| `aiGateway` | `domain/zones/aiGateway.ts:10,102` | settings | after unlock |
| Rust `FileState::load` | `lib.rs:40` | `allowed-paths.json` at start | plaintext in v1 (filenames only); optional encryption in phase 6 |

Rule: every route except `/verbindung` gets `meta.requiresUnlock`; new guard in `router/index.ts`. `getDb()` throws
`LockedError` while locked, so a missed reader fails loudly instead of silently reading nothing.

## 3. What "login" unlocks: options

| | (a) eCamp session -> keychain key | (b) app passphrase (Argon2id) | (c) Windows Hello / OS presence |
| --- | --- | --- | --- |
| Matches the request | yes, literally | no, second secret | partly |
| Works with webview OAuth | yes, key is random, not derived | yes | yes |
| Protects copied files/backups/other OS users | yes | yes | yes |
| Same-user malware | no (keychain readable) | yes at rest, not while unlocked | partly |
| Offline use | no (needs session verification) | yes | yes |
| Lost secret | keychain wiped = data lost (backup) | passphrase lost = data lost | OS dependent |
| Cost | low | medium (UI, lock timer, zeroize) | high, platform-specific |

**Decision (2026-11-08): (a); no passphrase in v1.** (b) remains a possible later hardening (wraps the data key; enables offline
unlock and idle auto-lock). (c) not now.

Note on password login: `commands.passwordLogin` exists (`useSession.ts`), but the OAuth/webview path does not
expose any password, so no design may depend on one.

Unlock flow (a):

1. App start: Rust has no session; webview shows `/verbindung`; Dexie closed.
2. eCamp login succeeds (`auth.rs`) or `session_status` returns a session (webview reload).
3. Rust verifies with one authenticated `GET /api/users/{id}` (the same call `useSession.loadUser` makes).
4. UI calls new command `unlock_data_store`; Rust re-checks "verified session now", reads or creates the
   keychain entry and returns the key bytes (base64) to the `main` window only.
5. Webview imports a non-extractable `CryptoKey`, zeroes the buffer, opens Dexie `coco2` with the middleware.
6. `logout` (`commands.rs:85`), session loss or `auth://session` null: `lockDataStore()` closes Dexie, drops the
   key, clears composable state (same hook point as `persons::clear_all_of`).

Multiple accounts/instances: v1 uses **one data key per device**, so any user who can log into any eCamp instance
on this PC unlocks all co-co data of that PC. The gate is "successful login", not "the right person". Stronger:
key and database per `(baseUrl, userIri)` (`coco-<hash>`, keychain user `datakey:<hash>`). Cost: per-DB backup and
import, migration of the legacy DB to the first user. Open question 2.

## 4. Encryption mechanics

| Option | Cost / risk | Verdict |
| --- | --- | --- |
| (i) Dexie DBCore middleware, WebCrypto AES-GCM, key in webview | Transparent to all stores; native AES-GCM is fast; multi-MB `documents.text` decrypts in ms; key bytes cross IPC once | **chosen** |
| (ii) Rust encrypts/decrypts per record via IPC | Every `toArray()` of snapshots/documents crosses IPC twice (MBs of JSON), new commands per table | rejected |
| (iii) Persistence in Rust (SQLite + SQLCipher / encrypted files) | Rewrite of all stores, composables, backup, tests; key never leaves Rust | revisit only if (i) proves insufficient |

CSP check (`src-tauri/tauri.conf.json:24-30`): `script-src 'self'`, `connect-src ipc: http://ipc.localhost`. WebCrypto
(`crypto.subtle`) needs no CSP change (`crypto.randomUUID` is already used, `db.ts:132`). "Secrets stay in Rust"
(CLAUDE.md) is amended by ADR 0010 for the data key only: not a credential for any external system, no exfiltration
channel under the CSP, non-extractable after import.

Envelope per row: stored object = `{ <primary key>, <remaining indexed fields>, _enc: { v:1, iv, ct } }`; `ct` =
AES-256-GCM(JSON(rest of record)), AAD = `table + "\0" + primaryKey`. Auto-increment `aiLog.id` stays outside.
Middleware (`db.use({ stack: 'dbcore', ... })`) wraps `mutate` (encrypt) and `get/getMany/query/openCursor` (decrypt).

Plaintext indexes after v5 (unused ones dropped, nothing queried is lost):

| Table | v5 indexes | Dropped (leak, unused) |
| --- | --- | --- |
| overrides | `id, campIri, findingId` | `ruleId` |
| feedback | `id, campIri` | `activityIri, roundId, status, updatedAt` |
| reviews | `campIri` | `status` |
| rounds | `id, campIri, [campIri+number]` | none |
| snapshots | `id, campIri` | `roundId` |
| documents | `id, campIri` | `path, contentHash, folder, [campIri+path]` |
| watchedFolders | `id, campIri` | `&path` (uniqueness checked in code) |
| aiLog | `++id, at` | `feature, campIri` |
| selfChecks | `id, campIri` | `createdAt` |
| others | unchanged | |

Accepted plaintext metadata: set of camp IRIs (opaque ids), number and size of records, `aiLog.at`,
`rounds.number`. Upgrade path: HMAC-SHA256 blind indexes for `campIri`/`findingId` (only equality is used) and
blind primary keys.

Migration of existing plaintext data: v1-v4 must not be edited and an in-place upgrade would leave mixed
plain/encrypted rows. Therefore `coco2` is a **new database** (starts at version 1 with the reduced schema). At
first unlock, if legacy `coco` exists: open it with the frozen `LegacyCocoDb` (v1-v4 verbatim), copy table by
table through the middleware, verify counts, then `Dexie.delete('coco')` last, so the run is idempotent and
resumable. Chromium LevelDB may keep deleted plaintext until compaction: documented limitation (BitLocker is the
answer for full-disk). Alternative (version(5) on `coco` with a per-row marker) is open question 6.

Key lost (keychain cleared, new OS profile): `unlock` finds ciphertext but no usable key -> UI says the data is
unreadable, offers "restore from backup" or "reset local data". AES-GCM failures surface as `DecryptError`, never as
silent empty data. A new key is never generated over existing ciphertext without that explicit choice.

## 5. Backup

**Resolved (2026-11-08): backups stay plaintext JSON in v1, with a clear warning at export. A password-encrypted backup is not in v1 (later).** The options and format below are kept as the later design only.

`domain/backup/index.ts` dumps every table as plain JSON (`EXPORT_VERSION`, `tables`, `:138-141`) and `save_text_file`
(`files.rs:212`) writes it. It is the only recovery path after key loss, and it is plaintext on disk.

| Option | Pros | Cons |
| --- | --- | --- |
| Keep plaintext + warning | no UX change | defeats the point; backups end up in cloud folders |
| **Password-encrypted export (default)** | recovery independent of keychain; protects the file | passphrase UX; loss = backup unreadable |
| Both, plaintext behind an explicit checkbox | flexibility | one more path to test |

Later design (not v1): encrypted export as default, plaintext as explicit opt-out (existing `omitRedDerived` stays).
Format: `{ format:'co-co-export-enc', version:1, kdf:{alg:'argon2id', m, t, p, salt}, iv, ct }`, `ct` = AES-256-GCM of the
existing export JSON. Argon2id runs in Rust (`argon2` crate; WebCrypto only has PBKDF2) via commands
`backup_encrypt` / `backup_decrypt`; the passphrase is never stored. Import detects the format by header.

## 6. Phases, files, tests

| Phase | Content | Files |
| --- | --- | --- |
| 0 | ADR accepted, contract rows | `docs/adr/0010*`, `docs/contracts/commands.md` |
| 1 Rust key store | `data_key.rs`: get-or-create 32-byte key in keychain (new service/user, pattern of `ai.rs`), `unlock_data_store`, `lock_data_store`, verified-session gate, zeroize; new-command checklist | `src-tauri/src/data_key.rs`, `commands.rs`, `lib.rs`, `build.rs` `COMMANDS`, `capabilities/default.json` (`main` only), `coco-core/src/datakey.rs` (pure checks), `src/lib/tauri.ts`, `docs/contracts/commands.md` |
| 2 Crypto + middleware | `crypto.ts` (envelope, AES-GCM, AAD), `encryptionMiddleware.ts`, `LockedError`/`DecryptError`; split `db.ts`: `legacyDb.ts` (v1-v4 frozen) + new `CocoDb` `coco2`; `getDb()` throws when locked; `unlockDb(keyBytes)`/`lockDb()` | `src/domain/storage/{crypto,encryptionMiddleware,legacyDb,db}.ts`, `src/domain/storage/__tests__/*` |
| 3 Session wiring + routes | `useDataStore` composable (`locked/unlocking/ready/error`), hooks in `useSession.setSession` and logout, `meta.requiresUnlock` + guard, unlock error UI in `/verbindung`, clear all composable caches on lock | `src/composables/useDataStore.ts`, `useSession.ts`, `src/router/index.ts`, `views/connection/ConnectionView.vue`, `locales/de/storage.json`, `App.vue` |
| 4 Migration | `migrateLegacy()` copy-verify-delete, resumable; "key lost" dialog (restore backup / reset) | `src/domain/storage/migrate.ts`, `components/settings/DataResetDialog.vue`, locales |
| 5 (later, not v1) Encrypted backup. v1 instead: plaintext warning in the export dialog (`components/backup/*`, locales) | Rust Argon2id commands, wrapper format, password dialogs, import detection | `src-tauri/src/backup_crypto.rs`, `coco-core/src/backupcrypt.rs`, `domain/backup/{index,envelope}.ts`, `components/backup/*`, `lib/tauri.ts`, `docs/contracts/commands.md` |
| 6 Polish | `allowed-paths.json` encryption (Rust-held key), mock + harness, docs (ADR 0004 note, architecture, spec artifact + republish) | `files.rs`, `dev/mockTauri.ts`, `docs/architecture.md`, `docs/spec/co-co-spec.html` |
| 7 later | opt-in passphrase wrap (not v1) + idle lock; blind indexes | separate ADR |

Test plan

| Layer | Tests |
| --- | --- |
| Unit (vitest + fake-indexeddb, already used in `domain/midata/__tests__/store.test.ts`) | roundtrip for every table; raw IDB read shows no plaintext marker string; AAD swap (copy row under other key) fails; wrong key -> `DecryptError`; `where('campIri').equals`, `[campIri+number]`, `orderBy('at')` still work; `getDb()` locked throws; lock then unlock keeps data |
| Migration | legacy fixture with all 15 tables: counts equal, legacy deleted last, interrupted run resumes, second run no-op |
| Contract `src/__tests__/contracts/encryptionGuard.test.ts` (style of `aiGuard.test.ts`) | every `TABLE_NAMES` entry has an encryption config with an allowlist of plaintext indexes; `dexie` imported only in `domain/storage`; `localStorage` keys only from an allowlist (boot + UI toggles); only `domain/storage` calls the unlock wrapper |
| Rust | pure `coco-core` tests (key length, base64, gate logic, Argon2id params, envelope parse); `cargo test --workspace`, clippy `-D warnings` |
| Harness (`UI_PORT=1431 npm run test:ui -w apps/desktop`) | mock `unlock_data_store`; flows: locked start shows only `/verbindung`; deep link to `/fristen` redirects; login unlocks; logout locks and clears; key-lost dialog; backup password dialogs; screenshots reviewed |
| Manual (Windows exe via `tauri build --no-bundle`) | keychain entry created; restart requires login; copy `%LOCALAPPDATA%\ch.imatrain.coco` to another profile and `strings` it: no readable content |

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Data loss (keychain wiped, OS reinstall) | encrypted backup default, `ExportReminder`, clear key-lost UX, never overwrite ciphertext with a new key silently |
| Offline/eCamp outage blocks all work | accepted in v1, documented; passphrase mode later |
| Migration bug destroys data | copy-verify-delete, legacy removed last, fixtures, backup prompt before migrating |
| A store bypasses the middleware | contract test, `LockedError`, single `getDb()` |
| False sense of security | UI text and ADR state the same-user limit; LevelDB remnants |
| Performance of large `documents.text`/`snapshots` | measure in phase 2 (expect ms); split heavy fields into own rows if needed |
| DBCore subtleties (cursors, `getMany`, bulk ops) | wrap all DBCore methods, tests per method |
| Login webview has no IPC | key command is `main`-window only (checklist) |

## 8. Open questions for the maintainer (ranked)

Resolved 2026-11-08: Q1 (unlock = eCamp login, no passphrase in v1), Q4 (plaintext backup with warning, no encrypted backup in v1), Q5 (all routes except `/verbindung` need login, incl. `/fristen` and `/regeln`), Q7 (data key may enter the webview as non-extractable key; credentials stay Rust-only). Still open: Q2, Q3, Q6, Q8, Q9.

1. ~~Is "unlock = successful eCamp login" (no offline use, no protection against same-user malware) acceptable, or
   must the passphrase mode be in v1?~~ **Resolved: yes acceptable, no passphrase in v1.**
2. One data key per device (v1) or per `(instance, user)` with separate databases?
3. Accept the plaintext metadata (camp IRIs, record counts, `aiLog.at`) or require blind indexes in v1?
4. ~~Backup default: encrypted or plaintext with warning?~~ **Resolved: plaintext with warning, encrypted later.**
5. ~~Should `/fristen` and `/regeln` stay usable without login?~~ **Resolved: no, they require login.**
6. New database `coco2` + copy migration (recommended) or in-place `version(5)` on `coco`?
7. ~~Amend the CLAUDE.md rule "secrets stay in Rust" for the data key?~~ **Resolved: yes, explicit exception for the non-extractable data key; credentials stay Rust-only.**
8. Encrypt `allowed-paths.json` (filenames) in v1 or phase 6?
9. Move the localStorage UI toggles into the encrypted `settings`, or keep them plaintext?
