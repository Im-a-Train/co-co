/** Pure policy of the in-app update check (ADR 0017). */
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
