# Tauri command contract

Status: **current contract**. Commands are implemented in `apps/desktop/src-tauri`; change this file together with the code.
The frontend uses the typed wrappers in `apps/desktop/src/lib/tauri.ts` (`commands.*`, `onDocsChanged`,
`onDocsDropped`). The one exception is `ai_complete`, which is wrapped in `apps/desktop/src/lib/tauriAi.ts`
and may only be imported by `src/domain/zones/aiGateway.ts`. A vitest guard enforces this.

General rules

- Arguments: JS passes camelCase keys. Tauri maps them to snake_case Rust parameters
  (`campIri` → `camp_iri`). Return structs use `#[serde(rename_all = "camelCase")]`.
- Errors: reject with a German, user-readable message string, as the M0 `AppError` does.
  Never put cookie or token values, API keys or file contents in errors or logs.
- Every new command needs:
  - an entry in `build.rs` `COMMANDS`;
  - an `allow-<name>` grant in `capabilities/default.json` (window `main` only).

  The remote `ecamp-login` window keeps **no** IPC access.
- All eCamp HTTP goes through the existing reqwest client and cookie jar. The base URL is the session
  instance's. Paths are validated the same way as `api_get` (relative `/api/...`, no host, no `..`).

## M0 (unchanged)

`discover_instance`, `open_login_window`, `password_login`, `session_status`, `refresh_session`,
`api_get`, `logout`. See `docs/m0-spike-protocol.md`.

## M2: eCamp comments (the only write access)

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `api_post_comment` | `campIri: string`, `activityIri: string`, `textHtml: string` | created comment (HAL JSON object) | `POST /api/comments` only. Body `{ camp, activity, textHtml }`, `Content-Type: application/json`, `Accept: application/hal+json`. Rejects when `textHtml` > 1024 chars or empty, or when it contains HTML other than `<br>` (text must be escaped by the caller). Both IRIs must match `^/api/(camps\|activities)/[A-Za-z0-9]+$`. |
| `open_ecamp_url` | `url: string` | `null` | Opens an eCamp web-UI URL in the system browser (tauri-plugin-opener, called from Rust only; the frontend has no opener permission). Requires a session. URL must be absolute https (http only for a loopback instance), same origin as the session instance, no userinfo, path starting with `/camps/`, no `.`/`..` segments, no control characters or backslashes, length <= 2048. |
| `api_patch_comment` | `commentIri: string`, `patch: object` | updated comment (HAL JSON) | `PATCH /api/comments/{id}` only, `Content-Type: application/merge-patch+json`. `commentIri` must match `^/api/comments/[A-Za-z0-9]+$`. The upstream `Comment.php` has **no** Patch operation, but newer instances do (dev has `resolvedAt`/`resolvedBy`). So an HTTP 405/404 rejects with a clear message ("Kommentar kann auf dieser eCamp-Version nicht geändert werden"), and the frontend treats it as unsupported. Only the key `resolved` is forwarded; any other key is rejected. |

## M3: files and documents

Allowed-path scope: a set of absolute, canonicalised paths persisted as JSON in the app data dir
(`app_data_dir()/allowed-paths.json`), loaded at start-up. Entries:

- files returned by `pick_files`;
- files received via drag-and-drop;
- folders returned by `pick_folder`, or passed to `watch_folder`, together with everything below them.

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `pick_files` | `filters: { name: string, extensions: string[] }[] \| null` | `string[]` (absolute paths, empty when cancelled) | Native open dialog, multi-select. Adds the files to the scope. |
| `pick_folder` | – | `string \| null` | Native folder dialog. Adds the folder to the scope. |
| `read_document` | `path: string` | `{ path, name, size, modifiedMs, bytesBase64 }` | Only for allowed paths (canonicalise first, so symlinks or `..` cannot escape). Max **25 MB**, else rejects. `modifiedMs` is ms since epoch. |
| `list_folder` | `path: string` | `{ path, name, isDir, size, modifiedMs }[]` | Allowed folders only, non-recursive. Hidden files are skipped. |
| `watch_folder` | `path: string` | `void` | Allowed folder. Adds it to the scope and persists it, recursive watch (`notify` crate, debounced ≈ 500 ms). Emits `docs://changed`. |
| `unwatch_folder` | `path: string` | `void` | Stops the watch. The folder stays readable for the session but is not persisted. |

Events

