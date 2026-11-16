import { describe, expect, it } from 'vitest'
import { evaluate } from '../engine'
import { allPredicates as p } from './predicates'
import { CAT_LS, FactsBuilder, makeCoachInputs, makeCtx, makeMidata } from './factory'
import type { Rule, RuleMeta, RulePack } from '@/domain/types'

const meta: RuleMeta = {
  id: 'T-NI-01',
  version: '1.0.0',
  module: 'js',
  group: 'js',
  status: 'active',
  kind: 'hard',
  sources: [{ key: 'WEB-L', page: '' }],
  title: 'Test',
  description: 'd',
  message: 'm',
  severity: 'should',
  confidence: 'verified',
  scope: 'camp',
  source: { title: 'J+S', url: 'https://www.jugendundsport.ch/de/lager' },
}
const packOf = (rule: Rule): RulePack => ({ id: 'p', name: 'P', version: '1', description: '', rules: [rule] })
const ctx = () => makeCtx(new FactsBuilder({ start: '2031-07-12' }).facts)

describe('engine copies RuleHit.needsInput', () => {
  it('sets Finding.needsInput only when the hit has it', () => {
    const rule: Rule = {
      meta,
      check: (c) => [
        { targets: [c.facts.camp.iri], needsInput: 'coachInputs' },
        { targets: ['/api/days/d9'] },
      ],
    }
    const out = evaluate([packOf(rule)], ctx())
    expect(out.find((f) => f.targets[0] === '/api/days/d9')!.needsInput).toBeUndefined()
    expect(out.find((f) => f.targets[0] !== '/api/days/d9')!.needsInput).toBe('coachInputs')
  })
})

describe('predicates tag gap variants with needsInput', () => {
  it('JS-CAMP-01 noMapping → mapping; the real day hit has none', () => {
    const hits = p['JS-CAMP-01'](makeCtx(new FactsBuilder({ start: '2026-07-12', days: 3 }).facts, { mapping: null }))
    expect(hits.find((h) => h.variant === 'noMapping')!.needsInput).toBe('mapping')
    expect(hits.filter((h) => h.variant !== 'noMapping').every((h) => h.needsInput === undefined)).toBe(true)
  })
  it('JS-CAMP-02 «missing» → coachInputs, a real shortfall does not', () => {
    const f = new FactsBuilder({ start: '2027-07-12' }).facts
    expect(p['JS-CAMP-02'](makeCtx(f))[0].needsInput).toBe('coachInputs')
    const real = p['JS-CAMP-02'](makeCtx(f, { coachInputs: makeCoachInputs({ participantsJsAgeCount: 11 }) }))
    expect(real).toHaveLength(1)
    expect(real[0].needsInput).toBeUndefined()
  })
  it('JS-LL-01 «missing» → coachInputs, attested false does not', () => {
    const f = new FactsBuilder({ start: '2027-07-12' }).facts
    const missing = p['JS-LL-01'](makeCtx(f))
    expect(missing[0].variant).toBe('missing')
    expect(missing[0].needsInput).toBe('coachInputs')
    const no = p['JS-LL-01'](makeCtx(f, { coachInputs: makeCoachInputs({ lagerleiterAttested: false }) }))
    expect(no.every((h) => h.needsInput === undefined)).toBe(true)
  })
  it('JS-STAFF-02 «missing» → coachInputs (the count is an «Angaben» field), a real shortfall does not', () => {
    const f = new FactsBuilder({ start: '2027-07-12' }).facts
    const hits = p['JS-STAFF-02'](makeCtx(f))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ variant: 'missing', needsInput: 'coachInputs' })
    const real = p['JS-STAFF-02'](makeCtx(f, { coachInputs: makeCoachInputs({ jsLeadersCount: 1 }) }))
    expect(real).toHaveLength(1)
    expect(real[0].needsInput).toBeUndefined()
  })
  it('LST-WINTER-01 access unknown → coachInputs, no safe access does not', () => {
    const f = new FactsBuilder({ start: '2031-02-10', days: 5 }).facts
    const run = (winterSafeAccess: boolean | null) =>
      p['LST-WINTER-01'](makeCtx(f, { campConfig: { camp: { region: null, campForm: 'haus', winterSafeAccess, abroad: null } } }))
    expect(run(null)[0]!.needsInput).toBe('coachInputs')
    const noAccess = run(false)
    expect(noAccess[0]!.variant).toBe('noAccess')
    expect(noAccess[0]!.needsInput).toBeUndefined()
  })
  it('LST-SB-03 «unknown» (no MiData) → midata, a real gap with MiData does not', () => {
    const b = new FactsBuilder({ start: '2027-07-12', days: 5 })
    const a = b.activity('Tour', CAT_LS)
    b.entry(a, 1, '09:00', '12:00')
    const campConfig = { activityTags: { [a.iri]: ['sb-berg' as const] } }
    const unknown = p['LST-SB-03'](makeCtx(b.facts, { campConfig, midata: null }))
    expect(unknown).toHaveLength(1)
    expect(unknown[0]).toMatchObject({ variant: 'unknown', needsInput: 'midata' })
    const md = makeMidata({ qualificationsReadable: true, qualificationKinds: [{ label: 'Zusatz', keys: ['sbBerg'], validLeaders: 0, expiredLeaders: 0 }] })
    const real = p['LST-SB-03'](makeCtx(b.facts, { campConfig, midata: md }))
    expect(real).toHaveLength(1)
    expect(real[0].needsInput).toBeUndefined()
  })
  it('LST-WASSER-04 «unknown» (no MiData) → midata', () => {
    const b = new FactsBuilder({ start: '2027-07-12', days: 5 })
    const a = b.activity('Baden', CAT_LS)
    b.entry(a, 1, '14:00', '16:00')
    const hits = p['LST-WASSER-04'](makeCtx(b.facts, { campConfig: { activityTags: { [a.iri]: ['wasser-see'] } }, midata: null }))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ variant: 'unknown', needsInput: 'midata' })
  })
})

describe('coach homework carries no leader-facing feedbackText', () => {
  it('renders feedbackText for normal hits only', () => {
    const rule: Rule = {
      meta: { ...meta, feedbackText: 'Könnt ihr das bitte ergänzen?' },
      check: (c) => [
        { targets: [c.facts.camp.iri], needsInput: 'coachInputs' },
        { targets: ['/api/days/d9'] },
      ],
    }
    const out = evaluate([packOf(rule)], ctx())
    expect(out.find((f) => f.needsInput)!.feedbackText).toBeUndefined()
    expect(out.find((f) => !f.needsInput)!.feedbackText).toBe('Könnt ihr das bitte ergänzen?')
  })
  it('renders feedbackTextGroup for normal hits only, with {n} and {dates} left open', () => {
    const rule: Rule = {
      meta: { ...meta, feedbackTextGroup: 'An {n} Tagen ({dates}) fehlt {what}. Könnt ihr das ergänzen?' },
      check: (c) => [
        { targets: [c.facts.camp.iri], needsInput: 'coachInputs', params: { what: 'x' } },
        { targets: ['/api/days/d9'], params: { what: 'das Programm' } },
      ],
    }
    const out = evaluate([packOf(rule)], ctx())
    expect(out.find((f) => f.needsInput)!.feedbackTextGroup).toBeUndefined()
    expect(out.find((f) => !f.needsInput)!.feedbackTextGroup).toBe('An {n} Tagen ({dates}) fehlt das Programm. Könnt ihr das ergänzen?')
  })
})
