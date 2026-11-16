/** Display helpers of the NDS UI. */
import { ndsLinkInfo, ndsStateLabel } from '@/domain/nds'
import type { NdsFieldValue } from '@/domain/nds'
import { germanRoleLabel, roleLabelKey } from '@/domain/persons/roleLabels'
import type { NdsAggregate, NdsLink } from '@/domain/types'

/**
 * Name of the linked NDS camp for link lines: «Musterstufe · Angebot 999001 (24.–30.01.2031)»; the internal
 * campBusinessId only when nothing else is known. Shared by the NDS card and «Personen».
 */
export function ndsLinkLabel(
  link: NdsLink,
  agg: Pick<NdsAggregate, 'offerNumber' | 'start' | 'end'> | null,
  t: (key: string, params: Record<string, unknown>) => string,
): string {
  const info = ndsLinkInfo(link, agg)
  const main = [info.groupName, info.offerNumber ? t('nds.card.link.offer', { n: info.offerNumber }) : ''].filter(Boolean).join(' · ')
  if (!info.dates) return main || link.campBusinessId
  return `${main || link.campBusinessId} (${info.dates})`
}

/**
 * code -> count record as sorted rows. Labels: the role mapping Personen uses (when `t` is given), then the
 * state table; unknown codes stay raw.
 */
export function countEntries(
  rec: Record<string, number>,
  t?: (key: string) => string,
): { code: string; label: string; n: number }[] {
  return Object.entries(rec)
    .map(([code, n]) => ({ code, label: t && roleLabelKey(code) ? germanRoleLabel(code, t) : ndsStateLabel(code), n }))
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
