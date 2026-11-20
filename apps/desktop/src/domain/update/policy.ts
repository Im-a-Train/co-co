/** Pure policy of the in-app update check (ADR 0018). */
import type { UpdateSettings } from '../types'

export const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Result of `app_update_check` (mirrors coco-core `AppUpdateInfo`). */
export interface AppUpdateInfo {
  currentVersion: string
  available: boolean
  version: string | null
  notes: string | null
  date: string | null
  /** True when the update can be installed in place (NSIS install). */
  canInstall: boolean
  /** True for the portable exe: no in-place update, offer the release page instead. */
  portable: boolean
  releaseUrl: string
}

/** Automatic check: enabled, allowed for this build and the last check is older than 24 h. */
export function shouldAutoCheck(s: UpdateSettings, buildAllows: boolean, now: Date): boolean {
  if (!s.autoCheck || !buildAllows) return false
  if (!s.lastCheckAt) return true
  const last = Date.parse(s.lastCheckAt)
  if (Number.isNaN(last)) return true
  return now.getTime() - last >= AUTO_CHECK_INTERVAL_MS || last > now.getTime()
}

/** Shows the dialog for an automatic check only when an update exists and was not skipped. */
export function shouldPromptAuto(info: AppUpdateInfo, skippedVersion: string | null): boolean {
  return info.available && !!info.version && info.version !== skippedVersion
}

const DEFAULT_PREFS: UpdateSettings = { autoCheck: true, lastCheckAt: null, skippedVersion: null }

/**
 * Parses the boot copy of the update settings. It lets the start-up check run before the data store is
 * unlocked (which needs an eCamp login): a release that breaks the login must still be able to offer its fix.
 * Unknown or malformed values fall back to the defaults.
 */
export function parseUpdatePrefs(raw: string | null): UpdateSettings {
  if (!raw) return { ...DEFAULT_PREFS }
  try {
    const o = JSON.parse(raw) as Partial<Record<keyof UpdateSettings, unknown>>
    return {
      autoCheck: typeof o.autoCheck === 'boolean' ? o.autoCheck : DEFAULT_PREFS.autoCheck,
      lastCheckAt: typeof o.lastCheckAt === 'string' ? o.lastCheckAt : null,
      skippedVersion: typeof o.skippedVersion === 'string' && o.skippedVersion.length <= 64 ? o.skippedVersion : null,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}
