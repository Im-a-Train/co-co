/**
 * Refresh scheduling identical to the eCamp Vue frontend (frontend/src/plugins/auth.js):
 * refresh after half of the remaining JWT lifetime, clamped to 2..30 minutes.
 */
export const MIN_REFRESH_DELAY_MS = 2 * 60 * 1000
export const MAX_REFRESH_DELAY_MS = 30 * 60 * 1000

/**
 * Normalizes an epoch timestamp to milliseconds. Values below 1e12 are treated
 * as seconds (1e12 ms is in 2001, 1e12 s is far in the future).
 */
export function normalizeEpochMs(value: number): number {
  return value < 1e12 ? value * 1000 : value
}

/**
 * @param expSeconds JWT `exp` claim in seconds since epoch (null/undefined = unknown)
 * @param nowMs current time in ms
 * @returns delay in ms until the next refresh
 */
export function computeRefreshDelayMs(expSeconds: number | null | undefined, nowMs: number = Date.now()): number {
  const expMs = (expSeconds ?? 0) * 1000
  const half = (expMs - nowMs) / 2
  return Math.max(Math.min(half, MAX_REFRESH_DELAY_MS), MIN_REFRESH_DELAY_MS)
}

/** Remaining token lifetime in whole seconds (never negative). */
export function remainingSeconds(expSeconds: number | null | undefined, nowMs: number = Date.now()): number {
  if (expSeconds == null) return 0
  return Math.max(0, Math.floor(expSeconds - nowMs / 1000))
}

/** Formats seconds as "h:mm:ss" or "mm:ss". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
