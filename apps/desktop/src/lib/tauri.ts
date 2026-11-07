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

export const commands = {
  discoverInstance: (baseUrl: string) => call<InstanceInfo>('discover_instance', { baseUrl }),
  openLoginWindow: (baseUrl: string) => call<void>('open_login_window', { baseUrl }),
  passwordLogin: (baseUrl: string, identifier: string, password: string) =>
    call<SessionInfo>('password_login', { baseUrl, identifier, password }),
  sessionStatus: () => call<SessionInfo | null>('session_status'),
  refreshSession: () => call<SessionInfo>('refresh_session'),
  apiGet: <T = JsonObject>(path: string) => call<T>('api_get', { path }),
  logout: () => call<void>('logout'),
}

const noop: UnlistenFn = () => {}

export async function onSession(handler: (session: SessionInfo) => void): Promise<UnlistenFn> {
  if (!isTauri()) return noop
  return listen<SessionInfo>(EVENT_SESSION, (e) => handler(e.payload))
}

export async function onAuthLog(handler: (log: AuthLogEvent) => void): Promise<UnlistenFn> {
  if (!isTauri()) return noop
  return listen<AuthLogEvent>(EVENT_LOG, (e) => handler(e.payload))
}
