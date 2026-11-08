/**
 * Typed wrappers around the Tauri commands and events of the M0 login spike.
 *
 * All eCamp HTTP traffic happens in Rust (reqwest + cookie jar). The frontend
 * only ever sees cookie NAMES and decoded jwt_hp payload fields, never values.
 */
import { invoke, isTauri as coreIsTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export interface InstanceInfo {
  baseUrl: string
  apiRoot: string
  cookiePrefix: string
  featureComments: boolean
  version: string | null
  oauthProviders: string[]
}

export type LoginMethod = 'webview' | 'password'

export interface SessionInfo {
  baseUrl: string
  apiRoot: string
  method: LoginMethod
  userIri: string | null
  /** JWT expiry, seconds since epoch. */
  exp: number | null
  roles: string[]
  cookieNames: string[]
  /** Seconds since epoch (Rust side). Milliseconds are tolerated, see normalizeEpochMs. */
  obtainedAt: number
}

export interface AuthLogEvent {
  step: string
  ok: boolean
  detail?: string | null
}

export const EVENT_SESSION = 'auth://session'
export const EVENT_LOG = 'auth://log'

/** True when running inside the Tauri webview (not in a plain browser / vite dev). */
export function isTauri(): boolean {
  try {
    return coreIsTauri()
  } catch {
    return false
  }
}

export class NotInTauriError extends Error {
  constructor() {
    super('not-in-tauri')
    this.name = 'NotInTauriError'
  }
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new NotInTauriError()
  return invoke<T>(cmd, args)
}

/** Converts whatever a rejected invoke returns (string, object, Error) into a message. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>
    if (typeof o.message === 'string') return o.message
    try {
      return JSON.stringify(err)
    } catch {
      /* fall through */
    }
  }
  return String(err)
}

// ---------------------------------------------------------------------------------------------
// M1-M5 contract types (see docs/contracts/commands.md). Implemented by the Rust commands.
// ---------------------------------------------------------------------------------------------

export interface FileFilter {
  /** Display name, e.g. "Dokumente" */
  name: string
  /** Extensions without dot, e.g. ["pdf", "docx", "gpx", "txt", "md"] */
  extensions: string[]
}

export interface DocumentBytes {
  path: string
  name: string
  size: number
  modifiedMs: number
  /** Standard base64 of the file content (max 25 MB file size). */
  bytesBase64: string
}

export interface FolderEntry {
  path: string
  name: string
  isDir: boolean
  size: number
  modifiedMs: number
}

export interface TextFile {
  name: string
  content: string
}

export type DocsChangeKind = 'create' | 'modify' | 'remove'

export interface DocsChangedEvent {
  folder: string
  path: string
  kind: DocsChangeKind
}

export interface DocsDroppedEvent {
  paths: string[]
}

export const EVENT_DOCS_CHANGED = 'docs://changed'
export const EVENT_DOCS_DROPPED = 'docs://dropped'

// M7: MiData (red zone). Only aggregates / summaries / names + status codes cross the IPC boundary.
export type { MidataAggregate, MidataEventSummary, MidataProbe, MidataStatus } from '@/domain/types'
import type { MidataAggregate, MidataEventSummary, MidataProbe, MidataQualKey, MidataStatus } from '@/domain/types'

export const EVENT_MIDATA_STATUS = 'midata://status'

// M8: NDS (red zone). Only aggregates / summaries / names + status codes cross the IPC boundary.
export type { NdsAggregate, NdsCampSummary, NdsProbe, NdsStatus } from '@/domain/types'
import type { NdsAggregate, NdsCampSummary, NdsProbe, NdsStatus } from '@/domain/types'
export const EVENT_NDS_STATUS = 'nds://status'

// ADR 0011: local MCP server. Types live in domain/mcp/types.ts.
export type { McpLogEntry, McpStatus, McpToolCallEvent, McpToolCancelEvent, McpToolOutcome, McpToolRegistration } from '@/domain/mcp/types'
import type { McpStatus, McpToolCallEvent, McpToolCancelEvent, McpToolOutcome, McpToolRegistration } from '@/domain/mcp/types'
/** Rust -> main window: run a tool and answer with commands.mcpToolResult(callId, outcome). */
export const EVENT_MCP_TOOL_CALL = 'mcp://tool-call'
/** Rust -> main window: server started/stopped/failed or a call finished (payload McpStatus incl. log). */
export const EVENT_MCP_STATUS = 'mcp://status'
/** Rust -> main window: a call ended without the frontend's answer (client cancelled, timeout, server stopped). */
export const EVENT_MCP_TOOL_CANCEL = 'mcp://tool-cancel'
// «Personen» tab (red zone, ADR 0009). Types live in the persons domain contract.
import type { MidataPersonsResult, NdsPersonsResult } from '@/domain/persons/types'
import type { IsoDate } from '@/domain/types'

