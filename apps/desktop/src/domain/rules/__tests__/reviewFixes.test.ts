/** Regression tests for the rules v2 review: pack validity, winter module, JS-DAY-03 gaps, keywords, non-J+S camps. */
import { describe, expect, it } from 'vitest'
import { evaluate } from '../engine'
import { resolveModuleStates } from '../lib/moduleState'
import { loadBundledPacks, parsePackYaml } from '../packs'
import { allPredicates } from './predicates'
import { CAT_LS, FactsBuilder, makeCoachInputs, makeCtx } from './factory'

const states = (ctx: ReturnType<typeof makeCtx>) =>
  Object.fromEntries(Object.entries(ctx.campConfig.moduleStates).map(([id, r]) => [id, r!.state]))
const kw = makeCtx(new FactsBuilder().facts).keywords
const has = (id: string, text: string) => kw.match(id, text).length > 0

describe('pack validity vs module resolution', () => {
  it('camp before the first pack validity: no module states, no throw, no findings', () => {
    const b = new FactsBuilder({ start: '2025-07-12' })
    b.activity('Baden im See', CAT_LS)
    expect(() => makeCtx(b.facts)).not.toThrow()
    expect(states(makeCtx(b.facts))).toEqual({})
    expect(evaluate(loadBundledPacks(), makeCtx(b.facts))).toEqual([])
  })

  it('a trigger whose param has no value row is false instead of throwing', () => {
    const ctx = makeCtx(new FactsBuilder().facts)
    const params = {
      ...ctx.params,
      get: () => {
        throw new Error('kein Wert')
      },
    } as unknown as typeof ctx.params
    const modules = loadBundledPacks().flatMap((p) => p.modules ?? [])
    expect(() =>
      resolveModuleStates({
        modules,
        facts: new FactsBuilder({ start: '2025-07-12' }).facts,
        coachInputs: null,
        documents: [],
        config: { ...ctx.campConfig, sport: 'lst' },
        keywords: ctx.keywords,
        params,
      }),
    ).not.toThrow()
  })
})

describe('lst-winter module', () => {
  const camp = { region: null, campForm: null, winterSafeAccess: false, abroad: null }

  it('winterSafeAccess === false in winter months turns the module on; in summer it does not', () => {
    expect(states(makeCtx(new FactsBuilder({ start: '2031-02-10' }).facts, { campConfig: { camp } }))['lst-winter']).toBe('on')
    expect(states(makeCtx(new FactsBuilder({ start: '2031-07-12' }).facts, { campConfig: { camp } }))['lst-winter']).toBe('off')
  })

  it('suggested when any camp day lies in a winter month (Oct 28 - Nov 3), not when none does', () => {
    expect(states(makeCtx(new FactsBuilder({ start: '2026-10-28', days: 7 }).facts))['lst-winter']).toBe('suggested')
    expect(states(makeCtx(new FactsBuilder({ start: '2026-10-10', days: 5 }).facts))['lst-winter']).toBe('off')
  })

  it('loader: only campConfig + campOverlapsMonths may be AND-combined', () => {
    const yaml = (t: string) => `id: x\nname: x\nversion: 1\nmodules:\n  - id: lst-winter\n    title: t\n    suggestWhen:\n      - ${t}\n`
    expect(() => parsePackYaml(yaml('{ keywordSet: WATER, campStartMonths: [1] }'))).toThrow(/genau ein/)
    expect(() => parsePackYaml(yaml('{ campConfig: { winterSafeAccess: [false] }, campOverlapsMonths: [1] }'))).not.toThrow()
  })
})

describe('module triggers', () => {
  it('ignore the safety text', () => {
    const b = new FactsBuilder({ start: '2031-07-12' })
    const a = b.activity('Geländespiel', CAT_LS)
    a.content.safetyText = 'Baden im See nur mit Aufsicht'
    expect(states(makeCtx(b.facts))['lst-wasser']).toBe('off')
  })
})

describe('non-J+S camps keep safety modules', () => {
  it('LST-WASSER-01 predicate fires (engine skips the ai rule), JS-* rules stay silent', () => {
    const b = new FactsBuilder({ start: '2031-07-12' })
    b.activity('Baden im See', CAT_LS)
    const ctx = makeCtx(b.facts, {
      coachInputs: makeCoachInputs({ isJsCamp: false }),
      campConfig: { modules: { 'lst-wasser': 'on' } },
    })
    const ids = evaluate(loadBundledPacks(), ctx).map((f) => f.ruleId)
    expect(ids).not.toContain('LST-WASSER-01') // kind: ai -> guidance only
    expect(allPredicates['LST-WASSER-01'](ctx).length).toBeGreaterThan(0)
    expect(ids.filter((i) => i.startsWith('JS-'))).toEqual([])
  })
})

describe('JS-DAY-03 touching blocks', () => {
  it('touching blocks of different activities report a 0-minute gap', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 3 })
    b.entry(b.activity('a', CAT_LS), 2, '09:00', '11:00')
    b.entry(b.activity('b', CAT_LS), 2, '11:00', '13:00')
    const d = makeCtx(b.facts).js.days[1]
    expect(d.shortGaps).toEqual([{ from: 660, to: 660, minutes: 0 }])
    expect(d.jsMinutes).toBe(240)
  })

  it('same activity back to back and parallel subgroups report no gap', () => {
    const b = new FactsBuilder({ start: '2026-07-12', days: 3 })
    const same = b.activity('a', CAT_LS)
    b.entry(same, 2, '09:00', '11:00')
    b.entry(same, 2, '11:00', '12:00')
    b.entry(b.activity('Gruppe A', CAT_LS), 2, '14:00', '16:00')
    b.entry(b.activity('Gruppe B', CAT_LS), 2, '14:00', '16:00')
    const d = makeCtx(b.facts).js.days[1]
    expect(d.shortGaps).toEqual([])
    expect(d.intervals).toEqual([
      { from: 540, to: 720 },
      { from: 840, to: 960 },
    ])
  })
})

describe('bundled keyword sets', () => {
  it('WATER: no false positives', () => {
    for (const t of ['Eintauchen in die Geschichte', 'Mit dem Bruder spielen', 'Einfluss der Medien', 'Genug Wasser trinken', 'Wasser auffüllen']) {
      expect(has('WATER', t), t).toBe(false)
    }
  })
  it('WATER: true positives', () => {
    for (const t of ['Baden im See', 'Kanufahrt', 'Rudern auf dem Sarnersee', 'Flussfahrt', 'Bergfluss', 'Tauchen im See', 'Am Fluss']) {
      expect(has('WATER', t), t).toBe(true)
    }
  })
  it('EXCLUDED: Quader / Boxen are no hits; Canyoning, Quad fahren, Kickboxen are', () => {
    expect(has('EXCLUDED', 'Quader basteln')).toBe(false)
    expect(has('EXCLUDED', 'Boxen packen')).toBe(false)
    for (const t of ['Canyoning', 'Quad fahren', 'Quads mieten', 'Kickboxen', 'Boxkampf']) expect(has('EXCLUDED', t), t).toBe(true)
  })
})
