/**
 * Time windows of a camp day (catalog v2 §3.10). Pure.
 * Windows come from param `js.timeWindows`; an interval covers a window when it overlaps it by at least
 * `js.timeWindowMinOverlap` minutes (lenient reading).
 */
import type { JsInterval } from '../../types'
import { hhmmToMinutes } from './params'

export interface TimeWindow {
  id: string
  label: string
  /** Minutes since midnight. */
  from: number
  to: number
}

/** Parses the `js.timeWindows` param value ([{id, label, from: 'HH:MM', to: 'HH:MM'}]). */
export function parseTimeWindows(value: unknown): TimeWindow[] {
  if (!Array.isArray(value)) throw new Error('js.timeWindows: Liste erwartet')
  return value.map((w) => {
    const r = w as Record<string, unknown>
    return { id: String(r.id), label: String(r.label ?? r.id), from: hhmmToMinutes(String(r.from)), to: hhmmToMinutes(String(r.to)) }
  })
}

export function overlapMinutes(a: JsInterval, from: number, to: number): number {
  return Math.max(0, Math.min(a.to, to) - Math.max(a.from, from))
}

/** Ids of the windows covered by at least one interval (overlap ≥ minOverlap), in window order. */
export function windowsCovered(intervals: readonly JsInterval[], windows: readonly TimeWindow[], minOverlap: number): string[] {
  return windows.filter((w) => intervals.some((i) => overlapMinutes(i, w.from, w.to) >= minOverlap)).map((w) => w.id)
}
