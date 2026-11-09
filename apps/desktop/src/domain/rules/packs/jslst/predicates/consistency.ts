/** Module `js`, data consistency (eCamp / MiData / NDS): CMP-CON-*, CMP-MD-01, CMP-NDS-*. Pure predicates of RuleContext. */
import type { CollaboratorFact, MidataQualKey, NdsAggregate, RuleContext, RuleHit, RulePredicate } from '@/domain/types'
import { datesDiffer, effectiveKeys, locationDiffers, midataDateRange, normalizeName } from '@/domain/midata'
import { ndsDatesDiffer, participantsDiffer } from '@/domain/nds'
import { daysBetween } from '../../../lib/deadlines'
import { formatDateDe, formatStand, midataEvidence, midataSourceText, ndsEvidence, ndsSourceText } from '../../../lib/util'

const MAX_NAMES = 10

function names(list: string[]): string {
  const shown = list
    .slice(0, MAX_NAMES)
    .map((n) => `«${n}»`)
    .join(', ')
  return list.length > MAX_NAMES ? `${shown} +${list.length - MAX_NAMES}` : shown
}

/** Camp hit; the message comes from the rule YAML filled with `params`. */
const campHit = (
  ctx: RuleContext,
  params: Record<string, string | number>,
  evidence: RuleHit['evidence'],
  inputs?: RuleHit['inputs'],
  redKeys?: string[],
  extra: Partial<RuleHit> = {},
): RuleHit => ({
  targets: [ctx.facts.camp.iri],
  params,
  evidence,
  ...(inputs ? { inputs, redKeys: redKeys ?? Object.keys(inputs) } : {}),
  ...extra,
})

const range = (a: string, b: string) => `${formatDateDe(a)}–${formatDateDe(b)}`

/** Active eCamp collaborators working in the team (no guests, no open invitations). */
export function activeCollaborators(ctx: RuleContext): CollaboratorFact[] {
  return ctx.facts.collaborators.filter((c) => c.status === 'established' && (c.role === 'member' || c.role === 'manager'))
}

/** NDS planned leader count (statistics, else sum of the supervisor counts); null if unknown. */
function ndsLeaderCount(nds: NdsAggregate): number | null {
  const t = nds.statistics.planned.totalInstructors
  if (t !== null && t !== undefined) return t
  const vals = Object.values(nds.supervisorCounts ?? {})
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null
}

// CMP-CON-01 ---------------------------------------------------------------------------------

/** MiData event dates vs. NDS camp dates (date part only). */
export const cmpCon01: RulePredicate = (ctx) => {
  const { midata: md, nds } = ctx
  const { start, end } = ctx.facts.camp
  if (!md || !nds || !nds.start || !nds.end || !start) return []
  const r = midataDateRange(md, start, end ?? start)
  if (!r) return []
  if (r.start === nds.start.slice(0, 10) && r.end === nds.end.slice(0, 10)) return []
  const sm = formatStand(md.fetchedAt)
  const sn = formatStand(nds.fetchedAt)
  const params = { midata: range(r.start, r.end), nds: range(nds.start, nds.end), midataStand: sm, ndsStand: sn }
  return [
    campHit(ctx, params, [midataEvidence(sm), ndsEvidence(sn)], {
      midataStart: r.start,
      midataEnd: r.end,
      ndsStart: nds.start.slice(0, 10),
      ndsEnd: nds.end.slice(0, 10),
    }),
  ]
}

// CMP-CON-02 ---------------------------------------------------------------------------------

/** Leader counts of eCamp, MiData and NDS (those present) disagree. */
export const cmpCon02: RulePredicate = (ctx) => {
  const md = ctx.midata
  const nds = ctx.nds
  const ecamp = activeCollaborators(ctx).length
  const parts: { label: string; n: number }[] = []
  if (ecamp > 0) parts.push({ label: 'eCamp', n: ecamp })
  if (md) parts.push({ label: 'MiData', n: md.leadersCount })
  const ndsN = nds ? ndsLeaderCount(nds) : null
  if (nds && ndsN !== null) parts.push({ label: 'NDS', n: ndsN })
  if (parts.length < 2 || parts.every((p) => p.n === parts[0].n)) return []
  const evidence: NonNullable<RuleHit['evidence']> = []
  const src: string[] = []
  if (md) {
    const s = formatStand(md.fetchedAt)
    src.push(midataSourceText(s))
    evidence.push(midataEvidence(s))
  }
  if (nds && ndsN !== null) {
    const s = formatStand(nds.fetchedAt)
    src.push(ndsSourceText(s))
    evidence.push(ndsEvidence(s))
  }
  const params = { counts: parts.map((p) => `${p.label} ${p.n}`).join(', '), src: src.length ? ` (${src.join('; ')})` : '' }
  const counts: Record<string, number> = {}
  for (const p of parts) counts[`${p.label.toLowerCase()}Leaders`] = p.n
  return [campHit(ctx, params, evidence, counts, Object.keys(counts).filter((k) => !k.startsWith('ecamp')))]
}

