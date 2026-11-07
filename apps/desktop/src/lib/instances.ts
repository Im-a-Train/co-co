/** eCamp instance list (built-ins + user-defined), persisted in localStorage. */

export interface EcampInstance {
  id: string
  /** i18n key for built-ins, plain label for custom instances. */
  label: string
  labelKey?: string
  baseUrl: string
  builtIn: boolean
}

export const BUILT_IN_INSTANCES: readonly EcampInstance[] = [
  { id: 'prod', label: 'eCamp (Produktion)', labelKey: 'instance.builtIn.prod', baseUrl: 'https://app.ecamp3.ch', builtIn: true },
  { id: 'dev', label: 'eCamp Dev', labelKey: 'instance.builtIn.dev', baseUrl: 'https://dev.ecamp3.ch', builtIn: true },
]

export const STORAGE_KEY = 'coco.instances.v1'
export const SELECTED_KEY = 'coco.selectedInstance.v1'

export type UrlCheck = { ok: true; baseUrl: string } | { ok: false; reason: 'invalid' | 'insecure' }

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Validates and normalizes an instance base URL: https only (http only for
 * localhost), no path/query/hash, no trailing slash. Mirrors the Rust check.
 */
export function normalizeBaseUrl(input: string): UrlCheck {
  let raw = input.trim()
  if (!raw) return { ok: false, reason: 'invalid' }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (!url.hostname || url.username || url.password) return { ok: false, reason: 'invalid' }
  if (url.protocol === 'http:') {
    if (!LOCAL_HOSTS.has(url.hostname)) return { ok: false, reason: 'insecure' }
  } else if (url.protocol !== 'https:') {
    return { ok: false, reason: 'invalid' }
  }
  return { ok: true, baseUrl: url.origin }
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadCustomInstances(store: StorageLike | null = storage()): EcampInstance[] {
  try {
    const raw = store?.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const result: EcampInstance[] = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      if (typeof e.baseUrl !== 'string') continue
      const check = normalizeBaseUrl(e.baseUrl)
      if (!check.ok) continue
      if (BUILT_IN_INSTANCES.some((b) => b.baseUrl === check.baseUrl)) continue
      if (result.some((r) => r.baseUrl === check.baseUrl)) continue
      result.push({
        id: `custom:${check.baseUrl}`,
        label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : new URL(check.baseUrl).host,
        baseUrl: check.baseUrl,
        builtIn: false,
      })
    }
    return result
  } catch {
    return []
  }
}

export function saveCustomInstances(list: EcampInstance[], store: StorageLike | null = storage()): void {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(list.map(({ label, baseUrl }) => ({ label, baseUrl }))))
  } catch {
    /* storage unavailable: list lives only for this session */
  }
}

export function loadSelectedId(store: StorageLike | null = storage()): string | null {
  try {
    return store?.getItem(SELECTED_KEY) ?? null
  } catch {
    return null
  }
}

export function saveSelectedId(id: string, store: StorageLike | null = storage()): void {
  try {
    store?.setItem(SELECTED_KEY, id)
  } catch {
    /* ignore */
  }
}
