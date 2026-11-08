/** Shared builders of the `lst` module tests (not a test file). */
import { CAT_LS, type FactsBuilder } from '../factory'

/** Camp start dates: 2026 = calendar mode, no BWZ criterion; 2027 = J+S-day counting with movement time. */
export const Y2026 = '2026-07-12'
export const Y2027 = '2027-07-12'

/** Valid J+S day (two 2 h units 09–11 and 14–16), with movement time `ys` per entry (60 → 120 min per day). */
export function jsDay(b: FactsBuilder, day: number, ys: number | null = 60, cat = CAT_LS): void {
  b.entry(b.activity(`Vormittag ${day}`, cat), day, '09:00', '11:00', { ys })
  b.entry(b.activity(`Nachmittag ${day}`, cat), day, '14:00', '16:00', { ys })
}

export const ids = (hits: { targets: string[] }[]) => hits.map((h) => h.targets.join('|'))
