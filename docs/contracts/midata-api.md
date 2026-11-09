# MiData (hitobito) API facts used by co-co

Source: the official OpenAPI spec `https://db.scout.ch/api/openapi.json`, checked 07.11.2026. Format is
JSON:API (`Accept: application/vnd.api+json`), Graphiti style. **Include and filter names are validated:
unknown ones return HTTP 400.** Query builders live in `apps/desktop/src-tauri/src/midata.rs`; the test
`queries_match_openapi` holds the allow-list below, so a guessed name fails the build.

| Endpoint | Filters | `include` (only these) | Notes |
| --- | --- | --- | --- |
| `GET /api/events` | `filter[type][eq]`, `filter[group_id][eq]`, `filter[after_or_on][eq]` (single date), `filter[before_or_on][eq]` (single date), `filter[advisor_id][eq]`, `filter[kind_id][eq]`, `filter[id][eq]` | `contact`, `contact_details`, `kind`, `dates`, `participations`, `advisor` | Resource type `events`. Attributes: `group_ids`, `type`, `kind_id`, `name`, `description`, `motto`, `location`, `maximum_participants`, `participations_visible`, `advisor_id`, ... `groups` is **not** an include (HTTP 400); organisations come from `group_ids` + `/api/groups`. Included dates have type `dates` (attrs `event_id`, `label`, `location`, `start_at`, `finish_at`). |
| `GET /api/groups` | `filter[id][eq]` (array, comma-separated), `fields[groups]` | none | Resource type `groups`. Attributes `name`, `short_name`, `display_name`, `layer_group_id`, `type`. co-co asks for `fields[groups]=name,display_name`, ids chunked by 50, prefers `display_name`. |
| `GET /api/event_participations` | `filter[event_id][eq]` | `event`, `participant`, `roles` (**not** `person`) | Relationship to the person is `participant` (polymorphic: included type `people` or `event_guests`). Attributes include `participant_id`, `participant_type`, `active`. `fields[people]` allows `first_name`, `nickname`, `birthday`, ... Roles: type `event_roles`, attrs `type`, `label`. |
| `GET /api/qualifications` | `filter[person_id][eq]` (comma list) | `person`, `qualification_kind` | Attributes `start_at`, `finish_at`, `qualified_at`, `person_id`, `qualification_kind_id`; relationship `person`. Included kinds: type `qualification_kinds` (attrs `label`, `validity`, ...). |
| `GET /api/events/{id}` | n/a | `dates` (same list as the collection) | Used with `include=dates`. |

## Final co-co queries

```
/api/events?filter[type][eq]=Event::Camp&filter[after_or_on][eq]={from}&filter[before_or_on][eq]={to}&include=dates&page[size]=100
/api/groups?filter[id][eq]=1,2,3&fields[groups]=name,display_name&page[size]=100
/api/events/{id}?include=dates
/api/event_participations?filter[event_id][eq]={id}&include=participant,roles&fields[people]=nickname,first_name,birthday&page[size]=100
/api/qualifications?filter[person_id][eq]=1,2,...&include=qualification_kind&page[size]=100
```

## Behaviour rules

- Event search retries on HTTP 400 without the date filters, then without the type filter. The
  semantics of `after_or_on` / `before_or_on` are unverified, so the client-side overlap filter and
  ranking stay the source of truth.
- If the groups request fails (any non-2xx), events are returned without organisation names.
- Participations with `attributes.active == false` are ignored. `event_guests` count as participants
  without birthday, never as leaders, and their ids never go into the qualifications query.
- HTTP 400 errors name the path and the parameter names (never values), e.g.
  `MiData antwortete mit HTTP 400 (/api/events: filter[type][eq], include)`.
- **Coach**: PBS camps store the coach as a participation whose role type is
  `Event::Camp::Role::Coach` (hitobito_pbs restricted role; similar: `AdvisorMountainSecurity`,
  `AdvisorSnowSecurity`, `AdvisorWaterSecurity`). Coach/Advisor roles are neither leaders nor
  participants. `coachMatch` compares the coach participant's person id with the configured coach
  person id; without a coach participation it falls back to `advisor_id`. `coachNickname` is nickname,
  else first name (never last name). No extra endpoint needed (roles come with `include=roles`).
