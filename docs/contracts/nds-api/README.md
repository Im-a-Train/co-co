# NDS web API (reverse engineered, read-only)

Unofficial description of the backend behind the NDS web UI (`https://www.nds.baspo.admin.ch`), built from
redacted browser captures. This is **not** the official partner "Standard-API" (`api.baspo.admin.ch/nds/api`,
Kaderbildung only, partner contract required).

| File | Content |
|---|---|
| `openapi.yaml` | OpenAPI 3.1: REST endpoints and the GraphQL endpoints (one `oneOf` per operation) |
| `operations.graphql` | GraphQL documents used by the UI (inline literals masked) |

## Architecture

- One host, backend services by first path segment: `perorgfin`, `youthtraining`, `cadre`, `document`,
  `material`, `workflow`, `personal`, `frontend`.
- Each service has REST (`/<service>/admin/...`) and GraphQL (`POST /<service>/graphql/admin`).
- Auth: browser session. AGOV → Keycloak (`/perorgfin/oauth2/authorization/keycloak`) → `SESSION` cookie
  (plus `cookiesession1` load-balancer cookie and `LANG`). No bearer token or CSRF header on reads.
- Permissions are delivered as `_availableOptions` on entities and `…/availableOptions` endpoints.
- Lists: `chunk { size, page, sort[{name, direction}] }` → `{ content, totalElements, totalPages, number, size }`.
- Multilingual values: `{ de, fr, it }`, sometimes with `resolvedDe/Fr/It` or `resolvedLocalizedString` fallbacks.

## Limits of the spec

- Only what was observed: required/optional unknown, fields only seen as `null` have unknown type, enums contain
  observed values only.
- Read operations only (`POST /personal/tableConfig`, a UI-preference write, is left out).
- Captures so far: 2026-11-07 (offers/camps, cadre education, organisation, finance) and 2026-11-15
  (person expand, granted recognitions incl. documents, user accounts, protocol, activity timeline,
  `ParticipantAttendances`/`SupervisorAttendances`, offer detail and create-form lookups). The recognition
  create endpoints only returned 403 for the capturing account, so their success shape is unknown.
- Not yet captured: J+S courses inside an offer (only camps), person search, login flow.

## Queries used by co-co

All read-only (`ensure_query_only`), field selections reduced to what is needed, in `coco-core/src/nds.rs`:

- Offers/camps/activities/supervisors/participants/rental orders for the aggregate (counts only).
- `RegaParticipantsListForCamp` / `RegaSupervisorsListForCamp` (`regaParticipantsListForCamp`,
  `regaSupervisorsListForCamp`, service `youthtraining`): `content { businessId person { businessId personNumber firstName
  lastName birthDate } transmittedToRega }`. `privateAddress` of the captured operation is deliberately NOT requested.
  Aggregate path: only the counts `NdsAggregate.rega` leave Rust; a failing/forbidden list gives `rega: null` and never
  fails the aggregate. Persons path: `transmittedToRega` is attached to each NDS person row as `regaTransmitted` (match by
  person `businessId`, then `personNumber`); an unreadable list leaves it `null`. The probe checks both operations.

## Privacy

Raw `.har` files never enter the repo or the assistant's context. `tools/nds/har-redact.mjs` reduces them to
structure: values are replaced by types, IDs in paths templated, cookies/tokens dropped. Only enum codes listed
with `--keep` survive, and only if they look like codes: numeric strings, UUIDs, e-mails, URLs, dates and AHV
numbers are dropped even for kept fields (`selected` holds an enum code in some filters and a person ID in
others). `redacted-to-openapi.mjs` applies the same filter again. `captures/` and `*.har` are git-ignored.

Before committing, scan the generated files, e.g.
`grep -nEi '@[a-z0-9-]+\.[a-z]{2,}|756\.?[0-9]{4}|[0-9]{6,}' docs/contracts/nds-api/*` must be empty.

## Regenerate

Raw HARs are deleted after redaction, so captures are combined at the redacted level:

```sh
# 1. redact a new capture; reuse the field list of the previous run (keptValuesFor in its JSON)
node tools/nds/har-redact.mjs <capture.har> [more.har ...] --out=captures/redacted --keep=<enum fields>
# 2. merge with earlier redacted captures (endpoints, schemas and enums are unioned)
node tools/nds/merge-redacted.mjs captures/redacted/endpoints-<old>.json captures/redacted/endpoints-<new>.json \
  --out=captures/redacted/endpoints-merged-<date>.json
# 3. generate spec + GraphQL documents
node tools/nds/redacted-to-openapi.mjs captures/redacted/endpoints-merged-<date>.json --out=docs/contracts/nds-api
npx @redocly/cli@1.25.11 lint docs/contracts/nds-api/openapi.yaml   # 12 trailing-slash findings are real backend paths
```

The merged file is the input for the next merge; keep it in `captures/redacted/`.

## Caveats

Using this API outside the official UI may violate the NDS terms of use. Get BASPO's approval before
integrating. `ahvn13` (AHV number) is returned by several endpoints; systematic use is restricted
(AHVG Art. 153c ff.), so don't store it.
