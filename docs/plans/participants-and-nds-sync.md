# Plan: «Personen» tab and MiData / NDS reconciliation

Status: P1 built (read-only, memory only, M12; no AHV, no CSV import, no encrypted cache); P2/P3 are plans only. Date: 2026-11-08. Related: ADR 0005, 0006, 0007, **0008 (accepted for P1)**.
All NDS write behaviour below is **unverified**. All examples are invented.

## 0. Short answers

- **Do we have an NDS API to register people?** No. co-co's `nds` module is read-only
  (`ensure_query_only`). The GraphQL documents seen so far are queries only (OfferList, CampList,
  SupervisorsListForCamp, ParticipantsListForCamp, ActivityListForCamp, Rega*). A hint that writes exist
  in the web UI: list rows carry `_availableOptions { delete displayPersonDetails }`. The add flow has
  not been captured. The official partner API (`api.baspo.admin.ch/nds/api`) is Kaderbildung-only.
- **Can data be encrypted locally and opened after a login?** Yes, see section 4. Recommendation:
  memory-only in v1, encrypted cache as an opt-in step.
- **AHV is not available from MiData's JSON:API.** `people` attributes in the openapi are: first_name,
  last_name, nickname, company(_name), email, address fields (street, housenumber, zip_code, town,
  country, ...), household_key, primary_group_id, gender, birthday, language, picture, updated_at,
  additional_information, pronouns. No AHV, no PEID, no nationality. AHV enrichment must therefore come
  from NDS (as impex does) or from MiData's classic CSV export.

## 1. What the impex tool does (structures only)

Tool: `midata-nds-impex` (Node/TS, csv-parse). Pipeline: read MiData CSV(s) and NDS JSON dump(s), match,
write an enriched JSON (`ndsData` embedded per MiData row), report unmatched rows with suggestions.
It also splits people by age at a fixed reference date (under 20 vs 20+), and has a Playwright script that
unticks attendance checkboxes in the NDS UI from an absence list (fragile label selectors; suggests the
author knew of no bulk attendance API).

**MiData CSV, two shapes** (delimiter `;`, BOM tolerated):

| Shape | Columns | Notes |
| --- | --- | --- |
| «standard» (person export) | PERSONENNUMMER; NAME; VORNAME; GEBURTSDATUM (`dd.mm.yyyy`); GESCHLECHT; AHV_NR; PEID; NATIONALITAET; MUTTERSPRACHE; STRASSE; HAUSNUMMER; PLZ; ORT; LAND | Prepared export; AHV_NR, PEID, PERSONENNUMMER usually empty |
| «event participation» (hitobito event export) | Personennummer, Nachname, Vorname, Geburtstag, Id der Hauptebene, Sprache, Strasse, Hausnummer, PLZ, Ort, Land (+ role columns) | No AHV, no gender |

Invented row: `;Muster;Anna;02.01.2010;F;;;CH;de;Beispielweg;5;3000;Bern;CH`

**NDS JSON** (paged person list `{ content: [...] }`), per person: `businessId, personNumber, lastName,
firstName, birthDate (yyyy-mm-dd), ahvn13 (13 digits), peid|null, personStatus (e.g. ACTIVE),
rowTitle{de,fr,it}, __typename: Person`. Invented:
`{"businessId":"b-1001","personNumber":"2001","lastName":"Muster","firstName":"Anna","birthDate":"2010-01-02","ahvn13":"7560000000000","peid":null,"personStatus":"ACTIVE"}`.
This is an NDS person list, a different operation than the camp lists co-co observed; its operation name
is not in our contract yet (needs capture).

**Matching** (no common id is reliable: MiData's Personennummer is empty in exports, NDS personNumber
differs):

1. Exact key: `lastName | firstName | birthDate` after normalisation. Must be unique, else warn.
2. Split key: same, but names split on space, hyphen, slash, dot etc. and re-joined (double names,
   punctuation).
3. Fallback is **suggestion only** (name without birth date, exact or split); never auto-accepted.

Normalisation: trim, lowercase, collapse spaces, transliterate (ä→ae, ö→oe, ü→ue, ß→ss), strip diacritics
(é→e), unify dashes, birth date to `yyyymmdd` from `dd.mm.yyyy` / `yyyy-mm-dd` (`.`, `-`, `/` separators).
Result: NDS `ahvn13` / `peid` / `personNumber` copied onto the MiData row.

