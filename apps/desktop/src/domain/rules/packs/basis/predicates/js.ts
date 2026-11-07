/** J+S core rules (group 'js'). Pure predicates of RuleContext. */
import type { ActivityFact, RuleContext, RuleHit, RulePredicate } from '@/domain/types'
import { addDays, computeDeadlines, daysBetween } from '../../../deadlines'
import {
  computeJsDays,
  hasJsMapping,
  lastJsDate,
  quantityOk,
  sortedDays,
  trainingFreeDays,
  type JsDayReport,
} from '../../../jsDays'
import { activityEvidence, campEvidence, campHit, formatDateDe, jsApplies, matchKeywords, plural, type KeywordSet } from './util'

const report = (ctx: RuleContext): JsDayReport => computeJsDays(ctx.facts, ctx.mapping)

/** Rules about J+S days need a mapping with at least one LS/LA category. */
const dayReady = (ctx: RuleContext) => jsApplies(ctx) && hasJsMapping(ctx.mapping)

const activityOf = (ctx: RuleContext, iri: string): ActivityFact | undefined => ctx.facts.activities.find((a) => a.iri === iri)

// JS-CAMP-01 ---------------------------------------------------------------------------------

export const jsCamp01: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const days = sortedDays(ctx.facts)
  if (days.length === 0) return []
  let longest = 1
  let run = 1
  for (let i = 1; i < days.length; i++) {
    run = daysBetween(days[i - 1].date, days[i].date) === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
  }
  if (days.length === 1) longest = 1
  return longest >= 4 ? [] : [campHit(ctx, { days: longest }, { evidence: [campEvidence(ctx.facts)] })]
}

// JS-CAMP-02 ---------------------------------------------------------------------------------

export const jsCamp02: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const n = ctx.coachInputs?.participantsJsAgeCount ?? ctx.coachInputs?.participantsCount ?? null
  if (n === null) {
    return [campHit(ctx, { detail: 'Angabe fehlt (bitte unter «Angaben» erfassen)' }, { severity: 'hint' })]
  }
  return n >= 12 ? [] : [campHit(ctx, { detail: `nur ${n} angegeben, nötig sind mindestens 12` })]
}

// JS-DAY-01 ----------------------------------------------------------------------------------

export const jsDay01: RulePredicate = (ctx) => {
  if (!jsApplies(ctx) || ctx.mapping === null) return []
  if (!hasJsMapping(ctx.mapping)) {
    return [campHit(ctx, { _message: 'Keine Kategorie ist als Lagersport oder Lageraktivität zugeordnet: J+S-Tage können nicht berechnet werden.' }, { severity: 'hint' })]
  }
  const r = report(ctx)
  const n = r.days.length
  const hits: RuleHit[] = []
  r.days.forEach((d, i) => {
    // First/last day of a multi-day camp are judged by JS-DAY-04 (arrival/departure combination).
    if (n > 1 && (i === 0 || i === n - 1)) return
    if (d.unitCount === 0) return // training-free day, see JS-FREE-01
    if (quantityOk(d)) return
    hits.push({
      targets: [d.dayIri],
      params: { day: d.number, units: d.unitCount, minutes: d.jsMinutes },
      evidence: d.units.map((u) => {
        const a = activityOf(ctx, u.activityIri)
        return a ? activityEvidence(a, `${u.minutes} Min.`) : { kind: 'scheduleEntry' as const, iri: u.scheduleEntryIri, label: u.scheduleEntryIri }
      }),
    })
  })
  return hits
}

// JS-DAY-02 ----------------------------------------------------------------------------------

export const jsDay02: RulePredicate = (ctx) => {
  if (!dayReady(ctx)) return []
  const hits: RuleHit[] = []
  for (const d of report(ctx).days) {
    for (const u of d.units) {
      if (u.longEnough) continue
      const a = activityOf(ctx, u.activityIri)
      hits.push({
        targets: [u.scheduleEntryIri],
        params: { day: d.number, title: a?.title ?? '?', minutes: u.minutes },
        evidence: a ? [activityEvidence(a, `${u.minutes} Min.`)] : [],
      })
    }
  }
  return hits
}

// JS-DAY-03 ----------------------------------------------------------------------------------