// CMP-CON-03 ---------------------------------------------------------------------------------

/** Heuristic name match eCamp team <-> MiData leaders. */
export const cmpCon03: RulePredicate = (ctx) => {
  const md = ctx.midata
  if (!md || md.leaders.length === 0) return []
  const team = activeCollaborators(ctx)
  if (team.length === 0) return []
  const leaderNorms = new Set(md.leaders.map((l) => normalizeName(l.nickname)).filter(Boolean))
  const keysOf = (c: CollaboratorFact) => [c.displayName, c.nickname ?? ''].map(normalizeName).filter(Boolean)
  const ecampNorms = new Set(team.flatMap(keysOf))
  const matched = team.filter((c) => keysOf(c).some((k) => leaderNorms.has(k)))
  if (matched.length === 0) return [] // matching unreliable (e.g. real names in eCamp, nicknames in MiData)
  const onlyEcamp = team.filter((c) => !keysOf(c).some((k) => leaderNorms.has(k))).map((c) => c.displayName)
  const onlyMidata = md.leaders.filter((l) => !ecampNorms.has(normalizeName(l.nickname))).map((l) => l.nickname)
  if (onlyEcamp.length === 0 && onlyMidata.length === 0) return []
  const stand = formatStand(md.fetchedAt)
  const parts: NonNullable<RuleHit['fragments']>[string] = []
  if (onlyEcamp.length) parts.push({ variant: 'onlyEcamp', params: { names: names(onlyEcamp) } })
  if (onlyMidata.length) parts.push({ variant: 'onlyMidata', params: { names: names(onlyMidata) } })
  return [
    campHit(
      ctx,
      { stand },
      [midataEvidence(stand)],
      {
        ecampTeam: team.length,
        midataLeaders: md.leaders.length,
        matchedByName: matched.length,
        onlyInEcamp: onlyEcamp.length,
        onlyInMidata: onlyMidata.length,
      },
      ['midataLeaders', 'matchedByName', 'onlyInEcamp', 'onlyInMidata'],
      { fragments: { parts } },
    ),
  ]
}

// CMP-CON-04 ---------------------------------------------------------------------------------

/** NDS planned J+S leaders vs. MiData leaders with a leader qualification. */
export const cmpCon04: RulePredicate = (ctx) => {
  const { midata: md, nds } = ctx
  if (!md || !nds || md.qualificationsReadable === false || md.leaders.length === 0) return []
  const planned = nds.statistics.planned.jsInstructors
  if (planned === null || planned === undefined) return []
  const valid = md.leaders.filter((l) => l.qualifications.leiterLsT || l.qualifications.lagerleiter).length
  if (planned <= valid) return []
  const sm = formatStand(md.fetchedAt)
  const sn = formatStand(nds.fetchedAt)
  return [
    campHit(ctx, { planned, valid, midataStand: sm, ndsStand: sn }, [midataEvidence(sm), ndsEvidence(sn)], {
      ndsPlannedJsLeaders: planned,
      midataValidLeaders: valid,
    }),
  ]
}

// CMP-CON-05 ---------------------------------------------------------------------------------

/** MiData qualification keys whose expiry matters (data, not keywords). */
const RECOGNITION_KEYS: readonly MidataQualKey[] = ['leiterLsT', 'lagerleiter', 'wasser', 'berg', 'winter', 'slrg', 'sbBerg', 'sbWasser', 'sbWinter']

/** MiData recognitions that expired (before or during the camp) for relevant qualification kinds. */
export const cmpCon05: RulePredicate = (ctx) => {
  const md = ctx.midata
  if (!md || md.qualificationsReadable === false || !md.qualificationKinds) return []
  const overrides = ctx.settings.midata?.qualMapping ?? {}
  const rows = md.qualificationKinds.filter(
    (k) => k.expiredLeaders > 0 && effectiveKeys(k, overrides).some((key) => RECOGNITION_KEYS.includes(key)),
  )
  if (rows.length === 0) return []
  const stand = formatStand(md.fetchedAt)
  const list = rows.map((k) => ({ variant: 'item', params: { label: k.label, count: k.expiredLeaders } }))
  return [
    campHit(
      ctx,
      { stand },
      [midataEvidence(stand)],
      { qualificationKindsExpired: rows.length, leadersExpired: rows.reduce((n, k) => n + k.expiredLeaders, 0) },
      undefined,
      { fragments: { list } },
    ),
  ]
}

