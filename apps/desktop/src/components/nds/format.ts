/** Display helpers of the NDS UI. */
import { ndsStateLabel } from '@/domain/nds'
import type { NdsFieldValue } from '@/domain/nds'

/** code -> count record as sorted rows; labels via the state table (unknown codes stay raw). */
export function countEntries(rec: Record<string, number>): { code: string; label: string; n: number }[] {
  return Object.entries(rec)
    .map(([code, n]) => ({ code, label: ndsStateLabel(code), n }))
    .sort((a, b) => b.n - a.n || a.code.localeCompare(b.code))
}

/** Value of a coach-input field for the adopt table. */
export function ndsValueKey(v: NdsFieldValue | undefined): { text: string } | { key: 'yes' | 'no' } | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return { key: v ? 'yes' : 'no' }
  return { text: String(v) }
}

/** Pre-checked in the adopt dialog: NDS value known, differs, current value empty (or «nein»). */
export function ndsPreChecked(d: { ndsValue: NdsFieldValue; currentValue: NdsFieldValue; same: boolean }): boolean {
  return d.ndsValue !== null && !d.same && (d.currentValue === null || d.currentValue === false)
}
