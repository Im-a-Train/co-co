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

  // M3: files + documents (paths are only readable when allowed: picked, dropped, or in a watched folder)
  pickFiles: (filters?: FileFilter[]) => call<string[]>('pick_files', { filters: filters ?? null }),
  pickFolder: () => call<string | null>('pick_folder'),
  readDocument: (path: string) => call<DocumentBytes>('read_document', { path }),
  listFolder: (path: string) => call<FolderEntry[]>('list_folder', { path }),
  watchFolder: (path: string) => call<void>('watch_folder', { path }),
  unwatchFolder: (path: string) => call<void>('unwatch_folder', { path }),

  // M4: backup files
  /** Save dialog (JSON filter); returns the saved path or null when cancelled. */
  saveTextFile: (defaultName: string, content: string) =>
    call<string | null>('save_text_file', { defaultName, content }),
  /** Open dialog (JSON filter); returns null when cancelled. */
  openTextFile: () => call<TextFile | null>('open_text_file'),

  // M5: AI key management (OS keychain). Completion lives in lib/tauriAi.ts (aiGateway only).
  aiSetKey: (key: string) => call<void>('ai_set_key', { key }),
  aiHasKey: () => call<boolean>('ai_has_key'),
  aiClearKey: () => call<void>('ai_clear_key'),
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

export async function onAuthLog(handler: (log: AuthLogEvent) => void): Promise<UnlistenFn> {
  if (!isTauri()) return noop
  return listen<AuthLogEvent>(EVENT_LOG, (e) => handler(e.payload))
}
