/** Display helpers of the NDS UI. */
import { ndsLinkInfo, ndsStateLabel } from '@/domain/nds'
import type { NdsFieldValue } from '@/domain/nds'
import { germanRoleLabel, roleLabelKey } from '@/domain/persons/roleLabels'
import type { NdsAggregate, NdsCampDetails, NdsLink, NdsPresentCounts } from '@/domain/types'

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

/** Ja / Nein / unbekannt key (under `nds.tri`) of a nullable flag. */
export function triKey(v: boolean | null | undefined): 'yes' | 'no' | 'unknown' {
  return v === true ? 'yes' : v === false ? 'no' : 'unknown'
}

/** CHF amount: «CHF 1’234.50» (no decimals when whole), «–» when unknown. */
export function formatChf(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–'
  const [int, dec] = Math.abs(n).toFixed(Number.isInteger(n) ? 0 : 2).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '’')
  return `CHF ${n < 0 ? '-' : ''}${grouped}${dec ? `.${dec}` : ''}`
}

/** Chip colour of an NDS protocol event kind. */
export function protocolKindColor(kind: string): string | undefined {
  switch (kind) {
    case 'approved':
    case 'paid':
      return 'success'
    case 'submitted':
    case 'closed':
      return 'primary'
    default:
      return undefined
  }
}

/** Sum of the present children and adolescents (null when none of the four counts is known). */
export function presentParticipants(p: Pick<NdsPresentCounts, 'maleChildren' | 'femaleChildren' | 'maleAdolescents' | 'femaleAdolescents'>): number | null {
  const vals = [p.maleChildren, p.femaleChildren, p.maleAdolescents, p.femaleAdolescents]
  if (vals.every((v) => v === null)) return null
  return vals.reduce<number>((a, v) => a + (v ?? 0), 0)
}

/** True when the details block has anything worth a section (all-null records stay silent). */
export function hasCampDetails(d: NdsCampDetails): boolean {
  const f = d.offerFlags
  const flags = [d.riskActivitiesPlanned, d.supervisorExpertisePresent, d.overnightStay, d.lateSubmission, d.approvalWithReservation, f.lateSubmittedItems, f.itemsInCorrection, f.handicapRegistration]
  const numbers = [d.campDaysWithActivities, d.campDaysWithoutActivities, d.subsidies.planned, d.subsidies.actual, d.subsidies.total, ...Object.values(d.present)]
  return (
    flags.some((v) => v !== null) ||
    d.riskActivityAnswers.some((v) => v !== null) ||
    numbers.some((v) => v !== null) ||
    (d.minimalRequirementsMessages?.length ?? 0) > 0
  )
}
