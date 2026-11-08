/** Module `js` (J+S Lager allgemein): participants, staff, deadlines, programme basics, coach. Pure predicates of RuleContext. */
import type { IsoDate, RuleContext, RuleHit, RulePredicate } from '@/domain/types'
import { effectiveKeys } from '@/domain/midata'
import { addDays, computeDeadlines, daysBetween, leadTimesFromParams } from '../../../lib/deadlines'
import { campYearOf, countJsAgeByYear, jsBirthYearRange } from '../../../lib/birthYear'
import { isPublicHoliday, weekdayOf } from '../../../lib/holidays'
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

const today = (ctx: RuleContext) => ctx.now.toISOString().slice(0, 10)

// Shared helpers -----------------------------------------------------------------------------

type CountSource = 'midata' | 'coach' | 'coachTotal'

/** J+S-age participants: MiData (Jahrgang logic) > coach J+S-age count > coach total (age unknown). */
function jsAgeParticipants(ctx: RuleContext): { n: number; source: CountSource; stand: string | null } | null {
  const md = ctx.midata
  if (md) {
    const stand = formatStand(md.fetchedAt)
    if (md.participantsByBirthYear) {
      const campYear = campYearOf(ctx.facts.camp.start, ctx.now)
      const n = countJsAgeByYear(md.participantsByBirthYear, campYear, ctx.params.get<number>('js.ageMin'), ctx.params.get<number>('js.ageMax')).inAge
      return { n, source: 'midata', stand }
    }
    return { n: md.participantsJsAgeCount, source: 'midata', stand }
  }
  const jsAge = ctx.coachInputs?.participantsJsAgeCount ?? null
  if (jsAge !== null) return { n: jsAge, source: 'coach', stand: midataStand(ctx, ['participantsJsAgeCount']) }
  const total = ctx.coachInputs?.participantsCount ?? null
  if (total !== null) return { n: total, source: 'coachTotal', stand: midataStand(ctx, ['participantsCount']) }
  return null
}

/** Valid J+S leaders (MiData kind leiterLsT, else coach input). */
function jsLeaders(ctx: RuleContext): { n: number; fromMidata: boolean; stand: string | null } | null {
  const md = ctx.midata
  if (md && md.qualificationsReadable !== false && md.qualificationKinds) {
    const overrides = ctx.settings.midata?.qualMapping ?? {}
    const n = md.qualificationKinds
      .filter((k) => effectiveKeys(k, overrides).includes('leiterLsT'))
      .reduce((sum, k) => sum + k.validLeaders, 0)
    return { n, fromMidata: true, stand: formatStand(md.fetchedAt) }
  }
  const c = ctx.coachInputs?.jsLeadersCount ?? null
  return c !== null ? { n: c, fromMidata: false, stand: null } : null
}

/** Date of the last day with J+S minutes (from the v2 day model), null when unknown. */
function lastJsDay(ctx: RuleContext): IsoDate | null {
  const js = ctx.js
  if (js.status === 'unknown') return null
  for (let i = js.days.length - 1; i >= 0; i--) if (js.days[i].jsMinutes > 0) return js.days[i].date
  return null
}

function deadlineCamp(ctx: RuleContext) {
  const c = ctx.facts.camp
  return { iri: c.iri, title: c.title, start: c.start, end: c.end, lastJsDate: ctx.campConfig.angebot.lastActivityDate ?? lastJsDay(ctx) }
}

/** Closing due date of the NDS offer: (angebot.lastActivityDate ?? last J+S day ?? camp end) + js.ndsClosingDays. */
export function ndsClosingDue(ctx: RuleContext): IsoDate | null {
  return computeDeadlines(deadlineCamp(ctx), ctx.coachInputs, leadTimesFromParams(ctx.params)).find((d) => d.kind === 'nds-closing')?.due ?? null
}

// JS-CAMP-02 ---------------------------------------------------------------------------------

export const jsCamp02: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const min = ctx.params.get<number>('js.minParticipants')
  const ages = { ageMin: ctx.params.get<number>('js.ageMin'), ageMax: ctx.params.get<number>('js.ageMax') }
  const found = jsAgeParticipants(ctx)
  if (!found) return [{ ...campHit(ctx, ages, { severity: 'hint' }), variant: 'missing' }]
  const { n, source, stand } = found
  if (n >= min) return []
  const fromData = source === 'midata' || stand !== null
  const hit = campHit(
    ctx,
    { ...ages, count: n, min, src: stand ? ` (${midataSourceText(stand)})` : '' },
    {
      ...(stand ? { evidence: [midataEvidence(stand)] } : {}),
      ...(source === 'coachTotal' ? { severity: 'should' as const } : {}),
    },
  )
  return [
    {
      ...hit,
      ...(source === 'coachTotal' ? { variant: 'ageUnknown' } : {}),
      inputs: { participants: n, jsAgeCounted: source !== 'coachTotal', requiredParticipants: min },
      ...(fromData ? { redKeys: ['participants'] } : {}),
    },
  ]
}

