# ADR 0006: MiData connection (read-only, red zone)

- Status: accepted (auth method to be confirmed by spike M7-0, see `docs/m7-spike-protocol.md`)
- Date: 2026-11-07

## Context

MiData (db.scout.ch, PBS's hitobito) knows who really takes part in a camp: participants with
birthdays, leaders with qualifications, the event advisor (coach). Several J+S rules need exactly
this (≥ 12 participants aged 5–20, leader/participant ratio, qualifications). Until now the coach
typed these values by hand. The data is red under [ADR 0005](0005-data-zones-and-ai.md): personal data
of minors and protected qualifications. There is no backend ([ADR 0004](0004-no-backend-local-storage.md)),
so co-co has to talk to MiData directly from the desktop, and the webview has no network access.

## Decision

1. **Own Rust module `midata`** with its own HTTP client, cookie jar and keychain entry, separate from
   eCamp. Network only through Rust.
2. **Two ways to authenticate**, both read-only: a session login in a separate login window
   (`midata-login`, no capability; Rust reads the `_session_id` cookie like in ADR 0003), or a
   personal service token sent as `X-TOKEN`, stored in the OS keychain. Which one works for a coach
   role is decided by spike M7-0.
3. **Aggregates only.** Raw JSON:API responses are parsed and reduced in `coco-core::midata`. Only a
   `MidataAggregate` crosses to the UI: counts, J+S-age count, min/max age, age bands, leaders as
   nickname with qualification yes/no, coach match, «Stand MiData». Birthdays and full names never
   leave Rust.
4. **No background refresh.** MiData is read only when the coach clicks; the timestamp is shown.
5. **Red-derived storage.** The aggregate is stored in the Dexie table `midata`, tagged
   `red-derived`. `aiGateway` refuses it. The backup export can leave the table out.
6. **The coach decides.** Values reach Lager-Angaben only via «Aus MiData übernehmen», field by
   field, with a «MiData» badge on accepted fields.

## Consequences

- Rules can use real numbers and say «Quelle: MiData, Stand <Datum>»; stale data is visible.
- The aggregate still describes minors in aggregate form, so it stays out of AI and, optionally, out
  of backups. A restored backup without it needs one manual refresh.
- Session cookies expire; the coach logs in again. A token avoids that but is a long-lived secret in
  the keychain.
- The JSON:API filter syntax and the readable fields for a coach role are unverified until M7-0. The
  filter syntax is kept in one place in Rust so a fix is local.
- PBS camp fields (coach, expected participants per Stufe, Lagermeldung, safety flags, canton) are
  not in JSON:API v1. They stay coach input unless the classic export exposes them.

## Alternatives considered

- **Official OAuth application** (hitobito OAuth). Cleanest for users, but needs an application
  registered at PBS with PBS approval. Not available for a community tool now; revisit if PBS offers it.
- **Send raw data to the UI and reduce there.** Rejected: birthdays and names would sit in the
  webview and possibly in IndexedDB.
- **Background sync.** Rejected: more data exposure and no coach control.
- **Fetch on every view, keep nothing.** Rejected: slow, needs a login each time and makes rules
  non-deterministic.
- **Reuse the eCamp session.** Rejected: different host and cookies, and red data must not share a
  client with the green one.