The unmatched list is the useful output: people NDS does not know yet versus spelling or birth-date
typos (suggestions). co-co should port the key logic into `domain/persons/match.ts` (pure) with synthetic
tests: double names, umlauts, swapped day/month, duplicates.

**Data hygiene note:** two Markdown guides in the impex repo (`ATTENDANCE_AUTOMATION_GUIDE.md`,
`NDS_COMPLETION_GUIDE.md`) appear to contain real names of camp members. They were not quoted here;
consider removing them from that repo.

## 2. «Personen» tab design

### Data source

| Option | Pros | Cons |
| --- | --- | --- |
| **A. MiData JSON:API** `GET /api/event_participations?filter[event_id][eq]=<id>&include=participant,roles&fields[people]=first_name,last_name,nickname,birthday,gender,language&page[size]=100` | Already in `midata.rs`; live, coach-controlled; roles included; guests handled | No AHV/PEID; address attributes exist but only fetch if NDS creation needs them; which fields a coach role may read is unverified live |
| B. MiData CSV export imported by file | Works when the API hides fields; has address; | Manual download; plaintext file on disk (parse in Rust via the scoped file access, never persist, tell the coach to delete it) |

Recommendation: **A by default, B as fallback**, both producing the same `PersonRow` type in
`coco-core`. Qualifications via the existing `/api/qualifications`. NDS side: `ParticipantsListForCamp`
and `SupervisorsListForCamp` (already captured: businessId, personNumber, names, birthDate, address,
`targetAudienceGroup` / `involvementType`); AHV/PEID would need the not yet captured NDS person search.

### Columns

| Column | Source | Note |
| --- | --- | --- |
| Name (first, last, nickname) | MiData | Nickname first if set |
| Typ | MiData role | TN / Leitende / Küche / Coach / Gast (`event_guests`: no birthday) |
| Rolle | `event_roles.label` | |
| Geburtsdatum, Alter bei Lagerbeginn | MiData | Birth date masked by default, age always visible |
| Stufe | derived from age, configurable PBS bands | Mapping stays coach-confirmed |
| J+S-Alter | age 5-20 at camp start (existing helper) | Flag; edge cases at the cutoff |
| Qualifikation (Leitende) | `/api/qualifications` | valid over camp / expired / none (existing logic) |
| NDS-Status | diff (section 5.2) | übereinstimmend / fehlt in NDS / nur in NDS / abweichend |
| NDS-Nr. | NDS | Only when matched |
| AHV | NDS (Rust only) | Masked, detail drawer only |

Filters: Typ, Stufe, J+S-Alter, NDS-Status, Qualifikation, text. Header chips: counts per type and number
needing action. Actions in P1 (no writes): «Aus MiData neu laden», «Aus NDS neu laden», «Sperren».

### Excluded (data minimisation)

Never: health, allergies, medication, emergency contacts, `additional_information` (person and
participation), household_key, pictures, IBAN. v1 also excludes e-mail and phone. AHV only for NDS
matching, masked. Address only in P2/P3 if NDS creation requires it, held in Rust, not in the table.

### Architecture

New Rust commands in the `midata`/`nds` modules (follow the new-command checklist in CLAUDE.md):
`persons_load(campId)`, `persons_diff(campId)`, `person_reveal(id, field)`, `persons_lock()`. Rust returns
branded `PersonRow[]` with masked AHV. Domain: `domain/persons/{match,diff,age}.ts`, pure and tested.
New `views/camp/PersonsView.vue`, tab in `CampLayout`, `locales/de/persons.json`.

## 3. Zones

See [ADR 0008](../adr/0008-personal-data-in-ui.md): red brand type, aiGateway + contract test, no logs/
events/errors, memory-first, ciphertext-only persistence, excluded from backup, masked AHV, no clipboard,
synthetic fixtures only, writes need their own ADR.

## 4. Storage and encryption