// JS-STAFF-01 (retired) / JS-STAFF-02 / JS-STAFF-03 --------------------------------------------

/** Retired in v2 (no LS/T ratio exists); the predicate stays only because every YAML needs one. */
export const jsStaff01: RulePredicate = () => []

export const jsStaff02: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const min = ctx.params.get<number>('js.minLeaders')
  const found = jsLeaders(ctx)
  if (!found) return [{ ...campHit(ctx, { min }, { severity: 'hint' }), variant: 'missing' }]
  if (found.n >= min) return []
  return [
    {
      ...campHit(ctx, { count: found.n, min }, found.stand ? { evidence: [midataEvidence(found.stand)] } : {}),
      inputs: { validJsLeaders: found.n, requiredLeaders: min },
      ...(found.fromMidata ? { redKeys: ['validJsLeaders'] } : {}),
    },
  ]
}

export const jsStaff03: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const perLeader = ctx.params.get<number>('js.subsidyGroupSizePerLeader')
  const leaders = jsLeaders(ctx)
  const participants = jsAgeParticipants(ctx)
  if (!leaders || leaders.n <= 0 || !participants) return []
  const max = leaders.n * perLeader
  if (participants.n <= max) return []
  const fromMidata = leaders.fromMidata || participants.source === 'midata'
  return [
    {
      ...campHit(ctx, { participants: participants.n, leaders: leaders.n, max, perLeader }),
      inputs: { participantsJsAge: participants.n, validJsLeaders: leaders.n, maxSubsidised: max },
      ...(fromMidata ? { redKeys: ['participantsJsAge', 'validJsLeaders', 'maxSubsidised'] } : {}),
    },
  ]
}

// JS-EXCL-01 ---------------------------------------------------------------------------------

export const jsExcl01: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const excluded = ctx.keywords.matchActivity('EXCLUDED', a)
    const ww = ctx.keywords.matchActivity('WW_HIGH', a)
    if (excluded.length === 0 && ww.length === 0) continue
    const onlyWw = excluded.length === 0
    // Kanusport exception (Art. 3 Abs. 3 VSpoFöP): an ebb-a tagged activity with only a WW hit is a hint.
    const kanu = onlyWw && ctx.campConfig.tagsOf(a.iri).includes('ebb-a')
    const term = (onlyWw ? ww : excluded)[0].term
    hits.push({
      targets: [a.iri],
      params: { activity: a.title, term },
      ...(onlyWw ? { variant: 'ww' } : {}),
      ...(kanu ? { severity: 'hint' as const } : {}),
      inputs: { term, field: (onlyWw ? ww : excluded)[0].field },
    })
  }
  return hits
}

// JS-AGE-01 ----------------------------------------------------------------------------------

export const jsAge01: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const md = ctx.midata
  if (!md?.participantsByBirthYear) return []
  const ageMin = ctx.params.get<number>('js.ageMin')
  const ageMax = ctx.params.get<number>('js.ageMax')
  const campYear = campYearOf(ctx.facts.camp.start, ctx.now)
  const { outside } = countJsAgeByYear(md.participantsByBirthYear, campYear, ageMin, ageMax)
  if (outside <= 0) return []
  const { fromYear, toYear } = jsBirthYearRange(campYear, ageMin, ageMax)
  const stand = formatStand(md.fetchedAt)
  return [
    {
      ...campHit(ctx, { n: outside, fromYear, toYear }, { evidence: [midataEvidence(stand)] }),
      inputs: { participantsOutsideJsAge: outside, campYear },
      redKeys: ['participantsOutsideJsAge'],
    },
  ]
}

// JS-DL-01..03 -------------------------------------------------------------------------------

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
  const camp = deadlineCamp(ctx)
  const dl = computeDeadlines(camp, ctx.coachInputs, lead).find((d) => d.kind === 'nds-closing')
  if (!dl || !camp.start) return []
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
  const start = ctx.facts.camp.start
  if (!start) return []
  const t = today(ctx)
  // Past the camp start the order is moot.
  if (t > start) return []
  const lead = leadTimesFromParams(ctx.params)
  const inputs = ctx.coachInputs
  const hits: RuleHit[] = []

  const leihDelivery = inputs?.leihmaterialDeliveryDate ?? null
  const leihDue = addDays(leihDelivery ?? start, -lead.leihmaterial)
  if (!(inputs?.leihmaterialOrdered ?? false) && t > leihDue) {
    hits.push({
      targets: [ctx.facts.camp.iri, 'leihmaterial'],
      params: { due: formatDateDe(leihDue) },
      fragments: { detail: [{ variant: 'leihmaterial' }, ...(leihDelivery ? [] : [{ variant: 'noDeliveryDate' }])] },
      inputs: { dueDate: leihDue, leadDays: lead.leihmaterial, deliveryDateKnown: leihDelivery !== null },
    })
  }

  const mapDelivery = inputs?.landeskartenDeliveryDate ?? null
  const base = mapDelivery ?? start
  const mapLead = lead.landeskartenSummerMonths.includes(Number(base.slice(5, 7))) ? lead.landeskartenSummer : lead.landeskarten
  const mapDue = addDays(base, -mapLead)
  if (!(inputs?.landeskartenOrdered ?? false) && t > mapDue) {
    hits.push({
      targets: [ctx.facts.camp.iri, 'landeskarten'],
      params: { due: formatDateDe(mapDue) },
      fragments: { detail: [{ variant: 'landeskarten' }, ...(mapDelivery ? [] : [{ variant: 'noDeliveryDate' }])] },
      inputs: { dueDate: mapDue, leadDays: mapLead, deliveryDateKnown: mapDelivery !== null },
    })
  }
  return hits
}

