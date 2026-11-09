# ADR 0012: OpenAI-compatible AI providers (incl. local LLMs) and a local MCP server

- Status: accepted
- Date: 2026-11-08
- Builds on: [ADR 0005](0005-data-zones-and-ai.md) (data zones), [ADR 0006](0006-midata-red-zone.md),
  [ADR 0007](0007-nds-red-zone.md) (red zone)

## Context

M5 added optional AI help (rephrase, document summary, soft safety review) with exactly one provider:
the Anthropic Messages API, three whitelisted Claude models, key in the OS keychain, every call through
`src/domain/zones/aiGateway.ts`.

Coaches asked for two more things (Settings → KI):

1. **Other providers, especially local ones.** Many coaches prefer a model that runs on their own
   machine (Ollama, LM Studio, llama.cpp server, vLLM, Jan, …) so camp content never leaves the device,
   or they already pay for another provider. Practically all of them speak the **OpenAI Chat
   Completions** dialect (`POST {base}/chat/completions`, `GET {base}/models`).
2. **co-co as a tool for the coach's own AI assistant.** Coaches work with Claude Desktop, Claude Code
   or other MCP clients and want those assistants to read the camp check results and help with feedback.
   The Model Context Protocol (MCP) is the standard way to expose such tools.

co-co has no backend ([ADR 0004](0004-no-backend-local-storage.md)); the data lives in IndexedDB in the
webview and the domain logic is TypeScript. Network access is only allowed from Rust.

## Decision

### A. OpenAI-compatible provider

1. `AppSettings.ai.provider: 'anthropic' | 'openai'` (default `anthropic`, existing behaviour unchanged).
   For `openai`, `AppSettings.ai.openai = { baseUrl, model, preset }` with presets Ollama
   (`http://localhost:11434/v1`), LM Studio (`http://localhost:1234/v1`), OpenAI
   (`https://api.openai.com/v1`) and «Eigene URL». The model is free text; «Modelle laden» fills a
   list from `GET {base}/models`.
2. **One completion command.** `ai_complete` gets `provider` (default `anthropic`) and `baseUrl`. The
   Anthropic path is unchanged. The OpenAI path sends `POST {base}/chat/completions` with
   `messages: [system, user]` and `max_tokens` (`max_completion_tokens` for `api.openai.com`, which
   rejects `max_tokens` on newer models), `stream: false`. It reads `choices[0].message.content`
   (string or array of text parts; a leading `<think>…</think>` block of reasoning models is dropped)
   and `usage.prompt_tokens` / `usage.completion_tokens` (missing usage counts as 0).
