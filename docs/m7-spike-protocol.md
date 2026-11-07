# M7-0 spike: MiData access, test protocol

Status: **noch nicht durchgeführt** (tooling built, needs a real MiData account).

Goal: answer the open questions of [ADR 0006](adr/0006-midata-red-zone.md) with evidence.

## Preparation

| Item | Notes |
| --- | --- |
| MiData account | Coach (event advisor) of a real or test camp. Ideally a second one with a plain leader role. |
| Event | The camp's event id (URL `/groups/<groupId>/events/<eventId>`) and its group id. |
| Token | Optional: a personal API token with read rights, created in MiData. |
| Privacy | The probe prints status codes and field names only. Do not paste participant data into the results. |

## A. In the app (Einstellungen → MiData → Diagnose)

1. Run `npm run tauri dev -w apps/desktop`.
2. Settings → MiData: enter the base URL (`https://db.scout.ch`).
3. Connect once with **Anmelden** (login window) and once with a **service token** (log out in between).
4. Enter event id and group id, press **Diagnose**. Record the result for each auth method.

## B. Ignored live test

```sh
export PATH="$HOME/.cargo/bin:$PATH"
cd apps/desktop/src-tauri
MIDATA_E2E_URL=https://db.scout.ch MIDATA_E2E_TOKEN=... MIDATA_E2E_EVENT_ID=123 \
  MIDATA_E2E_GROUP_ID=45 \
  cargo test -p co-co midata_live -- --ignored --nocapture
```

`MIDATA_E2E_GROUP_ID` is optional (without it the classic export is skipped). Output: status
codes, field names and counts, never values.

## What to record

- Session lifetime: how long does `_session_id` stay valid (idle and absolute)? When does a 401 appear?
- Can the **coach role** read `/api/event_participations` of the camp it coaches? Which status?
- Are **birthdays** readable on `/api/people` (needed for the J+S age)? If not, age numbers stay manual.
- Do **qualifications** (`/api/qualifications`, `qualification_kinds`) work, with start/finish dates?
- Does the **classic export** `/groups/{g}/events/{e}.json` contain PBS fields: coach, expected participants per Stufe, Lagermeldung (`camp_submitted`), J+S safety flags, canton? Which attribute names?
- **Filter syntax:** do `filter[event_id]`, `filter[type][eq]=Event::Camp`, date filters and `include=` work as assumed? Correct them in the Rust module (one place).
- Token vs. session: which one can a normal coach use?

## Results

| Date | Tester / role | Auth method | Event status | Participations readable | Birthdays readable | Qualifications status | Classic export status | PBS fields found | Session lifetime | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| – | – | – | – | – | – | – | – | – | – | noch nicht durchgeführt |

## Decision after the spike

Fill in: preferred auth method, which PBS fields stay manual, corrected filter syntax. Update ADR 0006
and `docs/contracts/commands.md` if anything changes.