| Option | What | Protects against | Does not protect against | Cost |
| --- | --- | --- | --- | --- |
| **(a) Memory only** | Fetch on click, keep in Rust state; clear on logout, lock, app close | Everything on disk (files, backups, sync, forensic copy) | Malware or attacker in the running session | Re-fetch each start (MiData/NDS login again) |
| (b1) Encrypted cache, key in OS keychain | Rust encrypts with XChaCha20-Poly1305 or AES-256-GCM, random 256-bit key via the existing `keyring` crate (Credential Manager / Keychain); ciphertext in app data dir or as a Dexie blob | Copied files, profile backup/cloud sync, other OS users | Anyone running as the same logged-in user (can ask the keychain) | Small: AEAD crate, versioned envelope, wipe on «Daten löschen» |
| (b2) Passphrase-derived key | Argon2id from a coach passphrase wraps the key; key lives in memory after unlock; auto-lock after idle | Stolen unlocked or shared laptop profile, same-user malware at rest | Keylogger, memory scraping while unlocked, forgotten passphrase (cache lost, refetch) | Unlock screen, lock timer, zeroize |
| (b3) Windows Hello / biometric-gated keychain item | Key requires user presence | As b2, better UX | Platform-specific, no Linux parity | Highest; later |

Notes: the webview never holds the key; IndexedDB gets ciphertext or nothing; keychains store small
secrets, so store the key, not the data. The «login» here is an app unlock, independent of MiData session
cookies.

**Recommendation v1: (a).** The data can always be re-read from MiData/NDS, and no stored copy means no
copy to breach. If offline use or login friction hurts, add **(b1) wrapped by (b2)** as an opt-in
«verschlüsselter Zwischenspeicher». State plainly in the UI that this does not stop an attacker while the
app is unlocked and the OS session is theirs.

## 5. NDS sync plan

### 5.1 What is needed to write (all unverified)

NDS has no public write API. Candidate mechanisms, preferred first:

1. The NDS web UI flow «Teilnehmende/Leitende hinzufügen»: probably GraphQL mutations on the
   `youthtraining` service (person search by AHV or name+birth date, then add participant/supervisor with
   `targetAudienceGroup` / `involvementType`). Names and shapes unknown.
2. An NDS **import file** for participants (Excel/CSV template), if the camp page offers one. Unknown.
3. Creating a **new person** in NDS. Probably not possible for coaches. NDS normally receives people from
   MiData/PBS, so the realistic question is why a MiData person is missing (not synced yet, different
   birth date, no AHV).

**Capture procedure** (same discipline as the existing redacted captures): only on a **test/training
camp**, record a HAR while doing: search person by AHV; search by name+birth date; add one participant;
add one leader; change target audience group; remove one; download/upload the import template if present.
Reduce with `tools/nds/har-redact.mjs` (values to types, IDs templated, cookies dropped, enums via
`--keep`). Add mutation documents to a separate `operations.mutations.graphql` and a new section of
`openapi.yaml`. Raw HAR never enters the repo or an assistant context. Verify read-after-write by
re-running ParticipantsListForCamp.

### 5.2 Diff model

Inputs: MiData people (TN / Leitende) and NDS participants + supervisors of the camp. Per person a stable
`diffId` (hash of the match key, never the key itself):

| State | Meaning | Proposed action |
| --- | --- | --- |
| `match` | Same person and role group | none |
| `missing_in_nds` | In MiData camp, not in NDS camp | **add** (needs an NDS person found) |
| `only_in_nds` | In NDS camp, not in MiData | review; never auto-remove |
| `field_diff` | Matched, but birth date / name spelling / address / group (TN vs Leitende) differ | show both values; coach picks; NDS is the record for identity |
| `ambiguous` | Several NDS candidates or only a name-only match | coach picks candidate; no action by default |
| `person_not_in_nds` | No NDS person at all | manual outside co-co (P1/P2) |

Matching: AHV when both sides have it, else the impex keys. Matching runs in Rust (or on Rust-supplied
keys); only ids, states and minimal display fields cross to the UI.

### 5.3 Safeguards for writes (P3)

- **Dry run first**: preview «Das würde geändert», per-person checkbox, nothing preselected, summary
  dialog (counts, camp name) before the batch.