// CMP-CON-06 ---------------------------------------------------------------------------------

/** MiData has no main leader (only judged when the aggregate carries the mainLeader field). */
export const cmpCon06: RulePredicate = (ctx) => {
  const md = ctx.midata
  if (!md || !md.leaders.some((l) => l.mainLeader !== undefined)) return []
  if (md.leaders.some((l) => l.mainLeader === true)) return []
  const stand = formatStand(md.fetchedAt)
  return [
    campHit(ctx, { stand }, [midataEvidence(stand)], {
      midataLeaders: md.leaders.length,
      mainLeaders: 0,
    }),
  ]
}

// CMP-CON-07 ---------------------------------------------------------------------------------

/** NDS planned camp days vs. eCamp camp days. */
export const cmpCon07: RulePredicate = (ctx) => {
  const nds = ctx.nds
  const planned = nds?.statistics.planned.campDays
  if (!nds || planned === null || planned === undefined) return []
  const { start, end } = ctx.facts.camp
  const days =
    ctx.facts.days.length > 0 ? ctx.facts.days.length : start && end ? daysBetween(start.slice(0, 10), end.slice(0, 10)) + 1 : 0
  if (days <= 0 || days === planned) return []
  const stand = formatStand(nds.fetchedAt)
  return [campHit(ctx, { planned, days, stand }, [ndsEvidence(stand)], {
      ndsPlannedDays: planned,
      ecampDays: days,
    }, ['ndsPlannedDays']),
  ]
}

// CMP-CON-08 ---------------------------------------------------------------------------------

/** MiData participants exceed the maximum. */
export const cmpCon08: RulePredicate = (ctx) => {
  const md = ctx.midata
  const max = md?.maximumParticipants
  if (!md || !max || max <= 0 || md.participantsCount <= max) return []
  const stand = formatStand(md.fetchedAt)
  return [
    campHit(
      ctx,
      { participants: md.participantsCount, max, stand },
      [midataEvidence(stand)],
      { midataParticipants: md.participantsCount, midataMaximum: max },
    ),
  ]
}

// CMP-CON-09 ---------------------------------------------------------------------------------

/** Participants without birthday: J+S age cannot be verified. */
export const cmpCon09: RulePredicate = (ctx) => {
  const md = ctx.midata
  const n = md?.participantsWithoutBirthday ?? 0
  if (!md || !(n > 0)) return []
  const stand = formatStand(md.fetchedAt)
  return [
    campHit(
      ctx,
      { count: n, ageMin: ctx.params.get<number>('js.ageMin'), ageMax: ctx.params.get<number>('js.ageMax'), stand },
      [midataEvidence(stand)],
      { participantsWithoutBirthday: n, midataParticipants: md.participantsCount },
    ),
  ]
}

// CMP-CON-10 ---------------------------------------------------------------------------------

/** NDS registered participants vs. MiData participants: more than 20 % apart. */
export const cmpCon10: RulePredicate = (ctx) => {
  const { midata: md, nds } = ctx
  if (!md || !nds || !(nds.participantCount > 0)) return []
  const tolerance = ctx.params.get<number>('js.participantsDiffTolerance')
  if (!participantsDiffer(nds.participantCount, md.participantsCount, tolerance)) return []
  const sm = formatStand(md.fetchedAt)
  const sn = formatStand(nds.fetchedAt)
  const tolerancePercent = Math.round(tolerance * 100)
  return [
    campHit(
      ctx,
      { nds: nds.participantCount, midata: md.participantsCount, tolerancePercent, ndsStand: sn, midataStand: sm },
      [ndsEvidence(sn), midataEvidence(sm)],
      { ndsParticipants: nds.participantCount, midataParticipants: md.participantsCount, tolerancePercent },
    ),
  ]
}

// CMP-MD-01 ----------------------------------------------------------------------------------

