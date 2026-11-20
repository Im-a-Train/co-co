// M21: pure display helpers for NDS numbers (no i18n, counts only).
import type { NdsPresentCounts } from '../types'

/** «1'234.50» (Swiss apostrophe thousands, 2 decimals); null/NaN -> null. */
export function formatChf(n: number | null): string | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null
  const [int, dec] = Math.abs(n).toFixed(2).split('.')
  return `${n < 0 ? '-' : ''}${int!.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${dec}`
}

/** Sum of the non-null child/adolescent counts; null when all four are null (supervisors not included). */
export function presentTotal(p: NdsPresentCounts): number | null {
  const vals = [p.maleChildren, p.femaleChildren, p.maleAdolescents, p.femaleAdolescents].filter((v): v is number => v !== null)
  return vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0)
}