export const commands = {
  // M0
  discoverInstance: (baseUrl: string) => call<InstanceInfo>('discover_instance', { baseUrl }),
  openLoginWindow: (baseUrl: string) => call<void>('open_login_window', { baseUrl }),
  passwordLogin: (baseUrl: string, identifier: string, password: string) =>
    call<SessionInfo>('password_login', { baseUrl, identifier, password }),
  sessionStatus: () => call<SessionInfo | null>('session_status'),
  refreshSession: () => call<SessionInfo>('refresh_session'),
  apiGet: <T = JsonObject>(path: string) => call<T>('api_get', { path }),
  logout: () => call<void>('logout'),

  // M2: eCamp comments (the only write access to eCamp)
  /** POST /api/comments { camp, activity, textHtml } -> created comment (HAL JSON). textHtml <= 1024 chars. */
  apiPostComment: (campIri: string, activityIri: string, textHtml: string) =>
    call<JsonObject>('api_post_comment', { campIri, activityIri, textHtml }),
  /** PATCH /api/comments/{id} (application/merge-patch+json). May fail with 405 on instances without comment PATCH. */
  apiPatchComment: (commentIri: string, patch: JsonObject) =>
    call<JsonObject>('api_patch_comment', { commentIri, patch }),

  /** Opens an eCamp web URL (same origin as the current session, path below /camps/) in the system browser. */
  openEcampUrl: (url: string) => call<void>('open_ecamp_url', { url }),

  // M3: files + documents (paths are only readable when allowed: picked, dropped, or in a watched folder)
  pickFiles: (filters?: FileFilter[]) => call<string[]>('pick_files', { filters: filters ?? null }),
  pickFolder: () => call<string | null>('pick_folder'),
  readDocument: (path: string) => call<DocumentBytes>('read_document', { path }),
  listFolder: (path: string) => call<FolderEntry[]>('list_folder', { path }),
  watchFolder: (path: string) => call<void>('watch_folder', { path }),
  unwatchFolder: (path: string) => call<void>('unwatch_folder', { path }),

  // M4: backup files
  /**
   * Save dialog; the filter follows the extension of `defaultName` (json, ics, md, txt; others are rejected).
   * Returns the saved path or null when cancelled.
   */
  saveTextFile: (defaultName: string, content: string) =>
    call<string | null>('save_text_file', { defaultName, content }),
  /** Open dialog (JSON filter); returns null when cancelled. */
  openTextFile: () => call<TextFile | null>('open_text_file'),

  // M5: AI key management (OS keychain). Completion lives in lib/tauriAi.ts (aiGateway only).
  aiSetKey: (key: string) => call<void>('ai_set_key', { key }),
  aiHasKey: () => call<boolean>('ai_has_key'),
  aiClearKey: () => call<void>('ai_clear_key'),
  // ADR 0011: OpenAI-compatible provider. The optional key is bound to the origin of baseUrl (keychain).
  /** Stores the key for the origin of `baseUrl` (replaces any key stored for another origin). */
  aiOpenaiSetKey: (baseUrl: string, key: string) => call<void>('ai_openai_set_key', { baseUrl, key }),
  /** True only if a key is stored for exactly the origin of `baseUrl`. */
  aiOpenaiHasKey: (baseUrl: string) => call<boolean>('ai_openai_has_key', { baseUrl }),
  aiOpenaiClearKey: () => call<void>('ai_openai_clear_key'),
  /** GET {baseUrl}/models -> sorted model ids. Also the «Verbindung testen» action (sends no camp data). */
  aiOpenaiModels: (baseUrl: string) => call<string[]>('ai_openai_models', { baseUrl }),

  // ADR 0011: local MCP server (127.0.0.1 only, bearer token).
  mcpStatus: () => call<McpStatus>('mcp_status'),
  /** Starts (or restarts on another port) the server; creates the token if none exists. Emits EVENT_MCP_STATUS. */
  mcpStart: (port: number) => call<McpStatus>('mcp_start', { port }),
  /** Idempotent. Pending tool calls are answered with an error. Emits EVENT_MCP_STATUS. */
  mcpStop: () => call<McpStatus>('mcp_stop'),
  /** Replaces the registered tool list (enabled tools only). Disabled tools are neither listed nor callable. */
  mcpSetTools: (tools: McpToolRegistration[]) => call<void>('mcp_set_tools', { tools }),
  /** Answers a `mcp://tool-call` event. Unknown or already answered callIds are ignored. */
  mcpToolResult: (callId: string, outcome: McpToolOutcome) => call<void>('mcp_tool_result', { callId, outcome }),
  /** The bearer token for the MCP client config (ADR 0011 exception: shown in the KI tab). Created when missing. */
  mcpGetToken: () => call<string>('mcp_get_token'),
  /** Replaces the token; configured clients must be updated. */
  mcpRegenerateToken: () => call<string>('mcp_regenerate_token'),

  // M7: MiData (read-only). Refreshed only on explicit user action.
  midataStatus: () => call<MidataStatus>('midata_status'),
  /** Opens the MiData login window (no IPC); emits EVENT_MIDATA_STATUS when the session cookie is captured. */
  midataOpenLogin: (baseUrl: string) => call<void>('midata_open_login', { baseUrl }),
  /** Validates and stores a service token (X-TOKEN) in the OS keychain. */
  midataSetToken: (baseUrl: string, token: string) => call<MidataStatus>('midata_set_token', { baseUrl, token }),
  midataLogout: () => call<void>('midata_logout'),
  /** Camp events (Event::Camp, all visible organisations) overlapping [from, to] (YYYY-MM-DD), ranked by overlap with the camp. */
  midataFindEvents: (from: string, to: string, campStart: string | null, campEnd: string | null) =>
    call<MidataEventSummary[]>('midata_find_events', { from, to, campStart, campEnd }),
  midataFetchAggregate: (
    eventId: string,
    campStart: string,
    campEnd: string,
    coachPersonId: string | null,
    qualMapping: Record<string, MidataQualKey[]> | null,
  ) => call<MidataAggregate>('midata_fetch_aggregate', { eventId, campStart, campEnd, coachPersonId, qualMapping }),
  /** M7-0 spike: what the current auth can read (status codes + field names only). */
  midataFindSelf: (email: string) => call<{ personId: string | null; nickname: string | null; count: number }>('midata_find_self', { email }),
  midataProbe: (eventId: string, groupId: string | null) => call<MidataProbe>('midata_probe', { eventId, groupId }),
  // M8: NDS (read-only, unofficial web API). Refreshed only on explicit user action.
  ndsStatus: () => call<NdsStatus>('nds_status'),
  /** Opens the NDS login window (no IPC); emits EVENT_NDS_STATUS when the SESSION cookie is captured. */
  ndsOpenLogin: () => call<void>('nds_open_login'),
  ndsLogout: () => call<void>('nds_logout'),
  ndsFindCamps: (from: string, to: string) => call<NdsCampSummary[]>('nds_find_camps', { from, to }),
  ndsFetchAggregate: (offerBusinessId: string, campBusinessId: string) =>
    call<NdsAggregate>('nds_fetch_aggregate', { offerBusinessId, campBusinessId }),
  ndsProbe: (campBusinessId: string) => call<NdsProbe>('nds_probe', { campBusinessId }),
  // «Personen» tab (ADR 0009, RED ZONE): individual people, held in Rust memory only, never persisted.
  personsLoadMidata: (eventId: string, campStart: IsoDate, campEnd: IsoDate) =>
    call<MidataPersonsResult>('persons_load_midata', { eventId, campStart, campEnd }),
  personsLoadNds: (ndsCampId: string) => call<NdsPersonsResult>('persons_load_nds', { ndsCampId }),
  /** Wipes the in-memory person lists in Rust (lock, logout, leaving the tab). */
  personsClear: () => call<void>('persons_clear'),
}

