/**
 * Guard for the leader-facing `feedbackText` of the bundled rules (TRIAGE-01, GOLDEN-04): every active
 * must/should rule has one, it only uses placeholders every hit fills (renderFeedbackText ignores
 * messageVariants), and it reads as a message to the leaders (one ask, Swiss spelling, no coach notes).
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { hasNextStep, itemFromFinding, lintItems } from '../../feedback'
import { evaluate, renderFeedbackText } from '../engine'
import { loadBundledPacks } from '../packs'
import { DEFAULT_APP_SETTINGS, type CampFacts, type CategoryMapping, type RuleContext, type RuleHit, type RuleMeta } from '@/domain/types'
import { allPredicates as p } from './predicates'
import { CAMP, CAT_LS, FactsBuilder, makeCoachInputs, makeCtx, makeMidata, ruleMeta } from './factory'
import { jsDay, Y2026, Y2027 } from './lst/helpers'

const packs = loadBundledPacks()
const rules = packs.flatMap((pk) => pk.rules.map((r) => r.meta))
const withText = rules.filter((m) => m.feedbackText?.trim())

/** The most frequent findings of a typical camp (GOLDEN-04): they need a text even when they are hints. */
const FREQUENT = ['JS-DAY-01', 'JS-PROG-02', 'CMP-DAY-01', 'CMP-CAMP-01', 'JS-LL-01', 'JS-DAY-05', 'CMP-ACT-03', 'JS-BWZ-02']

/**
 * Variants that fill a fragment placeholder ({detail}, {area} …) instead of replacing the whole message;
 * `…Join` variants are separators. Every other variant is a whole message the text must fit (fail closed).
 */
const FRAGMENT_VARIANTS: Record<string, RegExp> = {
  'CMP-CAMP-01': /^(noCoach|otherCoach|midataOther|midataUnknown)$/,
  'CMP-CON-05': /^item$/,
  'JS-DL-03': /^(leihmaterial|landeskarten|noDeliveryDate)$/,
  'JS-DL-04': /^(weekday\d|holiday)$/,
  'LST-SB-01': /^(area|reason)[A-Z]/,
  'LST-SB-02': /^area[A-Z]/,
  'LST-SB-03': /^area[A-Z]/,
  'LST-SB-04': /^area[A-Z]/,
  'LST-SB-05': /^area[A-Z]/,
  'LST-WASSER-04': /^(setting|required)[A-Z]/,
  'LST-WINTER-01': /^form_/,
  'BP-SLEEP-01': /^stufe_/,
}
/** Hit params a fragment-composed message shows only through its fragments (checked on real hits below). */
const FRAGMENT_PARAMS: Record<string, string[]> = {
  'JS-DL-03': ['due'],
}
/** Coach-homework variants (the hit sets needsInput): never sent to the leaders, so the text need not fit them. */
const HOMEWORK_VARIANTS: Record<string, string[]> = {
  'JS-CAMP-01': ['noMapping'],
  'JS-CAMP-02': ['missing'],
  'JS-STAFF-02': ['missing'],
  'JS-LL-01': ['missing'],
  'LST-SB-03': ['unknown'],
  'LST-WASSER-04': ['unknown'],
}

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
const needsText = (m: RuleMeta): boolean =>
  m.status === 'active' && m.kind !== 'ai' && (m.severity === 'must' || m.severity === 'should')
const wholeVariants = (m: RuleMeta): [string, string][] =>
  Object.entries(m.messageVariants ?? {}).filter(
    ([k]) => !k.endsWith('Join') && !FRAGMENT_VARIANTS[m.id]?.test(k) && !(HOMEWORK_VARIANTS[m.id] ?? []).includes(k),
  )
/** Wording that belongs to the coach, not to the leaders («du», co-co's own forms, coach support). */
const COACH_ONLY = /Coach-Support|Angabe fehlt|«Angaben»|neu laden|\b(du|dich|dir|dein\w*)\b/i

