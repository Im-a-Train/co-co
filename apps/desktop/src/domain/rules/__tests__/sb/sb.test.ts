import { describe, expect, it } from 'vitest'
import type { CampRuleConfig, GpxStats } from '@/domain/types'
import { allPredicates as p } from '../predicates'
import { CAMP, CAT_LS, FactsBuilder, makeCtx, makeDoc, makeMidata, msg } from '../factory'

type Cfg = Partial<CampRuleConfig>
const gpx = (highestPointM: number | null, estimatedMinutes = 60): GpxStats => ({
  name: null, pointCount: 2, distanceKm: 5, ascentM: 100, descentM: 100, lkm: 6, lkmWithDescent: 6, paceLkmPerHour: 4,
  estimatedMinutes, highestPointM, lowestPointM: null,
})
const kinds = (key: 'sbBerg' | 'sbWasser' | 'sbWinter', validLeaders: number) => [{ label: 'Zusatz', keys: [key], validLeaders, expiredLeaders: 0 }]
const winterNoAccess: Cfg = { camp: { region: null, campForm: null, winterSafeAccess: false, abroad: null } }
const form = (campForm: 'haus' | 'zelt'): Cfg => ({ camp: { region: null, campForm, winterSafeAccess: null, abroad: null } })

function camp(start: string, days: number, title: string, opts: { endDay?: number; safety?: string } = {}) {
  const b = new FactsBuilder({ start, days })
  const a = b.activity(title, CAT_LS, { content: { safetyText: opts.safety ?? '' } })
  b.entry(a, 1, '09:00', '12:00', opts.endDay ? { endDay: opts.endDay } : {})
  return { b, a }
}
const cfgOn = (over: Cfg = {}): Cfg => ({ modules: { 'lst-berg': 'on', 'lst-wasser': 'on', 'lst-winter': 'on' }, ...over })

describe('LST-SB-01', () => {
  const run = (b: FactsBuilder, campConfig: Cfg = cfgOn(), docs = [] as ReturnType<typeof makeDoc>[]) =>
    p['LST-SB-01'](makeCtx(b.facts, { campConfig, documents: docs }))

  it('Flossfahrt auf der Aare -> should (wasser)', () => {
    const { b } = camp('2027-07-12', 5, 'Flossfahrt auf der Aare')
    const h = run(b)
    expect(h).toHaveLength(1)
    expect(h[0].severity).toBeUndefined()
    expect(msg(h[0])).toContain('Sicherheitsbereich Wasser')
  })
  it('is lowered to hint when the area module is not on', () => {
    const { b } = camp('2027-07-12', 5, 'Flossfahrt auf der Aare')
    expect(run(b, { modules: { 'lst-wasser': 'off' } })[0].severity).toBe('hint')
  })
  it('Iglunacht in February: zelt -> winter, haus -> none', () => {
    const { b } = camp('2027-02-08', 5, 'Iglunacht')
    expect(msg(run(b, cfgOn(form('zelt')))[0])).toContain('Winter')
    expect(run(b, cfgOn(form('haus')))).toEqual([])
  })
  it('Biwak in July, single day, no GPX -> none', () => {
    const { b } = camp('2027-07-12', 5, 'Biwak')
    expect(run(b, cfgOn(form('zelt')))).toEqual([])
  })
  it('Biwak over 2 days in July: GPX 2300 m -> berg, 1400 m -> none, treeline text -> berg', () => {
    const { b, a } = camp('2027-07-12', 5, 'Biwak', { endDay: 2 })
    const doc = (m: number) => [makeDoc({ activityIris: [a.iri], gpx: gpx(m) })]
    const h = run(b, cfgOn(), doc(2300))
    expect(h).toHaveLength(1)
    expect(msg(h[0])).toContain('Sicherheitsbereich Berg')
    expect(run(b, cfgOn(), doc(1400))).toEqual([])
    const { b: b2 } = camp('2027-07-12', 5, 'Biwak oberhalb der Waldgrenze', { endDay: 2 })
    expect(run(b2)).toHaveLength(1)
  })
  it('Schneeschuhtour 2 Tage in February -> winter; in July -> none', () => {
    const { b } = camp('2027-02-08', 5, 'Schneeschuhtour 2 Tage', { endDay: 2 })
    expect(msg(run(b)[0])).toContain('Winter')
    const { b: s } = camp('2027-07-12', 5, 'Schneeschuhtour 2 Tage', { endDay: 2 })
    expect(run(s)).toEqual([])
  })
  it('T3 together with anspruchsvoll -> berg', () => {
    const { b } = camp('2027-07-12', 5, 'Anspruchsvolle Wanderung T3')
    expect(msg(run(b)[0])).toContain('Sicherheitsbereich Berg')
  })
  it('is skipped for kein-sb and sb-* tagged activities', () => {
    const { b, a } = camp('2027-07-12', 5, 'Flossfahrt auf der Aare')
    expect(run(b, cfgOn({ activityTags: { [a.iri]: ['kein-sb'] } }))).toEqual([])
    expect(run(b, cfgOn({ activityTags: { [a.iri]: ['sb-wasser'] } }))).toEqual([])
  })
})