/** Decodes DocumentBytes.bytesBase64. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const noop: UnlistenFn = () => {}

export async function onDocsChanged(handler: (e: DocsChangedEvent) => void): Promise<UnlistenFn> {
  if (!isTauri()) return noop
  return listen<DocsChangedEvent>(EVENT_DOCS_CHANGED, (e) => handler(e.payload))
}

export async function onDocsDropped(handler: (e: DocsDroppedEvent) => void): Promise<UnlistenFn> {
  if (!isTauri()) return noop
  return listen<DocsDroppedEvent>(EVENT_DOCS_DROPPED, (e) => handler(e.payload))
}

export async function onSession(handler: (session: SessionInfo) => void): Promise<UnlistenFn> {
  if (!isTauri()) return noop
  return listen<SessionInfo>(EVENT_SESSION, (e) => handler(e.payload))
}

export async function onMidataStatus(handler: (status: MidataStatus) => void): Promise<UnlistenFn> {
  if (!isTauri()) return noop
  return listen<MidataStatus>(EVENT_MIDATA_STATUS, (e) => handler(e.payload))
}

export async function onNdsStatus(handler: (status: NdsStatus) => void): Promise<UnlistenFn> {
  if (!isTauri()) return noop
  return listen<NdsStatus>(EVENT_NDS_STATUS, (e) => handler(e.payload))
}

export async function onAuthLog(handler: (log: AuthLogEvent) => void): Promise<UnlistenFn> {
  if (!isTauri()) return noop
  return listen<AuthLogEvent>(EVENT_LOG, (e) => handler(e.payload))
}

export async function onMcpToolCall(handler: (call: McpToolCallEvent) => void): Promise<UnlistenFn> {
  if (!isTauri()) return noop
  return listen<McpToolCallEvent>(EVENT_MCP_TOOL_CALL, (e) => handler(e.payload))
}

export async function onMcpToolCancel(handler: (event: McpToolCancelEvent) => void): Promise<UnlistenFn> {
  if (!isTauri()) return noop
  return listen<McpToolCancelEvent>(EVENT_MCP_TOOL_CANCEL, (e) => handler(e.payload))
}

export async function onMcpStatus(handler: (status: McpStatus) => void): Promise<UnlistenFn> {
  if (!isTauri()) return noop
  return listen<McpStatus>(EVENT_MCP_STATUS, (e) => handler(e.payload))
}