- **Allow-list in Rust**: only named mutations (e.g. add participant, add supervisor) with fixed variable
  shape and ids from a prior read. `ensure_query_only` becomes `ensure_allowed_operation`; everything
  else keeps failing. No generic «run GraphQL» command; each mutation gets its own `allow-<name>`
  capability and a test that unlisted operations still fail.
- **Idempotency**: re-read the NDS list right before writing; skip people already present.
- **One at a time**, small delay, stop on first error.
- **Audit log** (local, encrypted if persisted): timestamp, camp, operation, diffId, result, HTTP status.
  No names or AHV.
- **Rollback limits**: an add can be undone only via the NDS delete option (`_availableOptions.delete`),
  if still permitted (approval state, attendance recorded). Removing or editing identity fields may
  destroy attendance or subsidy data, so P3 is **add only**.
- **Kill switch**: «NDS-Schreiben aktivieren», off by default, with a risk text.

### 5.4 ToS / BASPO

Reading with the coach's own session is already a grey zone (ADR 0007). Writing registrations changes
official records, affects subsidies, and is automated use of an undocumented interface. **Before P3 ask
BASPO/J+S (and PBS) in writing:** may a coach tool use the web backend for writes; is there an official
participant import (file or API); may AHV numbers be processed in a local tool for this purpose. Without
a yes, stop at P2.

### 5.5 Phases

| Phase | Scope | NDS writes | Gate |
| --- | --- | --- | --- |
| **P1** | Personen tab (MiData A, CSV B), NDS camp lists, diff view, optional masked AHV enrichment, match tests | none | ADR 0008 accepted |
| **P2** | Export the «to add» list as a file for NDS: import template if one exists, else a CSV checklist the coach saves consciously | none | Template found or checklist accepted |
| **P3** | Direct add via allow-listed mutations, dry run, audit log | add only | HAR capture on a test camp, BASPO answer, new ADR 0009 |

## 6. Milestones, questions, risks

### Milestones

| # | Content | Size |
| --- | --- | --- |
| M-P0 | Accept ADR 0008; `Red` brand + guard tests; synthetic fixtures; masked-display component | S |
| M-P1a | MiData persons load (A) + CSV import (B) in `coco-core`, `PersonRow`, tab with filters | M |
| M-P1b | Port match/normalisation from impex to `domain/persons` with tests; NDS camp lists into rows; diff states | M |
| M-P1c | NDS person list capture (read), AHV enrichment in Rust, reveal/mask, lock | M |
| M-P1d | Optional encrypted cache (b1 + b2) | M |
| M-P2 | Export file for NDS | S |
| M-P3 | Capture write flows, BASPO answer, ADR 0009, mutations, dry run, audit | L |

Each milestone also updates the spec artifact (working agreement in CLAUDE.md).

### Open questions (ranked)

1. Does the coach's MiData role expose all participations with birth dates and roles through the API
   (unverified live)? If not, CSV import is the main path.
2. Will BASPO/J+S allow write access, or point to an official import, for participants?
3. How do people get into an NDS camp today (UI flow, import file, MiData sync)? Capture needed.
4. Persistence: **resolved for P1: memory only (a)**. An encrypted cache is superseded by general encryption at rest (ADR 0009, no passphrase in v1).
5. Is AHV processing in co-co acceptable, or should co-co never read `ahvn13` and only show match yes/no?
6. Stufe and age-band mapping (PBS vs J+S) and the exact J+S age cutoff date.
7. Show «only in NDS» people at all (may be legitimate late changes)?
8. Does the impex attendance automation idea belong in co-co? Separate ADR; out of scope here.

### Risks

| Risk | Mitigation |
| --- | --- |
| Personal data leak (AI, logs, backup, screenshots) | ADR 0008, brand + contract tests, synthetic fixtures only |
| Wrong match leads to a wrong NDS write | AHV-first matching, ambiguous never automatic, dry run, add-only |
| Undocumented NDS interface changes or is blocked | Read-first phases, P2 file fallback, feature flag |
| ToS / legal (AHVG, DSG) | Written BASPO/PBS answer before P3; minimal fields |
| MiData fields hidden by role | CSV fallback |
| Encrypted cache gives false security | Honest UI text; default is memory-only |
| Lost passphrase | Cache is disposable; re-fetch from the sources |