describe('LST-SB-02', () => {
  it('tag without approval -> hit; date set -> none; bergfuehrer without date -> none; experte without date -> hit', () => {
    const { b, a } = camp('2027-07-12', 5, 'X')
    const run = (ap: CampRuleConfig['sbApprovals']) =>
      p['LST-SB-02'](makeCtx(b.facts, { campConfig: { activityTags: { [a.iri]: ['sb-wasser'] }, sbApprovals: ap } }))
    const h = run({})
    expect(h).toHaveLength(1)
    expect(msg(h[0])).toContain('Sicherheitsbereich Wasser')
    expect(run({ [a.iri]: { approvedOn: '2027-06-01', kind: 'experte' } })).toEqual([])
    expect(run({ [a.iri]: { approvedOn: null, kind: 'bergfuehrer' } })).toHaveLength(1)
    expect(run({ [a.iri]: { approvedOn: null, kind: 'experte' } })).toHaveLength(1)
  })
  it('camp case: February -> should on camp IRI; July -> none; with camp approval -> none', () => {
    const { b } = camp('2027-02-08', 5, 'Spiel')
    const h = p['LST-SB-02'](makeCtx(b.facts, { campConfig: winterNoAccess }))
    expect(h).toHaveLength(1)
    expect(h[0].targets).toEqual([CAMP])
    expect(h[0].severity).toBe('should')
    expect(msg(h[0])).toContain('Lager ohne wintersichere Zufahrt')
    const { b: s } = camp('2027-07-12', 5, 'Spiel')
    expect(p['LST-SB-02'](makeCtx(s.facts, { campConfig: winterNoAccess }))).toEqual([])
    const approved = { ...winterNoAccess, sbApprovals: { camp: { approvedOn: '2027-01-10', kind: 'experte' as const } } }
    expect(p['LST-SB-02'](makeCtx(b.facts, { campConfig: approved }))).toEqual([])
  })
})

describe('LST-SB-03', () => {
  const { b, a } = camp('2027-07-12', 5, 'Tour')
  const tags: Cfg = { activityTags: { [a.iri]: ['sb-berg'] } }
  const run = (midata: ReturnType<typeof makeMidata> | null, campConfig: Cfg = tags, facts = b.facts) =>
    p['LST-SB-03'](makeCtx(facts, { campConfig, midata }))
  it('sbBerg valid 0 -> hit (red-derived), valid 1 -> none', () => {
    const h = run(makeMidata({ qualificationsReadable: true, qualificationKinds: kinds('sbBerg', 0) }))
    expect(h).toHaveLength(1)
    expect(h[0].redKeys).toContain('validLeaders')
    expect(run(makeMidata({ qualificationsReadable: true, qualificationKinds: kinds('sbBerg', 1) }))).toEqual([])
  })
  it('no or unreadable MiData -> one hint unknown', () => {
    for (const md of [null, makeMidata({ qualificationsReadable: false })]) {
      const h = run(md)
      expect(h).toHaveLength(1)
      expect(h[0].variant).toBe('unknown')
      expect(h[0].severity).toBe('hint')
    }
  })
  it('nothing applicable -> none', () => {
    expect(run(null, {})).toEqual([])
  })
  it('camp case in January with sbWinter valid 0 -> should camp', () => {
    const { b: w } = camp('2027-01-04', 5, 'Spiel')
    const h = run(makeMidata({ qualificationsReadable: true, qualificationKinds: kinds('sbWinter', 0) }), winterNoAccess, w.facts)
    expect(h).toHaveLength(1)
    expect(h[0].targets).toEqual([CAMP])
    expect(h[0].severity).toBe('should')
    expect(msg(h[0])).toContain('Zusatz Sicherheitsbereich Winter')
  })
})

describe('LST-SB-04', () => {
  const { b, a } = camp('2027-07-12', 5, 'Tour')
  const tags: Cfg = { activityTags: { [a.iri]: ['sb-berg'] } }
  const run = (years: Record<number, number>, campConfig: Cfg = tags, facts = b.facts) =>
    p['LST-SB-04'](makeCtx(facts, { campConfig, midata: makeMidata({ participantsByBirthYear: years }) }))
  it('TN born 2018 -> hit with n and fromYear', () => {
    const h = run({ 2018: 1, 2015: 5 })
    expect(h).toHaveLength(1)
    expect(msg(h[0])).toContain('Im Lager sind 1 Teilnehmende')
    expect(msg(h[0])).toContain('Jahrgang 2018 und jünger')
  })
  it('youngest born 2017 -> none', () => {
    expect(run({ 2017: 3, 2012: 2 })).toEqual([])
  })
  it('without birth years -> none', () => {
    expect(p['LST-SB-04'](makeCtx(b.facts, { campConfig: tags, midata: makeMidata() }))).toEqual([])
  })
  it('camp case in February -> hit on camp IRI', () => {
    const { b: w } = camp('2027-02-08', 5, 'Spiel')
    const h = run({ 2018: 2 }, winterNoAccess, w.facts)
    expect(h).toHaveLength(1)
    expect(h[0].targets).toEqual([CAMP])
    expect(msg(h[0])).toContain('Das Lager ohne wintersichere Zufahrt')
  })
})

describe('LST-SB-05', () => {
  const mk = (safety: string) => {
    const { b, a } = camp('2027-07-12', 5, 'Tour', { safety })
    return { b, a, cfg: { activityTags: { [a.iri]: ['sb-berg' as const] } } }
  }
  it('tagged, 50 chars, no doc -> hit', () => {
    const { b, cfg } = mk('x'.repeat(50))
    expect(p['LST-SB-05'](makeCtx(b.facts, { campConfig: cfg }))).toHaveLength(1)
  })
  it('linked document or long text -> none', () => {
    const { b, a, cfg } = mk('x'.repeat(50))
    expect(p['LST-SB-05'](makeCtx(b.facts, { campConfig: cfg, documents: [makeDoc({ activityIris: [a.iri] })] }))).toEqual([])
    const l = mk('x'.repeat(300))
    expect(p['LST-SB-05'](makeCtx(l.b.facts, { campConfig: l.cfg }))).toEqual([])
  })
  it('untagged -> none', () => {
    const { b } = mk('')
    expect(p['LST-SB-05'](makeCtx(b.facts, { campConfig: {} }))).toEqual([])
  })
})
