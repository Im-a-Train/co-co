/** Module `js` (J+S Lager allgemein): participants, deadlines, staff, coach. Pure predicates of RuleContext. */
import type { RuleContext, RuleHit, RulePredicate } from '@/domain/types'
import { addDays, computeDeadlines, daysBetween, leadTimesFromParams } from '../../../lib/deadlines'
import { computeJsDays, lastJsDate, thresholdsFromParams } from '../../../lib/jsDays'
import {
  campHit,
  formatDateDe,
  formatStand,
  jsApplies,
  midataEvidence,
  midataSourceText,
  midataStand,
  ndsEvidence,
  ndsSourceText,
  ndsStand,
  normalize,
} from '../../../lib/util'

// JS-CAMP-02 ---------------------------------------------------------------------------------

export const jsCamp02: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const min = ctx.params.get<number>('js.minParticipants')
  const ages = { ageMin: ctx.params.get<number>('js.ageMin'), ageMax: ctx.params.get<number>('js.ageMax') }
  const jsAge = ctx.coachInputs?.participantsJsAgeCount ?? null
  const n = jsAge ?? ctx.coachInputs?.participantsCount ?? null
  if (n === null) return [{ ...campHit(ctx, ages, { severity: 'hint' }), variant: 'missing' }]
  if (n >= min) return []
  const stand = midataStand(ctx, jsAge !== null ? ['participantsJsAgeCount'] : ['participantsCount'])
  const hit = campHit(
    ctx,
    { ...ages, count: n, min, src: stand ? ` (${midataSourceText(stand)})` : '' },
    stand ? { evidence: [midataEvidence(stand)] } : {},
  )
  return [
    {
      ...hit,
      inputs: { participants: n, jsAgeCounted: jsAge !== null, requiredParticipants: min },
      ...(stand ? { redKeys: ['participants'] } : {}),
    },
  ]
}

// JS-DL-01..03 -------------------------------------------------------------------------------

function deadlineCamp(ctx: RuleContext) {
  const c = ctx.facts.camp
  const lastJs = ctx.mapping ? lastJsDate(computeJsDays(ctx.facts, ctx.mapping, thresholdsFromParams(ctx.params))) : null
  return { iri: c.iri, title: c.title, start: c.start, end: c.end, lastJsDate: lastJs }
}

const today = (ctx: RuleContext) => ctx.now.toISOString().slice(0, 10)

export const jsDl01: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const lead = leadTimesFromParams(ctx.params)
  const dl = computeDeadlines(deadlineCamp(ctx), ctx.coachInputs, lead).find((d) => d.kind === 'nds-registration')
  if (!dl) return []
  const t = today(ctx)
  const on = ctx.coachInputs?.ndsRegisteredOn ?? null
  const stand = ndsStand(ctx, ['ndsRegistered', 'ndsRegisteredOn'])
  const src = stand ? { evidence: [ndsEvidence(stand)] } : {}
  const q = stand ? ` (${ndsSourceText(stand)})` : ''
  const due = formatDateDe(dl.due)
  if (dl.done) {
    // An NDS-adopted date is only the approval date («bewilligt am»); registration happened on or before it, so lateness cannot be concluded.
    const fromNds = !!ctx.coachInputs?.ndsFields?.ndsRegisteredOn
    if (on && on > dl.due && !fromNds) return [{ ...campHit(ctx, { on: formatDateDe(on), due, src: q }, src), variant: 'late' }]
    return []
  }
  if (t > dl.due) return [campHit(ctx, { due, src: q }, src)]
  const left = daysBetween(t, dl.due)
  if (left <= lead.soonDays) {
    return [{ ...campHit(ctx, { due, left, src: q }, { severity: 'hint', ...src }), variant: left === 1 ? 'soonOne' : 'soonMany' }]
  }
  return []
}