3. **URL rules** (pure, `coco_core::ai::normalize_openai_base_url`): `https` required, `http` only for
   loopback hosts (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`) – the same rule as eCamp
   instances. No userinfo, no query, no fragment, trailing slash removed. No redirects, response body
   cap 4 MB, connect timeout 10 s, total timeout 300 s for loopback (local models are slow on a laptop)
   and 120 s otherwise.
4. **Key optional, bound to its origin.** Local servers need no key. A key is stored in the OS keychain
   (service `ch.imatrain.coco`, user `openai-compatible-api-key`) **together with the origin** it was
   entered for (`{"origin":"https://api.openai.com","key":"…"}`). Rust only attaches
   `Authorization: Bearer` when the request's origin equals the stored origin, so changing the base
   URL can never leak an OpenAI key to another host. `ai_openai_has_key(baseUrl)` answers for that
   origin only. The Anthropic key stays in its own entry.
5. **Gateway unchanged in spirit.** `aiGateway.send()` stays the only entry point. The Claude model
   whitelist applies to the Anthropic provider only; zone rules (`assertSendable`), size caps, the
   preview dialog and the AI log apply identically to every provider. `AiLogEntry` gains `provider`,
   and `model` becomes a free string. A local model is still treated as «AI» for the zone rules: the
   coach cannot opt out of redaction for local models (keeps one rule, avoids mistakes with a base
   URL that is not actually local).
6. «Verbindung testen» = `ai_openai_models(baseUrl)` (sends no camp data).

### B. Local MCP server

1. **Rust, Streamable HTTP, JSON responses only.** `src-tauri/src/mcp.rs` runs a small HTTP server
   (`tiny_http`, own thread, no TLS, pure Rust, cross-compiles) on **`127.0.0.1` only**, default port
   **41731**, configurable 1024–65535. Endpoint `POST /mcp` with JSON-RPC 2.0, answered with
   `Content-Type: application/json` (no SSE stream; `GET /mcp` → 405, as the spec allows).
   Supported: `initialize` (version negotiation: `2025-06-18`, `2025-03-26`, `2024-11-05`; unknown
   requested version → we answer with `2025-06-18`), `notifications/initialized` (→ 202),
   `ping`, `tools/list`, `tools/call`. JSON-RPC batches are rejected (removed in 2025-06-18). No
   sessions (`Mcp-Session-Id` not issued), no resources, no prompts, no sampling.
2. **Off by default.** The server only runs while «KI-Funktionen aktivieren» **and** «MCP-Server
   aktivieren» are on. Disabling AI stops it. Settings live in `AppSettings.mcp`
   (`enabled, port, tools, confirmWrites, confirmReads`); on start-up the frontend starts the server
   when both switches are on.
3. **Authentication.** Every request needs `Authorization: Bearer <token>`. The token
   (`coco_` + 32 random bytes, base64url) is generated by co-co, stored in the OS keychain
   (service `ch.imatrain.coco`, user `mcp-token`) and compared in constant time. **Exception to
   «secrets never reach the UI»:** this token is shown in the KI tab (masked, reveal + copy +
   regenerate), because the coach has to paste it into the MCP client configuration. It is a
   co-co-local credential that only unlocks this loopback server; it is not an eCamp, MiData, NDS or
   AI-provider secret, and it is never logged or put into errors or events. Regenerating it locks out
   every configured client immediately.
4. **DNS-rebinding / browser protection.** Requests whose `Host` is not a loopback host, or that carry
   an `Origin` header that is not a loopback origin, are rejected with 403. No CORS headers are sent,
   `OPTIONS` → 405. Request body cap 1 MB (413).
5. **Tools execute in the frontend.** The data and the domain logic live in the webview. For
   `tools/call` Rust emits `mcp://tool-call` `{ callId, name, kind, arguments }` to the `main` window
   only and waits 55 s, including a confirmation (below the 60 s default request timeout of MCP
   TypeScript SDK clients such as Claude Desktop / mcp-remote). The
   frontend bridge (`composables/mcpBridge.ts` → `domain/mcp/dispatch.ts`) runs the handler and
   answers with `mcp_tool_result(callId, { text, isError })`. Timeouts, a missing window or more than
   4 calls in flight become a tool error, never a hang. For write tools Rust brings the main window
   to the front. **A write never runs after the client was told it failed:** the event carries the
   deadline, the bridge gives up 5 s before it, and when the client sends `notifications/cancelled`,
   the call times out or the server stops, Rust emits `mcp://tool-cancel`; the confirmation dialog closes
   and the handler is not started.
6. **Tool catalogue with per-tool switches.** `src/domain/mcp/catalog.ts` defines every tool (name,
   `kind: 'read' | 'write'`, English description + JSON input schema for the client, German i18n
   keys for the UI). **Read tools default on, write tools default off.** The frontend pushes the
   enabled tools to Rust (`mcp_set_tools`); disabled tools are neither listed nor callable, and the
   dispatcher checks the setting again before running a handler (defence in depth).
7. **Write tools are co-co writes plus the one existing eCamp write.** Write tools only change co-co's
   own data (feedback drafts, ignores, review status) or post a feedback item through the existing
   `api_post_comment` path (`POST /api/comments`, ≤ 1024 chars per part, no HTML except `<br>`).
   No new eCamp endpoint. Every write call needs an **in-app confirmation** (`confirmWrites`, default
   on; the dialog shows the tool and the exact change). `confirmReads` (default off) lets a cautious
   coach confirm read calls too.
8. **Data zones apply in full: an MCP client is an external AI.**
   - **Red never:** no tool reads MiData/NDS tables, aggregates or `CoachInputs.midataFields`/
     `ndsFields` values. Findings for MCP are evaluated **without** `RuleContext.midata/nds`, and
     `findingsForAi()` strips `explain` and red-tagged findings. Feedback items with `redDerived` or a
     «Quelle: MiData/NDS» marker are left out. A contract test (`mcpGuard.test.ts`) keeps
     `domain/mcp/**`, `composables/mcpBridge.ts` and `domain/zones/mcpZone.ts` free of MiData/NDS
     imports and commands.
   - **Yellow only redacted:** every eCamp or free text (activity titles, locations, programme and
     safety texts, finding messages, feedback texts) passes the camp's `buildRedactor()`
     (names → «Leiter A», e-mail/phone/AHV/address removed). Leader names are never returned. Text
     that a write tool receives is de-redacted locally before it is stored or posted.
   - **Last line of defence:** every serialized tool result passes `assertMcpSendable()` in
     `domain/zones/mcpZone.ts` (red-derived marker of the AI gateway, PII patterns, size cap
     200 000 chars). A violation turns into a tool error; nothing is sent.
   - **Consent:** ADR 0005 asks for an explicit action with a payload preview. For MCP the explicit
     actions are: switching AI on, switching the server on, enabling each tool, configuring the client
     with the token. Per-call previews are replaced by redaction, the activity log and the optional
     `confirmReads`. This deviation is accepted because the coach is the one driving the MCP client.
9. **Activity log** in Rust memory (last 50 calls: time, tool, kind, ok/error, duration, **no
   arguments, no results**), part of `McpStatus` and shown in the KI tab. Not persisted, not in the
   backup.

### C. Commands and events

New commands (all `main` window only, in `build.rs` and `capabilities/default.json`):
`ai_openai_set_key`, `ai_openai_has_key`, `ai_openai_clear_key`, `ai_openai_models`,
`mcp_status`, `mcp_start`, `mcp_stop`, `mcp_set_tools`, `mcp_tool_result`, `mcp_get_token`,
`mcp_regenerate_token`. Changed: `ai_complete` (`provider`, `baseUrl`). Events: `mcp://tool-call`,
`mcp://status`. Details in [commands.md](../contracts/commands.md).

## Consequences

- Coaches can run co-co's AI features fully offline with a local model; zone rules still apply.
- Any MCP client on the same machine that has the token can read (redacted) camp data and – if the
  coach enables write tools – change co-co drafts or post a comment after confirmation. A malicious
  local process with the token is out of scope (it could read the keychain entry under the same user
  anyway); remote access is impossible because the server binds to loopback only.
- The MCP server depends on the co-co window being open (tools run in the webview). Closing the
  window ends the process and the server.
- No Dexie schema change: provider and MCP settings live in the existing `settings` record (backup
  covers them; import switches AI **and** MCP off, like it already does for AI). The MCP log is not
  stored.
- Adding an MCP tool = catalogue entry + i18n title/description + handler + test; the zone check and
  the switch UI come for free.