- `docs://changed` payload `{ folder: string, path: string, kind: 'create' | 'modify' | 'remove' }`
- `docs://dropped` payload `{ paths: string[] }`. Rust listens to the main window's native drag-drop
  (`WindowEvent::DragDrop(Drop)`), adds the dropped files to the scope and then emits. Folders dropped
  are added as allowed folders, and their path is included.

The frontend re-watches persisted folders from IndexedDB (`watchedFolders`) at start-up by calling
`watch_folder` again. Rust may also restore watches itself; calling it twice must be idempotent.

## M4: backup files

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `save_text_file` | `defaultName: string`, `content: string` | `string \| null` | Native save dialog; the filter follows the extension of `defaultName` (`.json` JSON, `.ics` Kalender (ICS), `.md` Markdown, `.txt` Text; any other extension is an error). The chosen path gets that extension if missing. Writes UTF-8 and returns the path. `null` when cancelled. |
| `open_text_file` | – | `{ name, content } \| null` | Native open dialog, filter `JSON (*.json)`, max 100 MB. `null` when cancelled. Does **not** add the file to the document scope. |

## M5: AI (optional, off by default)

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `ai_set_key` | `key: string` | `void` | Stores the Anthropic API key in the OS keychain (`keyring` crate, service `ch.imatrain.coco`, user `anthropic-api-key`). Never logged or returned. |
| `ai_has_key` | – | `boolean` | |
| `ai_clear_key` | – | `void` | Idempotent. |
| `ai_complete` | `request: { provider?: 'anthropic' \| 'openai', baseUrl?: string, model, system, prompt, maxTokens }` | `{ text, inputTokens, outputTokens }` | `provider` missing = `anthropic`: `POST https://api.anthropic.com/v1/messages` with headers `x-api-key` (from the keychain), `anthropic-version: 2023-06-01`, body `{ model, max_tokens, system, messages:[{role:'user',content:prompt}] }`. `model` must be one of `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`. Rejects with "Kein API-Schlüssel hinterlegt" when no key is stored. **`openai` (ADR 0011):** `POST {baseUrl}/chat/completions`, body `{ model, messages:[{role:'system'},{role:'user'}], max_tokens, stream:false }` (`max_completion_tokens` instead of `max_tokens` for `api.openai.com`); `Authorization: Bearer <key>` only when a key is stored for exactly the origin of `baseUrl` (no key needed for local servers). `baseUrl` https, http only for loopback hosts, no userinfo/query/fragment. `model` free text (1–200 chars, no control chars). Reads `choices[0].message.content` (string or text parts, leading `<think>…</think>` removed) and `usage.prompt_tokens`/`completion_tokens` (missing = 0). Timeout 300 s for loopback, 120 s otherwise; no redirects; body cap 4 MB. Both: `maxTokens` 1–4096, prompt non-empty, own reqwest client **without** the eCamp cookie jar, logs only provider, model and token counts. |
| `ai_openai_set_key` | `baseUrl: string`, `key: string` | `void` | ADR 0011. Stores the optional key of the OpenAI-compatible provider **bound to the origin** of `baseUrl` (keychain service `ch.imatrain.coco`, user `openai-compatible-api-key`, value `{"origin","key"}`); replaces a key bound to another origin. Key: no whitespace/control chars, ≤ 500 chars. Never logged or returned. |
| `ai_openai_has_key` | `baseUrl: string` | `boolean` | `true` only when the stored key is bound to the origin of `baseUrl`. Invalid URL → `false`. |
| `ai_openai_clear_key` | – | `void` | Idempotent. |
| `ai_openai_models` | `baseUrl: string` | `string[]` | `GET {baseUrl}/models` (bearer key only if bound to this origin), ids of `data[].id` (also `models[].name`), deduplicated, sorted, ≤ 500. Used for «Modelle laden» and «Verbindung testen»; sends no camp data. Timeout 15 s. Errors: «Server nicht erreichbar», «Server lehnt den API-Schlüssel ab» (401/403), «HTTP <code>: <message>». |

CSP: `connect-src` does **not** need `api.anthropic.com`, because the call happens in Rust. pdf.js
loads its worker from a same-origin asset (`script-src 'self'` covers it). If pdf.js needs WASM
decoders, add `'wasm-unsafe-eval'` to `script-src`.

## ADR 0011: local MCP server

