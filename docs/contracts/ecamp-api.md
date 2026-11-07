# eCamp API facts used by co-co

Verified on dev.ecamp3.ch with the test account. A sample dump is in
`apps/desktop/src/__tests__/fixtures/dev-camp/*.json`; `createDevCampApi()` in `devCampApi.ts` is a fake
`ApiGet` over it.

- Format: HAL+JSON (`Accept: application/hal+json`).
  - Collections look like `{ _embedded: { items: [...] }, totalItems, _links }`.
  - Entity IRIs are in `_links.self.href`.
  - Links can be RFC 6570 templates; use `stripTemplate`.
- Several collections **require** a filter (HTTP 400 otherwise):

| Endpoint | Filter | Notes |
| --- | --- | --- |
| `/api/camps` | `campCollaborator=<userIri>` | title, shortTitle, motto, kind, organizer, coachName, courseKind, courseNumber, trainingAdvisorName, address*, isPrototype; embeds periods → days |
| `/api/periods` | `camp=<campIri>` | start, end (dates), description |
| `/api/days` | `period.camp=<campIri>` | number, dayOffset, start, end; embeds dayResponsibles |
| `/api/day_responsibles` | `day.period=<periodIri>` (or `day=`) | links day, campCollaboration |
| `/api/schedule_entries` | `period=<periodIri>` (or `activity=`) | start, end, dayNumber, number, scheduleEntryNumber, left, width, ysPhysicalActivityDurationMinutes; links activity, day, period |
| `/api/activities` | `camp=<campIri>` | title, location; links category, progressLabel, rootContentNode; embeds activityResponsibles, progressLabel, scheduleEntries |
| `/api/activity_responsibles` | `activity.camp=<campIri>` | links activity, campCollaboration |
| `/api/camp_collaborations` | `camp=<campIri>` | role guest/member/manager, status, inviteEmail, abbreviation; links user (→ profile: nickname, firstname, surname) |
| `/api/categories` | `camp=<campIri>` | short, name, color, numberingStyle |
| `/api/activity_progress_labels` | `camp=<campIri>` | title, position |
| `/api/content_nodes` | `camp=<campIri>` | ALL nodes of the camp: contentTypeName, data, instanceName, position, slot; links root, parent, children |
| `/api/comments` | `camp=<campIri>` | textHtml, activity, parent, author, resolvedAt (newer instances), createTime |

Mapping content to activities: a node belongs to the activity whose `rootContentNode` IRI equals the
node's `_links.root.href`.

Content data shapes:

- Storyboard: `data.sections = { <id>: { column1, column2Html, column3, position } }`
- SafetyConsiderations / Notes: `data.html`
- Multiselects (LAThematicArea, LearningTopics, YSActivityCharacteristics): `data.options = { key: { checked } }`
- YSPhysicalActivityDuration: duration data

**Time semantics:** camp times are serialised with `+00:00` but mean camp-local wall-clock time. Use UTC
getters or string slicing.

Write access is limited to `POST /api/comments` and `PATCH /api/comments/{id}`, through Rust commands
(see commands.md).