/** eCamp camp dates vs. MiData event dates (earliest start, latest finish, date part only). */
export const cmpMd01: RulePredicate = (ctx) => {
  const md = ctx.midata
  const { start, end } = ctx.facts.camp
  if (!md || !start || !end) return []
  const r = midataDateRange(md, start, end)
  const datesOff = datesDiffer(md, start, end)
  const a = ctx.facts.camp.address
  const placeOff = locationDiffers(md.location, [a?.city, a?.name])
  if (!datesOff && !placeOff) return []
  const stand = formatStand(md.fetchedAt)
  const diffs: NonNullable<RuleHit['fragments']>[string] = []
  if (datesOff && r) diffs.push({ variant: 'dates', params: { ecamp: range(start, end), midata: range(r.start, r.end) } })
  if (placeOff) diffs.push({ variant: 'place', params: { ecampPlace: a?.city ?? a?.name ?? '', midataPlace: md.location ?? '' } })
  return [
    {
      targets: [ctx.facts.camp.iri],
      params: { stand },
      fragments: { diffs },
      evidence: [midataEvidence(stand)],
      inputs: { datesDiffer: datesOff, placeDiffers: placeOff, midataStart: r?.start ?? null, midataEnd: r?.end ?? null },
      redKeys: ['midataStart', 'midataEnd'],
    },
  ]
}

// CMP-NDS-01..03 -----------------------------------------------------------------------------

/** eCamp camp dates vs. NDS camp dates (date part only). */
export const cmpNds01: RulePredicate = (ctx) => {
  const nds = ctx.nds
  const { start, end } = ctx.facts.camp
  if (!nds || !start || !end || !ndsDatesDiffer(nds, start, end)) return []
  const stand = formatStand(nds.fetchedAt)
  return [
    {
      targets: [ctx.facts.camp.iri],
      params: { ecamp: range(start, end), nds: range(nds.start ?? '', nds.end ?? ''), stand },
      evidence: [ndsEvidence(stand)],
      inputs: { ndsStart: nds.start, ndsEnd: nds.end, ecampStart: start.slice(0, 10), ecampEnd: end.slice(0, 10) },
      redKeys: ['ndsStart', 'ndsEnd'],
    },
  ]
}

/** After the camp: activities in NDS whose attendance check (AWK) is still open. */
export const cmpNds02: RulePredicate = (ctx) => {
  const nds = ctx.nds
  const end = ctx.facts.camp.end ?? nds?.end ?? null
  if (!nds || !end) return []
  if (ctx.now.toISOString().slice(0, 10) <= end.slice(0, 10)) return []
  const open = nds.activities.attendanceOpenCount
  if (!(open > 0)) return []
  const stand = formatStand(nds.fetchedAt)
  return [
    {
      targets: [ctx.facts.camp.iri],
      params: { count: open, stand },
      ...(open === 1 ? { variant: 'one' } : {}),
      evidence: [ndsEvidence(stand)],
      inputs: { attendanceOpenCount: open },
      redKeys: ['attendanceOpenCount'],
    },
  ]
}

/** NDS planned participants vs. MiData (preferred) or coach-input participant count: more than the tolerance apart. */
export const cmpNds03: RulePredicate = (ctx) => {
  const nds = ctx.nds
  if (!nds) return []
  const tolerance = ctx.params.get<number>('js.participantsDiffTolerance')
  const planned = nds.statistics.planned.totalParticipants
  const md = ctx.midata?.participantsCount ?? null
  const mine = md ?? ctx.coachInputs?.participantsCount ?? null
  if (!participantsDiffer(planned, mine, tolerance)) return []
  const stand = formatStand(nds.fetchedAt)
  const params = { planned: planned ?? 0, mine: mine ?? 0, tolerancePercent: Math.round(tolerance * 100), stand }
  return [
    {
      targets: [ctx.facts.camp.iri],
      params: md !== null ? { ...params, midataStand: formatStand(ctx.midata!.fetchedAt) } : params,
      ...(md === null ? { variant: 'coach' } : {}),
      evidence: [ndsEvidence(stand)],
      inputs: { ndsPlanned: planned ?? 0, participants: mine ?? 0, tolerance },
      redKeys: md !== null ? ['ndsPlanned', 'participants'] : ['ndsPlanned'],
    },
  ]
}

export const predicates: Record<string, RulePredicate> = {
  'CMP-CON-01': cmpCon01,
  'CMP-CON-02': cmpCon02,
  'CMP-CON-03': cmpCon03,
  'CMP-CON-04': cmpCon04,
  'CMP-CON-05': cmpCon05,
  'CMP-CON-06': cmpCon06,
  'CMP-CON-07': cmpCon07,
  'CMP-CON-08': cmpCon08,
  'CMP-CON-09': cmpCon09,
  'CMP-CON-10': cmpCon10,
  'CMP-MD-01': cmpMd01,
  'CMP-NDS-01': cmpNds01,
  'CMP-NDS-02': cmpNds02,
  'CMP-NDS-03': cmpNds03,
}
