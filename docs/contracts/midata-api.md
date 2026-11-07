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
- **Session reuse**: after an eCamp login via MiData OAuth, the `_session_id` cookie of the MiData
  origin is read from the same login webview and adopted (only when nothing, or a session for the
  same base URL, is connected). The signed-in person id is detected from `/people/<id>` URLs.