export const jsDl02: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const lead = leadTimesFromParams(ctx.params)
  const dl = computeDeadlines(deadlineCamp(ctx), ctx.coachInputs, lead).find((d) => d.kind === 'nds-closing')
  const start = ctx.facts.camp.start
  if (!dl || !start) return []
  const t = today(ctx)
  const on = ctx.coachInputs?.ndsClosedOn ?? null
  const stand = ndsStand(ctx, ['ndsClosed'])
  const src = stand ? { evidence: [ndsEvidence(stand)] } : {}
  const q = stand ? ` (${ndsSourceText(stand)})` : ''
  const due = formatDateDe(dl.due)
  if (dl.done) {
    if (on && on > dl.due) return [{ ...campHit(ctx, { on: formatDateDe(on), due, src: q }, src), variant: 'late' }]
    return []
  }
  const lastDay = addDays(dl.due, -lead.ndsClosing)
  if (t > dl.due) return [campHit(ctx, { due, src: q }, src)]
  if (t >= lastDay && daysBetween(t, dl.due) <= lead.soonDays) {
    return [{ ...campHit(ctx, { due, src: q }, { severity: 'hint', ...src }), variant: 'soon' }]
  }
  return []
}

export const jsDl03: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const t = today(ctx)
  const hits: RuleHit[] = []
  for (const dl of computeDeadlines(deadlineCamp(ctx), ctx.coachInputs, leadTimesFromParams(ctx.params))) {
    if (dl.kind !== 'leihmaterial' && dl.kind !== 'landeskarten') continue
    if (dl.done || t <= dl.due) continue
    // Past the camp start the order is moot.
    if (ctx.facts.camp.start && t > ctx.facts.camp.start) continue
    hits.push({ targets: [ctx.facts.camp.iri, dl.kind], params: { due: formatDateDe(dl.due) }, variant: dl.kind })
  }
  return hits
}

// JS-STAFF-01 (retired by catalog v2; kept as is until JS-STAFF-02/03 replace it) ------------

/** Not in params.yaml: the rule is retired in v2 (no LS/T ratio exists). */
export const MAX_PARTICIPANTS_PER_LEADER = 10

export const jsStaff01: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const minLeaders = ctx.params.get<number>('js.minLeaders')
  const p = ctx.coachInputs?.participantsCount ?? null
  const l = ctx.coachInputs?.leadersCount ?? null
  if (p === null || l === null) return []
  const needed = Math.max(minLeaders, Math.ceil(p / MAX_PARTICIPANTS_PER_LEADER))
  if (l >= needed) return []
  const midataFields = ctx.coachInputs?.midataFields
  const fromMidata = !!(midataFields?.participantsCount || midataFields?.leadersCount)
  return [
    {
      ...campHit(ctx, { participants: p, leaders: l, needed }),
      inputs: {
        participants: p,
        leaders: l,
        neededLeaders: needed,
        maxParticipantsPerLeader: MAX_PARTICIPANTS_PER_LEADER,
        minLeaders,
      },
      ...(fromMidata
        ? { redKeys: [...(midataFields?.participantsCount ? ['participants'] : []), ...(midataFields?.leadersCount ? ['leaders'] : [])] }
        : {}),
    },
  ]
}

// CMP-CAMP-01 --------------------------------------------------------------------------------

function nameTokens(name: string): string[] {
  return normalize(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
}

/** True if coach name and user name share at least one name token (nickname, first or last name). */
export function coachNameMatches(coachName: string, userName: string): boolean {
  const a = nameTokens(coachName)
  const b = nameTokens(userName)
  return a.some((t) => b.includes(t))
}

export const cmpCamp01: RulePredicate = (ctx) => {
  const parts: NonNullable<RuleHit['fragments']>[string] = []
  const evidence: RuleHit['evidence'] = []
  const coach = (ctx.facts.camp.coachName ?? '').trim()
  if (!coach) parts.push({ variant: 'noCoach' })
  else if (ctx.userDisplayName && !coachNameMatches(coach, ctx.userDisplayName)) {
    parts.push({ variant: 'otherCoach', params: { coach, user: ctx.userDisplayName } })
  }
  if (ctx.midata?.coachMatch === false) {
    const stand = formatStand(ctx.midata.fetchedAt)
    const who = ctx.midata.coachNickname?.trim()
    parts.push(who ? { variant: 'midataOther', params: { who, stand } } : { variant: 'midataUnknown', params: { stand } })
    evidence.push(midataEvidence(stand))
  }
  if (parts.length === 0) return []
  return [{ targets: [ctx.facts.camp.iri], fragments: { detail: parts }, ...(evidence.length ? { evidence } : {}) }]
}

export const predicates: Record<string, RulePredicate> = {
  'JS-CAMP-02': jsCamp02,
  'JS-DL-01': jsDl01,
  'JS-DL-02': jsDl02,
  'JS-DL-03': jsDl03,
  'JS-STAFF-01': jsStaff01,
  'CMP-CAMP-01': cmpCamp01,
}
