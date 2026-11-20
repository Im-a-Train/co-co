/** Module `js`, NDS sync v2 (M22, ADR 0017): CMP-NDS-05..11. Counts and codes of the NDS aggregate only (red zone), silent without data. */
import type { RuleContext, RuleHit, RulePredicate } from '@/domain/types'
import { formatDateDe, formatStand, ndsEvidence } from '../../../lib/util'
import { isRiskActivity } from './lst'

const MAX_LIST = 5

/** Joins at most `max` items, then appends an ellipsis. */
function joinMax(list: string[], sep: string, max: number): string {
  const shown = list.slice(0, max).join(sep)
  return list.length > max ? `${shown}${sep}…` : shown
}

/** Camp hit with NDS evidence; `inputs` are red-derived (all keys are red unless `redKeys` says otherwise). */
function ndsCampHit(
  ctx: RuleContext,
  stand: string,
  params: Record<string, string | number>,
  inputs: NonNullable<RuleHit['inputs']>,
  extra: Partial<RuleHit> = {},
): RuleHit {
  return {
    targets: [ctx.facts.camp.iri],
    params: { ...params, stand },
    evidence: [ndsEvidence(stand)],
    inputs,
    redKeys: Object.keys(inputs),
    ...extra,
  }
}

/** CMP-NDS-05: persons double-booked in another J+S offer. */
export const cmpNds05: RulePredicate = (ctx) => {
  const a = ctx.nds?.attendance
  if (!ctx.nds || !a) return []
  const total = a.overlapParticipants + a.overlapSupervisors
  if (!(total > 0)) return []
  const stand = formatStand(ctx.nds.fetchedAt)
  const offers = a.overlapOfferNumbers.length > 0 ? a.overlapOfferNumbers.join(', ') : '–'
  const dates = a.overlapDates.length > 0 ? joinMax(a.overlapDates.map(formatDateDe), ', ', 10) : '–'
  return [
    ndsCampHit(
      ctx,
      stand,
      { participants: a.overlapParticipants, supervisors: a.overlapSupervisors, offers, dates },
      { overlapParticipants: a.overlapParticipants, overlapSupervisors: a.overlapSupervisors },
    ),
  ]
}

/** CMP-NDS-06: participants never present (checked activities only) or not eligible for subsidies. */
export const cmpNds06: RulePredicate = (ctx) => {
  const a = ctx.nds?.attendance
  if (!ctx.nds || !a) return []
  const never = a.activitiesChecked > 0 && a.participantsNeverPresent > 0 ? a.participantsNeverPresent : 0
  const notEligible = a.participantsNotEligible > 0 ? a.participantsNotEligible : 0
  if (never === 0 && notEligible === 0) return []
  const stand = formatStand(ctx.nds.fetchedAt)
  return [
    ndsCampHit(
      ctx,
      stand,
      { never, notEligible },
      { participantsNeverPresent: never, participantsNotEligible: notEligible },
      never > 0 && notEligible > 0 ? {} : { variant: never > 0 ? 'never' : 'notEligible' },
    ),
  ]
}

/** CMP-NDS-07: dates with present participants but no present supervisors. */
export const cmpNds07: RulePredicate = (ctx) => {
  const a = ctx.nds?.attendance
  if (!ctx.nds || !a) return []
  const days = a.byDate.filter((d) => d.participantsPresent > 0 && d.supervisorsPresent === 0)
  if (days.length === 0) return []
  const stand = formatStand(ctx.nds.fetchedAt)
  return [
    ndsCampHit(
      ctx,
      stand,
      { dates: joinMax(days.map((d) => formatDateDe(d.date)), ', ', 10), count: days.length },
      { daysWithoutSupervisors: days.length },
    ),
  ]
}

/** CMP-NDS-08: NDS says "no risk activities", but eCamp has J+S activities with risk reference. */
export const cmpNds08: RulePredicate = (ctx) => {
  const d = ctx.nds?.campDetails
  if (!ctx.nds || !d || d.riskActivitiesPlanned !== false) return []
  if (ctx.js.status !== 'ok') return []
  const risky = ctx.facts.activities.filter((a) => ctx.js.isJsActivity(a.iri) === true && isRiskActivity(ctx, a))
  if (risky.length === 0) return []
  const stand = formatStand(ctx.nds.fetchedAt)
  return [
    ndsCampHit(
      ctx,
      stand,
      { activities: joinMax(risky.map((a) => a.title), ', ', MAX_LIST), count: risky.length },
      { riskActivitiesPlanned: false, riskActivities: risky.length },
      { redKeys: ['riskActivitiesPlanned'] },
    ),
  ]
}

/** CMP-NDS-09: minimum-requirement messages reported by the NDS itself. */
export const cmpNds09: RulePredicate = (ctx) => {
  const msgs = (ctx.nds?.campDetails?.minimalRequirementsMessages ?? []).map((m) => m.trim()).filter((m) => m !== '')
  if (!ctx.nds || msgs.length === 0) return []
  const stand = formatStand(ctx.nds.fetchedAt)
  return [
    ndsCampHit(ctx, stand, { count: msgs.length, messages: joinMax(msgs, '; ', MAX_LIST) }, { minimalRequirementMessages: msgs.length }),
  ]
}

/** CMP-NDS-10: NDS status flags worth a look (items in correction, approval with reservation, late submission). */
export const cmpNds10: RulePredicate = (ctx) => {
  const d = ctx.nds?.campDetails
  if (!ctx.nds || !d) return []
  const causes: string[] = []
  if (d.offerFlags.itemsInCorrection === true) causes.push('correction')
  if (d.approvalWithReservation === true) causes.push('reservation')
  if (d.lateSubmission === true || d.offerFlags.lateSubmittedItemsUnapproved === true) causes.push('late')
  if (causes.length === 0) return []
  const stand = formatStand(ctx.nds.fetchedAt)
  return [
    ndsCampHit(ctx, stand, {}, { statusFlags: causes.length }, causes.length === 1 ? { variant: causes[0] } : {}),
  ]
}

/** CMP-NDS-11: NDS camp days with activities vs. J+S days computed from eCamp. */
export const cmpNds11: RulePredicate = (ctx) => {
  const days = ctx.nds?.campDetails?.campDaysWithActivities
  if (!ctx.nds || days === null || days === undefined || ctx.js.status !== 'ok') return []
  if (days === ctx.js.jsDayCount) return []
  const stand = formatStand(ctx.nds.fetchedAt)
  return [ndsCampHit(ctx, stand, { nds: days, ecamp: ctx.js.jsDayCount }, { ndsCampDays: days }, { redKeys: ['ndsCampDays'] })]
}

export const predicates: Record<string, RulePredicate> = {
  'CMP-NDS-05': cmpNds05,
  'CMP-NDS-06': cmpNds06,
  'CMP-NDS-07': cmpNds07,
  'CMP-NDS-08': cmpNds08,
  'CMP-NDS-09': cmpNds09,
  'CMP-NDS-10': cmpNds10,
  'CMP-NDS-11': cmpNds11,
}
