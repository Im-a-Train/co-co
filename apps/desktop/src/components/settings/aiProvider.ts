/** Pure helpers for the OpenAI-compatible provider settings (mirrors the Rust URL checks, ADR 0012). */
import type { OpenAiPreset } from '@/domain/types'
import { OPENAI_PRESET_URLS } from '@/domain/types'

export interface ProviderPreset {
  id: OpenAiPreset
  labelKey: string
  hintKey: string
  url?: string
}

export const PRESETS: ProviderPreset[] = [
  { id: 'ollama', labelKey: 'ai.provider.presets.ollama', hintKey: 'ai.provider.help.ollama', url: OPENAI_PRESET_URLS.ollama },
  { id: 'lmstudio', labelKey: 'ai.provider.presets.lmstudio', hintKey: 'ai.provider.help.lmstudio', url: OPENAI_PRESET_URLS.lmstudio },
  { id: 'openai', labelKey: 'ai.provider.presets.openai', hintKey: 'ai.provider.help.openai', url: OPENAI_PRESET_URLS.openai },
  { id: 'custom', labelKey: 'ai.provider.presets.custom', hintKey: 'ai.provider.help.custom' },
]

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h === '[::1]') return true
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  return !!m && [m[1], m[2], m[3]].every((p) => Number(p) <= 255)
}

/** https, or http only for loopback hosts; no userinfo, query or fragment. */
export function isAllowedBaseUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return false
  }
  if (u.username || u.password || u.search || u.hash) return false
  if (/[?#]/.test(url)) return false
  if (!u.hostname) return false
  if (u.protocol === 'https:') return true
  if (u.protocol === 'http:') return isLoopbackHost(u.hostname)
  return false
}

/** Origin (scheme://host[:port]) of a base URL for the key hint, or '' when unparsable. */
export function originOf(url: string): string {
  try {
    return new URL(url.trim()).origin
  } catch {
    return ''
  }
}