// JS-DL-04 -----------------------------------------------------------------------------------

export const jsDl04: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const date = ctx.coachInputs?.leihmaterialDeliveryDate ?? null
  if (!date) return []
  const wd = weekdayOf(date)
  const weekend = wd === 0 || wd === 6
  const holiday = !weekend && isPublicHoliday(date, ctx.params.get<string[]>('js.publicHolidays'))
  if (!weekend && !holiday) return []
  return [
    {
      targets: [ctx.facts.camp.iri],
      params: { date: formatDateDe(date) },
      fragments: { weekdayOrHoliday: [{ variant: holiday ? 'holiday' : `weekday${wd}` }] },
      inputs: { deliveryDate: date, weekday: wd },
    },
  ]
}

// JS-DL-05 -----------------------------------------------------------------------------------

export const jsDl05: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const nds = ctx.nds
  if (!nds || nds.campAgendaUploaded !== false) return []
  const end = ctx.facts.camp.end
  const due = ndsClosingDue(ctx)
  if (!end || !due) return []
  const t = today(ctx)
  const severity = t > due ? undefined : t >= end.slice(0, 10) ? ('should' as const) : ('hint' as const)
  return [
    {
      ...campHit(ctx, { due: formatDateDe(due) }, { ...(severity ? { severity } : {}), evidence: [ndsEvidence(formatStand(nds.fetchedAt))] }),
      inputs: { campAgendaUploaded: false, closingDue: due },
      redKeys: ['campAgendaUploaded'],
    },
  ]
}

// JS-DL-06 -----------------------------------------------------------------------------------

interface Outage {
  outageStart: string
  outageEnd: string
  orderBy: string
}

export const jsDl06: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const outage = ctx.params.get<Outage | null>('js.leihmaterialOutage')
  const { start, end } = ctx.facts.camp
  if (!outage || !start || !end) return []
  const delivery = ctx.coachInputs?.leihmaterialDeliveryDate ?? null
  if (ctx.coachInputs?.leihmaterialOrdered !== true && !delivery) return []
  const windowStart = delivery ?? addDays(start, -7)
  const windowEnd = addDays(end, 7)
  if (windowStart > outage.outageEnd || windowEnd < outage.outageStart) return []
  return [
    {
      targets: [ctx.facts.camp.iri],
      params: { outageStart: formatDateDe(outage.outageStart), outageEnd: formatDateDe(outage.outageEnd), orderBy: formatDateDe(outage.orderBy) },
      inputs: { windowStart, windowEnd },
    },
  ]
}

// JS-PROG-01 / JS-PROG-02 --------------------------------------------------------------------

export const jsProg01: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const withEntries = new Set(ctx.facts.scheduleEntries.map((e) => e.dayIri))
  return ctx.facts.days
    .filter((d) => !withEntries.has(d.iri))
    .map((d) => ({ targets: [d.iri], params: { date: formatDateDe(d.date) } }))
}

export const jsProg02: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const titleOf = new Map(ctx.facts.activities.map((a) => [a.iri, a.title]))
  const hits: RuleHit[] = []
  for (const d of ctx.facts.days) {
    const entries = ctx.facts.scheduleEntries.filter((e) => e.dayIri === d.iri)
    if (entries.length === 0) continue
    if (entries.some((e) => ctx.keywords.match('MEAL', titleOf.get(e.activityIri) ?? '').length > 0)) continue
    hits.push({ targets: [d.iri], params: { date: formatDateDe(d.date) } })
  }
  return hits
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
  'JS-DL-04': jsDl04,
  'JS-DL-05': jsDl05,
  'JS-DL-06': jsDl06,
  'JS-STAFF-01': jsStaff01,
  'JS-STAFF-02': jsStaff02,
  'JS-STAFF-03': jsStaff03,
  'JS-EXCL-01': jsExcl01,
  'JS-AGE-01': jsAge01,
  'JS-PROG-01': jsProg01,
  'JS-PROG-02': jsProg02,
  'CMP-CAMP-01': cmpCamp01,
}