Decision: [ADR 0011](../adr/0011-openai-compatible-and-mcp.md). Rust: `src-tauri/src/mcp.rs` (I/O) +
`coco-core::mcp` (pure checks and JSON-RPC). TS types: `src/domain/mcp/types.ts`, catalogue
`src/domain/mcp/catalog.ts`, bridge `src/composables/mcpBridge.ts`.

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `mcp_status` | – | `McpStatus { running, port, url, error, toolCount, log: McpLogEntry[] }` | `McpLogEntry { atMs, tool, kind: 'read' \| 'write' \| null, ok, durationMs, error }`, newest first, ≤ 50, in memory only, never arguments or results. |
| `mcp_start` | `port: number` | `McpStatus` | Binds `127.0.0.1:<port>` only (1024–65535). Same port while running = no-op; other port = restart. Creates the token if none exists. Port in use → rejects with «Port <n> ist bereits belegt» (also in `McpStatus.error`). Emits `mcp://status`. |
| `mcp_stop` | – | `McpStatus` | Idempotent. Pending tool calls get an error outcome. Emits `mcp://status`. |
| `mcp_set_tools` | `tools: McpToolRegistration[]` (`{ name, title, description, kind: 'read' \| 'write', inputSchema }`) | `void` | The **enabled** tools only; replaces the list. Validated: names `^[a-z][a-z0-9_]{0,63}$`, unique, ≤ 64, `inputSchema.type == 'object'`. Unregistered tools are not listed and `tools/call` answers «Unknown tool». |
| `mcp_tool_result` | `callId: string`, `outcome: { text: string, isError: boolean }` | `void` | Answer to `mcp://tool-call`. Unknown or late `callId` → ignored (Ok). `text` longer than 512 K chars → replaced by an error outcome. |
| `mcp_get_token` | – | `string` | Bearer token (`coco_` + 43 base64url chars), keychain service `ch.imatrain.coco`, user `mcp-token`; created when missing. **ADR 0011 exception:** returned to the UI because the coach pastes it into the MCP client config. Never logged. |
| `mcp_regenerate_token` | – | `string` | New random token (32 bytes, `getrandom`), replaces the stored one; a running server uses it immediately. |

Events (main window only):

- `mcp://tool-call` payload `{ callId, name, kind, arguments, deadlineMs }`. The frontend answers exactly
  once with `mcp_tool_result`. Rust waits 55 s (read and write, including the confirmation; below the
  60 s default request timeout of MCP TypeScript SDK clients) and answers the client with
  `isError: true` «Zeitüberschreitung» otherwise. `deadlineMs` (epoch ms) is when that happens; the
  bridge gives up 5 s earlier. At most 4 calls in flight. For write tools Rust calls `unminimize()` +
  `set_focus()` on the main window.
- `mcp://tool-cancel` payload `{ callId }`: the call was answered without the frontend (client sent
  `notifications/cancelled`, timeout, `mcp_stop`). The frontend closes its confirmation dialog and never
  starts the handler.
- `mcp://status` payload `McpStatus` after start/stop/failure and after every finished call.

HTTP (`POST http://127.0.0.1:<port>/mcp`, JSON-RPC 2.0, `Content-Type: application/json` answers, no SSE):
`Host` must be loopback, an `Origin` header must be a loopback origin (403 otherwise), `Authorization:
Bearer <token>` (401 + `WWW-Authenticate: Bearer`), body ≤ 1 MB (413), `GET`/`DELETE`/`OPTIONS` → 405,
other paths → 404, unsupported `MCP-Protocol-Version` header → 400. Methods: `initialize` (versions
`2025-06-18`, `2025-03-26`, `2024-11-05`; unknown → `2025-06-18`), `ping`, `tools/list`, `tools/call`;
notifications and client responses → 202; `notifications/cancelled` `{ requestId }` cancels the waiting
call with that id (only when exactly one matches, the server has no sessions). Batches (2025-03-26 /
2024-11-05) are handled element by element: array of replies, or 202 when no element needs one; ≤ 32
elements. Input the server cannot accept (parse error, invalid request, `id: null`, empty batch) → HTTP
400 with a JSON-RPC error body. `tools.listChanged` is `false`: a newly enabled tool shows up in a
connected client only after it reconnects. No CORS headers, no sessions.

## M7: MiData (read-only, red zone)