describe('leader-facing feedbackText of the bundled rules', () => {
  it('exists for every active must/should rule (not kind ai) and for the frequent hints', () => {
    expect(rules.filter((m) => m.kind === 'ai' || m.severity === 'hint').length).toBeGreaterThan(0)
    const missing = rules.filter((m) => (needsText(m) || FREQUENT.includes(m.id)) && !m.feedbackText?.trim()).map((m) => m.id)
    expect(missing).toEqual([])
  })

  it('only uses placeholders of the message and of every whole-message variant', () => {
    const problems: string[] = []
    for (const m of withText) {
      for (const ph of placeholders(m.feedbackText!)) {
        if (FRAGMENT_PARAMS[m.id]?.includes(ph)) continue
        if (!placeholders(m.message).includes(ph)) problems.push(`${m.id}: {${ph}} not in message`)
        for (const [k, v] of wholeVariants(m)) if (!placeholders(v).includes(ph)) problems.push(`${m.id}: {${ph}} not in variant ${k}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('keeps the variant lists of this guard in sync with the rules', () => {
    for (const [id, keys] of Object.entries(HOMEWORK_VARIANTS)) {
      for (const k of keys) expect(ruleMeta(id).messageVariants?.[k], `${id}.${k}`).toBeDefined()
    }
    for (const [id, names] of Object.entries(FRAGMENT_PARAMS)) {
      for (const n of names) expect(placeholders(ruleMeta(id).feedbackText ?? ''), `${id} {${n}}`).toContain(n)
    }
    for (const [id, re] of Object.entries(FRAGMENT_VARIANTS)) {
      expect(Object.keys(ruleMeta(id).messageVariants ?? {}).some((k) => re.test(k)), id).toBe(true)
    }
  })

  it('reads as one ask to the leaders: Swiss spelling, no rule ids, no coach-only notes, short', () => {
    for (const m of withText) {
      const t = m.feedbackText!
      expect(t, m.id).not.toContain('ß')
      expect(t, m.id).not.toMatch(/\b[A-Z]{2,5}-[A-Z0-9]+-\d{2}\b/)
      expect(t, m.id).not.toMatch(COACH_ONLY)
      expect(t.length, m.id).toBeLessThanOrEqual(220)
      expect(hasNextStep(t), m.id).toBe(true)
    }
  })
})

describe('feedbackTextGroup of the hard day-scope rules', () => {
  const GROUP_IDS = ['CMP-DAY-01', 'JS-DAY-01', 'JS-DAY-03', 'JS-DAY-06', 'JS-PROG-01', 'JS-PROG-02', 'BP-REST-01', 'BP-SLEEP-01']
  it('exists for the grouped day rules, names {n} and {dates}, and only uses placeholders of the message otherwise', () => {
    for (const id of GROUP_IDS) {
      const t = ruleMeta(id).feedbackTextGroup
      expect(t, id).toBeTruthy()
      expect(t, id).toContain('{n}')
      expect(t, id).toContain('{dates}')
      expect(t, id).not.toContain('ß')
      expect(t, id).not.toMatch(COACH_ONLY)
      expect(hasNextStep(t!), id).toBe(true)
      for (const ph of placeholders(t!)) {
        if (ph === 'n' || ph === 'dates') continue
        expect(placeholders(ruleMeta(id).message), `${id} {${ph}}`).toContain(ph)
      }
    }
  })

  it('the engine fills the hit params and leaves {n} and {dates} open; needsInput hits get none', () => {
    const meta = ruleMeta('JS-DAY-03')
    const hit = { targets: ['/api/days/d1'], params: { day: 2, min: 15, count: 1, minutes: 5 } } as unknown as RuleHit
    expect(renderFeedbackText(meta, hit, 'feedbackTextGroup')).toBe(
      'An {n} Tagen ({dates}) sind Pausen zwischen den J+S-Einheiten kürzer als 15 Minuten. Könnt ihr mehr Zeit dazwischen einplanen?',
    )
  })
})

// --- rendered texts of real predicate hits ---------------------------------------------------------

/** Rendered feedbackText of every hit of `id` in `ctx` (at least one hit, none of them coach homework). */
function texts(id: string, ctx: RuleContext, variant?: string): string[] {
  const hits: RuleHit[] = p[id](ctx)
  expect(hits.length, `${id} fires`).toBeGreaterThan(0)
  if (variant !== undefined) expect(hits.map((h) => h.variant ?? 'base'), id).toContain(variant)
  return hits.map((h) => {
    expect(h.needsInput, `${id} ${h.variant ?? ''}`).toBeUndefined()
    const t = renderFeedbackText(ruleMeta(id), h)
    expect(t, `${id} ${h.variant ?? ''}`).toBeDefined()
    expect(t, `${id} ${h.variant ?? ''}`).not.toMatch(/\{\w+\}/)
    expect(t, `${id} ${h.variant ?? ''}`).not.toMatch(COACH_ONLY)
    return t!
  })
}

describe('feedbackText of real hits fits every variant', () => {
  it('JS-BWZ-02: under30, step, missing and tooLong name the activity without fixed numbers', () => {
    const run = (ys: number | null, variant: string) => {
      const b = new FactsBuilder({ start: Y2027, days: 3 })
      b.entry(b.activity('Postenlauf', CAT_LS), 2, '09:00', '10:30', { ys })
      return texts('JS-BWZ-02', makeCtx(b.facts), variant)
    }
    for (const [ys, variant] of [[20, 'under30'], [50, 'step'], [null, 'missing'], [120, 'tooLong']] as const) {
      expect(run(ys, variant)).toEqual([
        'Bei «Postenlauf» fehlt die Bewegungszeit in eCamp oder sie stimmt noch nicht. Könnt ihr sie bitte prüfen und korrigieren?',
      ])
    }
  })

  it('JS-DAY-01: the base and the bwz variant name the day', () => {
    const b = new FactsBuilder({ start: Y2026, days: 5 })
    b.entry(b.activity('a', CAT_LS), 2, '09:00', '11:00')
    expect(texts('JS-DAY-01', makeCtx(b.facts), 'base')).toEqual([
      'Am 13.07.2026 reicht das Programm noch nicht für einen J+S-Tag. Wie wollt ihr es anpassen?',
    ])
    const c = new FactsBuilder({ start: Y2027, days: 4 })
    jsDay(c, 2, 30)
    expect(texts('JS-DAY-01', makeCtx(c.facts), 'bwz')[0]).toContain('Am 13.07.2027 ')
  })

  it('JS-CAMP-01: calendar days (2026) and J+S days (2027) give the minimum; noMapping stays coach homework', () => {
    const short = makeCtx(new FactsBuilder({ start: Y2026, days: 3 }).facts)
    expect(texts('JS-CAMP-01', short, 'base')).toEqual(['Das Lager erreicht die für J+S nötigen 4 Tage noch nicht. Wie wollt ihr das lösen?'])
    const b = new FactsBuilder({ start: Y2027, days: 5 })
    for (const d of [1, 2, 5]) jsDay(b, d)
    expect(texts('JS-CAMP-01', makeCtx(b.facts), 'jsDays')[0]).toContain('nötigen 4 Tage')
    const noMapping = p['JS-CAMP-01'](makeCtx(new FactsBuilder({ start: Y2026, days: 4 }).facts, { mapping: null }))
    expect(noMapping.map((h) => [h.variant, h.needsInput])).toEqual([['noMapping', 'mapping']])
  })

  it('JS-DAY-06, JS-BWZ-27 and JS-FREE-01: every variant renders completely, without the coach-support note', () => {
    const one = new FactsBuilder({ start: Y2026, days: 4 })
    one.entry(one.activity('a', CAT_LS), 2, '09:00', '11:00')
    expect(texts('JS-DAY-06', makeCtx(one.facts), 'base')[0]).toContain('«Morgen»')
    const ends = new FactsBuilder({ start: Y2026, days: 4 })
    ends.entry(ends.activity('an', CAT_LS), 1, '09:00', '11:00')
    ends.entry(ends.activity('ab', CAT_LS), 4, '09:00', '11:00')
    texts('JS-DAY-06', makeCtx(ends.facts), 'combined')

    const low = new FactsBuilder({ start: Y2027, days: 4 })
    jsDay(low, 2, 45)
    expect(texts('JS-BWZ-27', makeCtx(low.facts), 'base')[0]).toContain('120 Minuten')
    const none = new FactsBuilder({ start: Y2027, days: 4 })
    jsDay(none, 2, null)
    jsDay(none, 3, null)
    texts('JS-BWZ-27', makeCtx(none.facts), 'noData')

    const camp = (start: string, days: number, valid: number[]) => {
      const b = new FactsBuilder({ start, days })
      for (const d of valid) jsDay(b, d)
      return makeCtx(b.facts)
    }
    expect(texts('JS-FREE-01', camp(Y2026, 7, [2, 3]), 'base')[0]).toContain('3 trainingsfreie Tage bei 7 Lagertagen')
    texts('JS-FREE-01', camp(Y2026, 6, [2, 3]), 'conflict')
    texts('JS-FREE-01', camp(Y2027, 9, [2, 3, 4]), 'conflict2027')
  })

  it('JS-DL-01/02/03: deadline texts carry the due date in every variant and ask for what the coach needs', () => {
    const b = new FactsBuilder({ start: '2031-07-12', days: 5 })
    const at = (now: string, inputs = makeCoachInputs()) => makeCtx(b.facts, { now: new Date(now), coachInputs: inputs })
    expect(texts('JS-DL-01', at('2031-06-13T00:00:00Z'), 'base')[0]).toContain('(Frist 12.06.2031)')
    texts('JS-DL-01', at('2031-06-11T00:00:00Z'), 'soonOne')
    texts('JS-DL-01', at('2031-06-01T00:00:00Z'), 'soonMany')
    texts('JS-DL-01', at('2031-06-20T00:00:00Z', makeCoachInputs({ ndsRegistered: true, ndsRegisteredOn: '2031-06-13' })), 'late')
    expect(texts('JS-DL-02', at('2031-08-16T00:00:00Z'), 'base')[0]).toContain('(Frist 15.08.2031)')
    texts('JS-DL-02', at('2031-08-10T00:00:00Z'), 'soon')
    texts('JS-DL-02', at('2031-08-20T00:00:00Z', makeCoachInputs({ ndsClosed: true, ndsClosedOn: '2031-08-18' })), 'late')
    // Leihmaterial (start - 35 d) and Landeskarten (July delivery: start - 35 d) are both overdue.
    expect(texts('JS-DL-03', at('2031-06-10T00:00:00Z')).map((t) => t.includes('war am 07.06.2031.'))).toEqual([true, true])
  })

  it('JS-LL-01 and CMP-CAMP-01: every variant asks the leaders without quoting the coach note', () => {
    const f = new FactsBuilder().facts
    const denied = makeCoachInputs({ lagerleiterAttested: false })
    const fromMidata = makeCoachInputs({ lagerleiterAttested: false, midataFields: { lagerleiterAttested: '2031-01-01T10:00:00.000Z' } })
    expect(texts('JS-LL-01', makeCtx(f, { coachInputs: denied }), 'base')).toEqual(texts('JS-LL-01', makeCtx(f, { coachInputs: fromMidata }), 'midata'))

    const coach = (coachName: string | null, over: Parameters<typeof makeCtx>[1] = {}) =>
      texts('CMP-CAMP-01', makeCtx(new FactsBuilder({ coachName }).facts, over))
    const expected = ['Könnt ihr mich bitte als Coach im Lager eintragen, in eCamp und im MiData-Anlass?']
    expect(coach(null)).toEqual(expected)
    expect(coach('Max Muster', { userDisplayName: 'Erika Beispiel' })).toEqual(expected)
    expect(coach('Max Muster', { userDisplayName: 'Muster Max', midata: makeMidata({ coachMatch: false, coachNickname: 'Falk' }) })).toEqual(expected)
  })

  it('a must finding becomes a must feedback item with the rule text and a next step', () => {
    const b = new FactsBuilder({ start: Y2027, days: 3 })
    b.entry(b.activity('Postenlauf', CAT_LS), 2, '09:00', '10:30', { ys: 50 })
    const finding = evaluate(packs, makeCtx(b.facts)).find((f) => f.ruleId === 'JS-BWZ-02')!
    expect(finding.severity).toBe('must')
    const item = itemFromFinding(finding, CAMP)
    expect(item).toMatchObject({ kind: 'must', text: finding.feedbackText })
    expect(lintItems([item])).toEqual([])
  })
})

// Every finding of the real fixture camp: the feedback text is filled completely (or the finding is coach homework).
const FIXTURE = fileURLToPath(new URL('../../../__tests__/fixtures/camps/auf-in-die-berge.facts.json', import.meta.url))
describe.skipIf(!existsSync(FIXTURE))('feedbackText on the fixture camp «Auf in die Berge»', () => {
  const facts = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as CampFacts
  const mapping = (): CategoryMapping => {
    const entries: CategoryMapping['entries'] = {}
    for (const c of facts.categories) {
      const key = `${c.short} ${c.name}`.toLowerCase()
      entries[c.iri] = /\bls\b|sport/.test(key) ? 'LS' : /\bla\b|aktivit/.test(key) ? 'LA' : /essen|\bes\b/.test(key) ? 'ES' : 'NONE'
    }
    return { campIri: facts.camp.iri, entries, confirmed: true, confirmedAt: null, updatedAt: '2026-01-01T00:00:00.000Z' }
  }

  it('fills every placeholder of the feedback text of each leader finding', () => {
    const textRules = new Set(withText.map((m) => m.id))
    let checked = 0
    for (const map of [null, mapping()]) {
      const findings = evaluate(packs, makeCtx(facts, { mapping: map, settings: DEFAULT_APP_SETTINGS, now: new Date('2030-01-01T00:00:00Z') }))
      for (const f of findings) {
        if (!textRules.has(f.ruleId) || f.needsInput) continue
        checked++
        expect(f.feedbackText, f.id).toBeDefined()
        expect(f.feedbackText, f.id).not.toMatch(/\{\w+\}/)
        // The group variant keeps only {n} and {dates} open (itemFromFindingGroup fills them).
        if (f.feedbackTextGroup) expect(f.feedbackTextGroup.replace(/\{(n|dates)\}/g, ''), f.id).not.toMatch(/\{\w+\}/)
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})