export const jsDay03: RulePredicate = (ctx) => {
  if (!dayReady(ctx)) return []
  const hits: RuleHit[] = []
  for (const d of report(ctx).days) {
    const bad = d.gaps.filter((g) => !g.ok)
    if (bad.length === 0) continue
    const shortest = Math.min(...bad.map((g) => g.minutes))
    hits.push({
      targets: [d.dayIri],
      params: { day: d.number, count: bad.length, minutes: shortest },
      evidence: d.units.map((u) => {
        const a = activityOf(ctx, u.activityIri)
        return a ? activityEvidence(a, `${u.start.slice(11, 16)}–${u.end.slice(11, 16)}`) : { kind: 'scheduleEntry' as const, iri: u.scheduleEntryIri, label: u.scheduleEntryIri }
      }),
    })
  }
  return hits
}

// JS-DAY-04 ----------------------------------------------------------------------------------

export const jsDay04: RulePredicate = (ctx) => {
  if (!dayReady(ctx)) return []
  const r = report(ctx)
  if (r.days.length < 2) return []
  const first = r.days[0]
  const last = r.days[r.days.length - 1]
  if ((first.valid && last.valid) || first.validCombined) return []
  const minutes = first.jsMinutes + last.jsMinutes
  return [
    {
      targets: [first.dayIri, last.dayIri],
      params: { first: first.number, last: last.number, minutes },
      // Nothing planned at all on arrival/departure is normal: only a hint.
      severity: minutes === 0 ? 'hint' : undefined,
    },
  ]
}

// JS-DAY-05 ----------------------------------------------------------------------------------

const WARMUP: KeywordSet = { keywords: ['einstimm', 'aufwärm', 'aufwaerm', 'warm-up', 'warmup', 'warm up', 'einlauf', 'einspiel', 'ankommen', 'aufwaermen'] }

export const jsDay05: RulePredicate = (ctx) => {
  if (!dayReady(ctx)) return []
  const hits: RuleHit[] = []
  const seen = new Set<string>()
  for (const d of report(ctx).days) {
    for (const u of d.units) {
      if (seen.has(u.activityIri)) continue
      seen.add(u.activityIri)
      const a = activityOf(ctx, u.activityIri)
      if (!a || !a.content.storyboardText.trim()) continue // CMP-ACT-02 reports missing storyboards
      const head = a.content.storyboardText.slice(0, 400)
      if (matchKeywords(head, WARMUP).length > 0) continue
      hits.push({ targets: [a.iri], params: { title: a.title }, evidence: [activityEvidence(a)] })
    }
  }
  return hits
}

// JS-DL-01..03 -------------------------------------------------------------------------------

function deadlineCamp(ctx: RuleContext) {
  const c = ctx.facts.camp
  const lastJs = ctx.mapping ? lastJsDate(report(ctx)) : null
  return { iri: c.iri, title: c.title, start: c.start, end: c.end, lastJsDate: lastJs }
}

const today = (ctx: RuleContext) => ctx.now.toISOString().slice(0, 10)

export const jsDl01: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const dl = computeDeadlines(deadlineCamp(ctx), ctx.coachInputs).find((d) => d.kind === 'nds-registration')
  if (!dl) return []
  const t = today(ctx)
  const on = ctx.coachInputs?.ndsRegisteredOn ?? null
  if (dl.done) {
    if (on && on > dl.due) {
      return [campHit(ctx, { detail: `Anmeldung erfolgte am ${formatDateDe(on)}, Frist war ${formatDateDe(dl.due)}` })]
    }
    return []
  }
  if (t > dl.due) return [campHit(ctx, { detail: `Frist am ${formatDateDe(dl.due)} überschritten, Anmeldung nicht bestätigt` })]
  if (daysBetween(t, dl.due) <= 14) {
    const left = daysBetween(t, dl.due)
    return [campHit(ctx, { detail: `Frist am ${formatDateDe(dl.due)} (noch ${left} ${plural(left, 'Tag', 'Tage')})` }, { severity: 'hint' })]
  }
  return []
}

