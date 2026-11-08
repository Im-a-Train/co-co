/** Cross-source consistency rules (eCamp / MiData / NDS; group 'completeness'). Pure predicates of RuleContext. */
import type { CollaboratorFact, MidataQualKey, NdsAggregate, RuleContext, RuleHit, RulePredicate } from '@/domain/types'
import { effectiveKeys, midataDateRange, normalizeName } from '@/domain/midata'
import { participantsDiffer } from '@/domain/nds'
import { daysBetween } from '../../../deadlines'
import { formatDateDe, formatStand, midataEvidence, midataSourceText, ndsEvidence, ndsSourceText } from './util'

const MAX_NAMES = 10

function names(list: string[]): string {
  const shown = list
    .slice(0, MAX_NAMES)
    .map((n) => `«${n}»`)
    .join(', ')
  return list.length > MAX_NAMES ? `${shown} +${list.length - MAX_NAMES}` : shown
}

const campHit = (
  ctx: RuleContext,
  message: string,
  evidence: RuleHit['evidence'],
  stand?: string,
  inputs?: RuleHit['inputs'],
  redKeys?: string[],
): RuleHit => ({
  targets: [ctx.facts.camp.iri],
  params: { _message: message, ...(stand ? { stand } : {}) },
  evidence,
  ...(inputs ? { inputs, redKeys: redKeys ?? Object.keys(inputs) } : {}),
})

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
  const range = midataDateRange(md, start, end ?? start)
  if (!range) return []
  if (range.start === nds.start.slice(0, 10) && range.end === nds.end.slice(0, 10)) return []
  const sm = formatStand(md.fetchedAt)
  const sn = formatStand(nds.fetchedAt)
  const msg = `Die Lagerdaten in MiData (${formatDateDe(range.start)}–${formatDateDe(range.end)}) und NDS (${formatDateDe(nds.start)}–${formatDateDe(nds.end)}) stimmen nicht überein (${midataSourceText(sm)}; ${ndsSourceText(sn)})`
  return [
    campHit(ctx, msg, [midataEvidence(sm), ndsEvidence(sn)], undefined, {
      midataStart: range.start,
      midataEnd: range.end,
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
  const msg = `Die Anzahl Leitende stimmt zwischen den Quellen nicht überein: ${parts.map((p) => `${p.label} ${p.n}`).join(', ')}${src.length ? ` (${src.join('; ')})` : ''}`
  const counts: Record<string, number> = {}
  for (const p of parts) counts[`${p.label.toLowerCase()}Leaders`] = p.n
  return [campHit(ctx, msg, evidence, undefined, counts, Object.keys(counts).filter((k) => !k.startsWith('ecamp')))]
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
  const parts: string[] = []
  if (onlyEcamp.length) parts.push(`In eCamp, aber nicht in MiData: ${names(onlyEcamp)}`)
  if (onlyMidata.length) parts.push(`In MiData, aber nicht in eCamp: ${names(onlyMidata)}`)
  return [
    campHit(
      ctx,
      `${parts.join('. ')} (Abgleich über Namen, ${midataSourceText(stand)})`,
      [midataEvidence(stand)],
      stand,
      {
        ecampTeam: team.length,
        midataLeaders: md.leaders.length,
        matchedByName: matched.length,
        onlyInEcamp: onlyEcamp.length,
        onlyInMidata: onlyMidata.length,
      },
      ['midataLeaders', 'matchedByName', 'onlyInEcamp', 'onlyInMidata'],
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
  const msg = `In der NDS sind ${planned} J+S-Leitende geplant, in MiData haben nur ${valid} eine über die ganze Lagerdauer gültige Anerkennung (${midataSourceText(sm)}; ${ndsSourceText(sn)})`
  return [
    campHit(ctx, msg, [midataEvidence(sm), ndsEvidence(sn)], undefined, {
      ndsPlannedJsLeaders: planned,
      midataValidLeaders: valid,
    }),
  ]
}

// CMP-CON-05 ---------------------------------------------------------------------------------

const RECOGNITION_KEYS: readonly MidataQualKey[] = ['leiterLsT', 'lagerleiter', 'wasser', 'berg', 'winter', 'slrg']

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
  const list = rows.map((k) => `${k.label}: ${k.expiredLeaders} Leitende`).join('; ')
  const msg = `Folgende Anerkennungen sind nicht für die ganze Lagerdauer gültig (vor oder während des Lagers abgelaufen): ${list} (${midataSourceText(stand)})`
  return [
    campHit(ctx, msg, [midataEvidence(stand)], stand, {
      qualificationKindsExpired: rows.length,
      leadersExpired: rows.reduce((n, k) => n + k.expiredLeaders, 0),
    }),
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
    campHit(ctx, `In MiData ist keine Hauptleitung eingetragen (${midataSourceText(stand)})`, [midataEvidence(stand)], stand, {
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
  return [campHit(ctx, `In der NDS sind ${planned} Lagertage geplant, in eCamp ${days} (${ndsSourceText(stand)})`, [ndsEvidence(stand)], stand, {
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
      `In MiData sind ${md.participantsCount} Teilnehmende angemeldet, die Höchstzahl beträgt ${max} (${midataSourceText(stand)})`,
      [midataEvidence(stand)],
      stand,
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
      `Bei ${n} Teilnehmenden fehlt in MiData das Geburtsdatum: das J+S-Alter (5–20 Jahre) kann nicht geprüft werden (${midataSourceText(stand)})`,
      [midataEvidence(stand)],
      stand,
      { participantsWithoutBirthday: n, midataParticipants: md.participantsCount },
    ),
  ]
}

// CMP-CON-10 ---------------------------------------------------------------------------------

/** NDS registered participants vs. MiData participants: more than 20 % apart. */
export const cmpCon10: RulePredicate = (ctx) => {
  const { midata: md, nds } = ctx
  if (!md || !nds || !(nds.participantCount > 0)) return []
  if (!participantsDiffer(nds.participantCount, md.participantsCount)) return []
  const sm = formatStand(md.fetchedAt)
  const sn = formatStand(nds.fetchedAt)
  const msg = `In der NDS sind ${nds.participantCount} Teilnehmende erfasst, in MiData ${md.participantsCount}: Abweichung über 20 % (${ndsSourceText(sn)}; ${midataSourceText(sm)})`
  return [
    campHit(ctx, msg, [ndsEvidence(sn), midataEvidence(sm)], undefined, {
      ndsParticipants: nds.participantCount,
      midataParticipants: md.participantsCount,
      tolerancePercent: 20,
    }),
  ]
}