- **Qualifications**: valid over the whole camp: start (`start_at`, else `qualified_at` when
  `start_at` is null) empty or `<= campStart`, and `finish_at` empty or `>= campEnd`. A 401/403 or
  failed qualifications request does not fail the aggregate: `qualificationsReadable=false`.
- **Relationship linkage (Graphiti)**: `relationships.<rel>.data` is only rendered for relationships that
  are INCLUDED. co-co includes `qualification_kind` (and `participant`/`roles` for participations) but not
  `person`, so a qualification's person and kind are read from `relationships.*.data` first and fall back
  to `attributes.person_id` / `attributes.qualification_kind_id` (kind looked up in `included` as
  `qualification_kinds`). Participations fall back to `attributes.participant_id` + `participant_type`
  (`Person` -> people, `Event::Guest` -> guest). Ids may be numbers or strings.
- **Leader fields**: `MidataLeader.roleLabels` = all role labels of the person in the camp (also non-leader
  roles such as Küche), `roleLabel` stays the first leader label. `expiredQualifications` = keys held only via
  qualifications not valid over the whole camp. `qualificationDetails` = `{label, keys, validAtCamp,
  finishAt (YYYY-MM-DD|null)}` per held qualification, sorted by label. All `#[serde(default)]`; absent in
  aggregates cached before this change.
- **Session reuse**: after an eCamp login via MiData OAuth, the `_session_id` cookie of the MiData
  origin is read from the same login webview and adopted (only when nothing, or a session for the
  same base URL, is connected). The signed-in person id is detected from `/people/<id>` URLs.
- **Own person id (coach)**: openapi.json (downloaded 2026-11-08) has NO "current user" endpoint (paths: events, groups, people, qualifications, roles, ... only; `/oauth/profile` is not in it and needs an OAuth bearer token co-co does not use; service tokens carry no person). Detection order: (1) `/people/<id>` seen in login-window navigations (above); (2) `midata_find_self`: `GET /api/people?filter[email][eq]=<eCamp account e-mail>&fields[people]=nickname,first_name&page[size]=2` (`email` is a documented people filter and attribute in openapi). Exactly one hit = our person; 0 or >1 hits = no auto-detection, the UI shows the reason and asks for the number by hand. The e-mail comes from the eCamp profile already loaded by `useSession`. NOT verified live (no credentials in the dev environment): MiData may hide `email` filtering from non-admin roles or return no hit if the MiData e-mail differs from the eCamp one, which is why the manual override stays.

## Rules v2 aggregate additions

- `MidataQualKey` gains `sbBerg`, `sbWasser`, `sbWinter`, `waterBath`, `waterPoolUnsupervised`, `waterLake`, `waterRiver` (legacy `wasser`, `slrg`, `berg`, `winter` unchanged; v2 keys are optional in older stored aggregates). Label mapping (`qual_keys_for_label`, token-based, user `qualMapping` still overrides): «Sicherheitsbereich/SB Berg» -> `sbBerg`; «Sicherheitsbereich Wasser» -> `sbWasser`+`waterRiver`; «Sicherheitsbereich Winter» -> `sbWinter`; «Modul Wasser LS/T», «Aufsichtsperson Wasser», «Modul See» -> `waterBath`+`waterPoolUnsupervised`+`waterLake`; «Basis Pool» -> `waterBath`; «Plus Pool» -> `waterBath`+`waterPoolUnsupervised`; «Modul Fluss» -> `waterRiver`; J+S Kanu/Rudern/Segeln/Triathlon/Windsurfen -> bath+pool+lake.
- `participantsByBirthYear: { "<year>": count }` (optional, red-derived aggregate only; never names or birthdates). `participantsJsAgeCount` is computed by Jahrgang: J+S age if `campStartYear - birthYear` is in 5..=20 (not by exact birthday).