export const jsDl02: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const dl = computeDeadlines(deadlineCamp(ctx), ctx.coachInputs).find((d) => d.kind === 'nds-closing')
  const start = ctx.facts.camp.start
  if (!dl || !start) return []
  const t = today(ctx)
  const on = ctx.coachInputs?.ndsClosedOn ?? null
  if (dl.done) {
    if (on && on > dl.due) return [campHit(ctx, { detail: `Abschluss erfolgte am ${formatDateDe(on)}, Frist war ${formatDateDe(dl.due)}` })]
    return []
  }
  const lastDay = addDays(dl.due, -30)
  if (t > dl.due) return [campHit(ctx, { detail: `Frist am ${formatDateDe(dl.due)} überschritten, Abschluss nicht bestätigt` })]
  if (t >= lastDay && daysBetween(t, dl.due) <= 14) {
    return [campHit(ctx, { detail: `Frist am ${formatDateDe(dl.due)}` }, { severity: 'hint' })]
  }
  return []
}

export const jsDl03: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const t = today(ctx)
  const hits: RuleHit[] = []
  for (const dl of computeDeadlines(deadlineCamp(ctx), ctx.coachInputs)) {
    if (dl.kind !== 'leihmaterial' && dl.kind !== 'landeskarten') continue
    if (dl.done || t <= dl.due) continue
    // Past the camp start the order is moot.
    if (ctx.facts.camp.start && t > ctx.facts.camp.start) continue
    hits.push({
      targets: [ctx.facts.camp.iri, dl.kind],
      params: { what: dl.kind === 'leihmaterial' ? 'Leihmaterial' : 'Landeskarten', due: formatDateDe(dl.due) },
    })
  }
  return hits
}

// JS-LL-01 -----------------------------------------------------------------------------------

export const jsLl01: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const v = ctx.coachInputs?.lagerleiterAttested ?? null
  if (v === true) return []
  return [
    campHit(ctx, {
      detail: v === null ? 'noch nicht bestätigt (Angabe fehlt)' : 'nicht bestätigt',
    }, v === null ? { severity: 'hint' } : {}),
  ]
}

// JS-STAFF-01 --------------------------------------------------------------------------------

export const MAX_PARTICIPANTS_PER_LEADER = 10
export const MIN_LEADERS = 2

export const jsStaff01: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const p = ctx.coachInputs?.participantsCount ?? null
  const l = ctx.coachInputs?.leadersCount ?? null
  if (p === null || l === null) return []
  const needed = Math.max(MIN_LEADERS, Math.ceil(p / MAX_PARTICIPANTS_PER_LEADER))
  return l >= needed ? [] : [campHit(ctx, { participants: p, leaders: l, needed })]
}

// JS-FREE-01 ---------------------------------------------------------------------------------

export const jsFree01: RulePredicate = (ctx) => {
  if (!dayReady(ctx)) return []
  return trainingFreeDays(report(ctx)).map((d) => ({ targets: [d.dayIri], params: { day: d.number, date: formatDateDe(d.date) } }))
}

// JS-BWZ-27 ----------------------------------------------------------------------------------

export const BWZ_MINUTES = 120

export const jsBwz27: RulePredicate = (ctx) => {
  if (!jsApplies(ctx)) return []
  const { facts } = ctx
  const entriesByActivity = new Map<string, number>()
  for (const e of facts.scheduleEntries) entriesByActivity.set(e.activityIri, (entriesByActivity.get(e.activityIri) ?? 0) + 1)
  const activityById = new Map(facts.activities.map((a) => [a.iri, a]))
  const perDay = new Map<string, number>()
  let anyData = false
  for (const e of facts.scheduleEntries) {
    let v = e.ysPhysicalActivityDurationMinutes
    if (v === null || v === undefined) {
      const a = activityById.get(e.activityIri)
      const c = a?.content.ysPhysicalActivityDurationMinutes ?? null
      v = c !== null && entriesByActivity.get(e.activityIri) === 1 ? c : null
    }
    if (v !== null) anyData = true
    const date = e.start.slice(0, 10)
    perDay.set(date, (perDay.get(date) ?? 0) + (v ?? 0))
  }
  if (!anyData) {
    return facts.days.length === 0 ? [] : [campHit(ctx, { _message: 'Keine Angaben zur Bewegungszeit (J+S-Bewegungszeit-Inhalt) erfasst: ab 2027 sind 120 Min. pro Tag gefordert.' })]
  }
  const hits: RuleHit[] = []
  for (const day of sortedDays(facts)) {
    const minutes = perDay.get(day.date) ?? 0
    if (minutes < BWZ_MINUTES) {
      hits.push({ targets: [day.iri], params: { day: formatDateDe(day.date), minutes } })
    }
  }
  return hits
}
