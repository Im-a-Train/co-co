/** Display helpers of the MiData UI. */
import type { MidataFieldValue } from '@/domain/midata'

const pad = (n: number): string => String(n).padStart(2, '0')

/** ISO timestamp -> «dd.mm.yyyy HH:mm» (local time); invalid input is returned unchanged. */
export function formatStand(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** ISO date -> «dd.mm.yyyy». */
export function formatDate(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

/** Value of a coach-input field for the adopt table; booleans as keys under midata.adopt.values. */
export function valueKey(v: MidataFieldValue): { text: string } | { key: 'yes' | 'no' } | null {
  if (v === null) return null
  if (typeof v === 'boolean') return { key: v ? 'yes' : 'no' }
  return { text: String(v) }
}

/** Fields pre-checked in the adopt dialog: MiData value known, differs, current value empty. */
export function preChecked(d: { midataValue: MidataFieldValue; currentValue: MidataFieldValue; same: boolean }): boolean {
  return d.midataValue !== null && !d.same && d.currentValue === null
}
