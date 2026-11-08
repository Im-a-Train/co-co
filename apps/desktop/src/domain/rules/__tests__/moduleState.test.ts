/** Per-camp module state resolution (catalog v2 §2.3). */
import { describe, expect, it } from 'vitest'
import type { GpxStats } from '@/domain/types'
import { CAT_LS, FactsBuilder, makeCoachInputs, makeCtx, makeDoc } from './factory'

const states = (ctx: ReturnType<typeof makeCtx>) =>
  Object.fromEntries(Object.entries(ctx.campConfig.moduleStates).map(([id, r]) => [id, r!.state]))

describe('resolveModuleStates', () => {
  it('defaults: core modules on, auto modules off without triggers, pbs on for unknown organizer', () => {
    const b = new FactsBuilder({ start: '2031-07-12' })
    b.activity('Geländespiel', CAT_LS)
    expect(states(makeCtx(b.facts))).toEqual({
      js: 'on',
      lst: 'on',
      'lst-lager': 'on',
      'lst-trekking': 'on',
      'lst-berg': 'off',
      'lst-wasser': 'off',
      'lst-winter': 'off',
      'lst-ebb': 'off',
      pbs: 'on',
    })
  })

  it('not a J+S camp → js and every lst module off (appliesWhen)', () => {
    const ctx = makeCtx(new FactsBuilder().facts, { coachInputs: makeCoachInputs({ isJsCamp: false }) })
    const s = states(ctx)
    expect([s.js, s.lst, s['lst-lager'], s['lst-berg']]).toEqual(['off', 'off', 'off', 'off'])
    expect(ctx.campConfig.moduleStates.js!.reasons[0].key).toBe('rules.module.reason.notJsCamp')
  })

  it('sport other switches lst and its sub-modules off, js stays on', () => {
    const s = states(makeCtx(new FactsBuilder().facts, { campConfig: { sport: 'other' } }))
    expect([s.js, s.lst, s['lst-trekking']]).toEqual(['on', 'off', 'off'])
  })

  it('keyword trigger suggests a module and collects the reason', () => {
    const b = new FactsBuilder({ start: '2031-07-12' })
    b.activity('Baden im See', CAT_LS)
    const r = makeCtx(b.facts).campConfig.moduleStates['lst-wasser']!
    expect(r.state).toBe('suggested')
    expect(r.reasons).toEqual([{ key: 'rules.module.reason.keywordSet', params: { set: 'WATER', count: 1 } }])
  })

  it('a coach tag turns an auto module on; coach off wins over triggers', () => {
    const b = new FactsBuilder({ start: '2031-07-12' })
    const a = b.activity('Baden im See', CAT_LS)
    expect(states(makeCtx(b.facts, { campConfig: { activityTags: { [a.iri]: ['sb-wasser'] } } }))['lst-wasser']).toBe('on')
    expect(states(makeCtx(b.facts, { campConfig: { modules: { 'lst-wasser': 'off' } } }))['lst-wasser']).toBe('off')
    expect(states(makeCtx(b.facts, { campConfig: { modules: { 'lst-berg': 'on' } } }))['lst-berg']).toBe('on')
  })

  it('winter: camp start month in lst.winterMonths suggests; berg: GPX highest point and region suggest', () => {
    expect(states(makeCtx(new FactsBuilder({ start: '2031-02-10' }).facts))['lst-winter']).toBe('suggested')
    const gpx = { highestPointM: 1450 } as GpxStats
    expect(states(makeCtx(new FactsBuilder().facts, { documents: [makeDoc({ gpx })] }))['lst-berg']).toBe('suggested')
    expect(states(makeCtx(new FactsBuilder().facts, { campConfig: { camp: { region: 'alpen', campForm: null, winterSafeAccess: null, abroad: null } } }))['lst-berg']).toBe(
      'suggested',
    )
  })

  it('pbs is off for a non-PBS organizer unless the coach switches it on', () => {
    const b = new FactsBuilder()
    b.facts.camp.organizer = 'Cevi Region Bern'
    expect(states(makeCtx(b.facts)).pbs).toBe('off')
    expect(states(makeCtx(b.facts, { campConfig: { modules: { pbs: 'on' } } })).pbs).toBe('on')
    b.facts.camp.organizer = 'Pfadi St. Georg'
    expect(states(makeCtx(b.facts)).pbs).toBe('on')
  })
})
