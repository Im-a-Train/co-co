# ADR 0007: NDS connection (read-only, red zone, unofficial web API)

- Status: accepted
- Date: 2026-11-07

## Context

The NDS (Nationale Datenbank Sport, www.nds.baspo.admin.ch) is where J+S camps are registered,
approved, run and settled. It knows what co-co otherwise asks the coach to type: when the camp was
approved («bewilligt am»), whether it is closed or being assessed, planned and actual participant
and instructor counts, activities and open attendance checks (AWK), material rental orders. Several
rules (JS-DL-01/02 deadlines, participant counts) need exactly this.

NDS has **no public API**. The only way in is the web application's own backend, reverse-engineered in
`docs/contracts/nds-api/` (OpenAPI spec, GraphQL documents, README). Login is AGOV -> Keycloak, result
is a `SESSION` cookie on `www.nds.baspo.admin.ch`. The participant and supervisor lists contain
personal data of minors and adults (names, birth dates, addresses, AHV numbers). That is red under
[ADR 0005](0005-data-zones-and-ai.md). There is no backend ([ADR 0004](0004-no-backend-local-storage.md)),
so co-co talks to NDS from the desktop, through Rust only.

## Decision

1. **Own Rust module `nds`** with its own reqwest client, cookie jar and keychain entry (service
   `co-co-nds`), never shared with eCamp or MiData. Network only through Rust.
2. **Login in a separate window** `nds-login` (no capability, no IPC) opening the Keycloak entry URL.
   Rust detects the `SESSION` cookie like it does for MiData's `_session_id`, stores the session in the
   OS keychain and closes the window. Only cookie names may reach the UI.
3. **Read-only.** Only `GET` and GraphQL **queries**. Documents starting with `mutation` are rejected
   in code (`coco_core::nds::ensure_query_only`). No other write path exists.
4. **Aggregates only.** Raw responses are parsed and reduced in `coco-core::nds`. Participant and
   supervisor lists are reduced to counts per `targetAudienceGroup` / `involvementType`. Names, birth
   dates, AHV numbers (`ahvn13`), addresses, e-mails and IBANs never leave Rust and are never logged.
5. **No background refresh.** NDS is read only when the coach clicks; «Stand NDS» is shown.
6. **Red-derived storage.** The aggregate is stored in the Dexie table `nds` (version 3), tagged
   `red-derived`. `aiGateway` refuses it. The backup export can leave the table out.
7. **The coach decides.** Values reach Lager-Angaben only via «Aus NDS übernehmen», field by field,
   with an «NDS» badge. `ndsRegistered` + `ndsRegisteredOn` come from `approvalTimestamp` and are
   labelled «bewilligt am» (registration happened on or before that date). `ndsClosed` is suggested
   only for the small known set `WAITING_FOR_ASSESSMENT`, `PAYED_CH`, `PARTIALLY_PAYED`; `ndsClosedOn`
   stays coach input.
8. **Unknown codes are handled gracefully.** Only a few state codes were observed. Others are kept
   as raw strings, shown raw, and never produce a suggestion or a rule finding.
9. **Rules** that use NDS data cite «Quelle: NDS, Stand <Datum>» and carry the red-derived tag. The new
   comparison rules (CMP-NDS-01..03) are never `must`.

## Consequences

- Rules can compare eCamp, MiData and NDS and say where a number came from.
- **Terms-of-use risk.** This is an unofficial use of an undocumented interface. The service may change
  or block it without notice, and its terms of use may not allow automated access. Mitigations: the
  coach's own login, read-only, only on explicit click, low volume, no scraping of other people's
  data. The coach is told this in the settings section. If BASPO objects, the feature is removed.
- **AHV numbers.** Using AHV numbers outside the permitted purposes is restricted (AHVG Art. 153c ff.).
  co-co never receives or stores them: they are dropped in Rust during reduction.
- The spec is reverse-engineered: field names may be wrong or change. `nds_probe` reports status codes
  and field names present/missing (never values) so a drift is diagnosable.
- Sessions expire; the coach logs in again via AGOV.

## Alternatives considered

- **Official partner API.** Exists only for Kaderbildung partners, not for camp registration data.
  Not available to coaches or a community tool.
- **Send raw data to the UI and reduce there.** Rejected: personal data would sit in the webview and
  possibly in IndexedDB.
- **Background sync.** Rejected: more exposure, no coach control.
- **Reuse the eCamp or MiData client.** Rejected: different host and cookies; red data must not share a
  client with other zones.
- **Do nothing / manual input only.** Remains the fallback: every NDS-derived field is also a coach input.

## Addendum 2026-11-09: NDS-Pendenzen in the Fristen radar

The coach's own NDS tasks («Pendenzen», GraphQL `PersonTaskList`, command `nds_fetch_tasks`) can be loaded on explicit request in the Fristen view and appear there as deadlines of kind `nds-task`, so they are included in the existing ICS export. Red-zone handling is unchanged: the query requests only `businessId`, title, correlation title, `processingStatus`, `dueDate` and `escalationDate` (no assignee names, no team); the result lives in component memory only (no IndexedDB, no localStorage, not in the backup), is never exposed to MCP or AI, and is dropped when the NDS connection ends. The ICS file the coach saves is the only copy that leaves the app, by their explicit action. The schema documents no open-tasks filter, so finished tasks are recognised client-side via `processingStatus`.