Own module `src-tauri/src/midata.rs` with its own reqwest client and cookie jar (never shared with
eCamp). Raw responses are reduced in `coco_core::midata`; only aggregates, event summaries, probe
results (names and status codes) and connection status cross to the UI. Birthdays and full names never
leave Rust. Cookie values and the token are never logged, returned or put into error messages. All
commands accept calls from the `main` window only. Nothing runs in the background: every network
call is the result of an explicit user action.

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `midata_status` | – | `MidataStatus { connected, baseUrl, method: 'session' \| 'token' \| null, cookieNames, personId: string \| null }` | Lazily restores a stored service token from the keychain (service `co-co-midata`). Cookie names only, never values. `personId` = MiData person id detected from `/people/<id>` URLs after sign-in (null if unknown). |
| `midata_open_login` | `baseUrl: string` | `void` | Opens the separate login window `midata-login` (no capability, no IPC) on `<base>/users/sign_in`. Rust polls the jar for the `_session_id` cookie, stores it in the MiData jar, closes the window and emits `midata://status`. `baseUrl` must be https (http only for loopback hosts). |
| `midata_set_token` | `baseUrl: string`, `token: string` | `MidataStatus` | Stores the service token in the OS keychain and uses it as header `X-TOKEN`. Token length is capped, the token is never returned. |
| `midata_logout` | – | `void` | Clears the jar, the in-memory connection and the keychain token. Idempotent. Emits `midata://status`. |
| `midata_find_events` | `from: string`, `to: string` (YYYY-MM-DD search window, UI: camp ±14 days), `campStart?: string`, `campEnd?: string` (eCamp camp period) | `MidataEventSummary[]` (`id, name, startAt, finishAt, location, groupNames, overlapDays`) | `GET /api/events` with `filter[type][eq]=Event::Camp` + `filter[after_or_on][eq]`/`filter[before_or_on][eq]`, `include=dates` (plus one best-effort `/api/groups?filter[id][eq]=..` request for organisation names), all organisations visible to the account, paged (relative `links.next` resolved against the current page, same origin only). On HTTP 400 retried without date filters, then without type filter (HTTP 400 messages name path and parameter names). Always filtered/ranked client-side: events not overlapping `[from, to]` dropped, undated last; sorted by overlap with the camp period, then nearest start. Used for the one-time event pick per camp. |
| `midata_fetch_aggregate` | `eventId: string`, `campStart: string`, `campEnd: string`, `coachPersonId: string \| null`, `qualMapping: Record<string, QualKey[]> \| null` (qualification-kind label -> co-co keys; label trimmed/case-insensitive; an entry REPLACES the built-in keyword mapping, `[]` ignores the label) | `MidataAggregate` (zone `red-derived`) | Fetches event (+dates), participations (+person, roles), leader qualifications; reduces in Rust. Returns counts, J+S-age count (5–20 at camp start), min/max age, age bands, leaders as nickname + qualification yes/no, coach match, `coachNickname` (coach participation, role `Event::Camp::Role::Coach`; nickname else first name), `qualificationsReadable` (false when the qualifications request returned 401/403 or failed: all qualification cells are then false = unknown, the aggregate is still returned), `qualificationKinds: { label, keys: QualKey[], validLeaders, expiredLeaders }[]` (every kind label among the leaders' qualifications; valid over the whole camp vs. only expired/not yet valid), `fetchedAt`. Rejects with a German message when not connected or on HTTP errors (401 → «Anmeldung abgelaufen»). |
| `midata_probe` | `eventId: string`, `groupId: string \| null` | `MidataProbe` | M7-0 spike. Returns auth method, HTTP status codes (event, participations, qualifications, classic export), whether participations and birthdays were readable, and **field names only** of the classic export `/groups/{g}/events/{e}.json` plus the PBS camp fields found. Never values. See `docs/m7-spike-protocol.md`. |
| `midata_find_self` | `email: string` | `{ personId: string \| null, nickname: string \| null, count: number }` | Finds the coach's MiData person via `GET /api/people?filter[email][eq]=<email>`. `personId`/`nickname` only when exactly one person matched (`count` 0 = none, >1 = ambiguous). The e-mail is the eCamp account's own address (from the eCamp profile). See midata-api.md. |

Event: `midata://status` payload `MidataStatus`, emitted to `main` after login, token change, logout and
when the eCamp login window adopts a MiData `_session_id` session (no second login; only if nothing or a
session for the same base URL is connected). The frontend also reads `midata_status` at start-up.

Query names are verified against the OpenAPI spec, see `docs/contracts/midata-api.md` (date-filter
semantics stay unverified; the client-side filter is authoritative). They live in one place in the Rust module.

## M8: NDS (read-only, red zone, unofficial web API)

Own module `src-tauri/src/nds.rs` with its own reqwest client and cookie jar (never shared with eCamp
or MiData). The API is reverse-engineered, see `docs/contracts/nds-api/` and
[ADR 0007](../adr/0007-nds-red-zone.md). Only `GET` and GraphQL queries are sent (documents starting
with `mutation` are rejected in code). Requests send `Accept: application/json` and header
`default-language: de`; GraphQL goes to `POST /<service>/graphql/admin` with
`{operationName, variables, query}` and list `chunk {size, page, sort: []}`; errors arrive in
`errors` with HTTP 200. Raw responses are reduced in `coco_core::nds`; only aggregates, camp summaries,
probe results (field names and status codes) and connection status cross to the UI. Names, birth
dates, AHV numbers, addresses, e-mails and IBANs never leave Rust and are never logged. Cookie values
are never logged, returned or put into error messages. All commands accept calls from the `main`
window only. Nothing runs in the background. Unknown state codes are kept as raw strings.

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `nds_status` | – | `NdsStatus { connected, cookieNames }` | Lazily restores the stored session from the keychain (service `co-co-nds`). Cookie names only, never values. |
| `nds_open_login` | – | `void` | Opens the separate login window `nds-login` (no capability, no IPC) on `https://www.nds.baspo.admin.ch/perorgfin/oauth2/authorization/keycloak` (AGOV -> Keycloak). Rust polls the jar for the `SESSION` cookie, stores the session in the NDS jar and the keychain, closes the window and emits `nds://status`. |
| `nds_logout` | – | `void` | Clears the jar, the in-memory connection and the keychain entry. Idempotent. Emits `nds://status`. |
| `nds_find_camps` | `from: string`, `to: string` (YYYY-MM-DD) | `NdsCampSummary[]` (`offerBusinessId, campBusinessId, offerNumber, offerItemNumber, groupName, start, end, offerState, offerItemState`) | youthtraining `OfferList` (all pages), offers overlapping the dates, then `CampList($offerBusinessId)` per offer, camps overlapping the dates. Used for the one-time camp pick per camp. |
| `nds_fetch_aggregate` | `offerBusinessId: string`, `campBusinessId: string` | `NdsAggregate` | Fetches `/youthtraining/offer/offer/{offerId}/details`, `/offer/camp/{campId}/details` and `/statistics`, `ActivityListForCamp`, `SupervisorsListForCamp`, `ParticipantsListForCamp` and `rentalMaterialOrderListForCamp`; reduces in Rust. Returns state codes, `approvedOn` (date of `approvalTimestamp` or null), planned/actual counts, supervisor counts by `involvementType`, participant count (and by `targetAudienceGroup`), activities `{total, byState, byType, lastActivityDate, attendanceOpenCount}` (attendanceOpenCount counts only the inferred code `ATTENDANCE_OPEN`), `campAgendaUploaded`, rental orders `{orderState, dispatchmentDate, returnDate}`, `fetchedAt`. Rejects with a German message when not connected or on HTTP errors (401/403 -> «Anmeldung abgelaufen»). |
| `nds_probe` | `campBusinessId: string` | `NdsProbe { connected, endpoints: [{name, status, fieldsPresent, fieldsMissing}] }` | Diagnosis. HTTP status per endpoint used and which expected fields were present. **Field names only**, never values. |
| `persons_load_midata` | `eventId: string`, `campStart: IsoDate`, `campEnd: IsoDate` | `MidataPersonsResult` (`domain/persons/types.ts`, red brand `__red: true`) | «Personen» tab (ADR 0009, P1). `GET /api/event_participations?filter[event_id][eq]=<id>&include=participant,roles&fields[people]=first_name,last_name,nickname,birthday,gender&page[size]=100` plus `/api/qualifications` for the leaders; returns one row per person (kind leader/participant/coach/guest/kitchen/other, role labels, qualification state per key valid/invalid/none). No AHV, address, e-mail, phone or health data. The last result is kept in Rust memory only (no disk, no logs). Errors contain status/path/parameter names only. |
| `persons_load_nds` | `ndsCampId: string` | `NdsPersonsResult` (red brand) | Same for NDS: read-only `ParticipantsListForCamp` / `SupervisorsListForCamp` with `person { businessId personNumber firstName lastName birthDate }` and `targetAudienceGroup` / `involvementType`. `privateAddress` and AHV are not requested. Memory only. 401/403 -> «Anmeldung abgelaufen». |
| `persons_clear` | none | `void` | Wipes the in-memory person lists (call on lock, logout, leaving the tab). |

Event: `nds://status` payload `NdsStatus`, emitted to `main` after login and logout. The frontend also
reads `nds_status` at start-up.
