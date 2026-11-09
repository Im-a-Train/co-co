import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCoachInputs, makeCtx, makeDoc, msg } from '../factory'
import type { ActivityTag, GpxStats } from '@/domain/types'

const FEB = '2031-02-10'
const JULY = '2031-07-12'

const tagged = (iri: string, ...tags: ActivityTag[]) => ({ activityTags: { [iri]: tags } })

describe('LST-WINTER-01', () => {
  const run = (start: string, camp: Partial<{ campForm: 'haus' | 'zelt' | 'gemischt' | null; winterSafeAccess: boolean | null }>) => {
    const b = new FactsBuilder({ start, days: 5 })
    return p['LST-WINTER-01'](
      makeCtx(b.facts, { campConfig: { camp: { region: null, campForm: null, winterSafeAccess: null, abroad: null, ...camp } } }),
    )
  }
  it('February tent camp -> should notHouse', () => {
    const hits = run(FEB, { campForm: 'zelt', winterSafeAccess: true })
    expect(hits).toHaveLength(1)
    expect(hits[0].variant).toBe('notHouse')
    expect(hits[0].severity).toBeUndefined()
    expect(msg(hits[0])).toContain('«Zelt»')
  })
  it('February house camp, access unknown -> hint', () => {
    const hits = run(FEB, { campForm: 'haus', winterSafeAccess: null })
    expect(hits[0].severity).toBe('hint')
    expect(msg(hits[0])).toContain('Angabe zur Zufahrt fehlt')
  })
  it('February house camp, no safe access -> hint noAccess', () => {
    const hits = run(FEB, { campForm: 'haus', winterSafeAccess: false })
    expect(hits[0]).toMatchObject({ variant: 'noAccess', severity: 'hint' })
  })
  it('February house camp with safe access -> none', () => expect(run(FEB, { campForm: 'haus', winterSafeAccess: true })).toEqual([]))
  it('July tent camp -> none (not a winter camp)', () => expect(run(JULY, { campForm: 'zelt', winterSafeAccess: false })).toEqual([]))
})

describe('LST-WINTER-02', () => {
  const camp = (title: string, safety: string) => {
    const b = new FactsBuilder({ start: FEB })
    const a = b.activity(title, CAT_LS, { content: { safetyText: safety } })
    b.entry(a, 2, '09:00', '12:00')
    return { b, a }
  }
  it('snowshoe tour without avalanche reference -> should, names the missing rule', () => {
    const { b } = camp('Schneeschuhtour', 'Hangneigung unter 30 Grad, Höhe unter 1800 m, 3x3 gemacht, defensive Beurteilung')
    const hits = p['LST-WINTER-02'](makeCtx(b.facts))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('fehlen Bezüge zu den Grundregeln: Lawinengefahr')
  })
  it('secured area (Schneeschuhtrail) needs only 3x3 + defensive -> none', () => {
    const { b } = camp('Schneeschuhtrail', '3x3 und defensive Beurteilung')
    expect(p['LST-WINTER-02'](makeCtx(b.facts))).toEqual([])
  })
  it('tag gesicherter-bereich also relaxes the rule', () => {
    const { b, a } = camp('Schneeschuhtour', '3x3 und defensive Planung')
    expect(p['LST-WINTER-02'](makeCtx(b.facts, { campConfig: tagged(a.iri, 'gesicherter-bereich') }))).toEqual([])
    expect(p['LST-WINTER-02'](makeCtx(b.facts))).toHaveLength(1)
  })
  it('unrelated activity -> none', () => {
    const { b } = camp('Geländespiel', '')
    expect(p['LST-WINTER-02'](makeCtx(b.facts))).toEqual([])
  })
})

describe('LST-WINTER-03', () => {
  const gpx = (m: number) => ({ highestPointM: m }) as GpxStats
  const camp = (title: string, start = FEB) => {
    const b = new FactsBuilder({ start })
    const a = b.activity(title, CAT_LS)
    b.entry(a, 2, '09:00', '12:00')
    return { b, a }
  }
  it('1950 m in February -> should', () => {
    const { b, a } = camp('Schneeschuhwanderung')
    const hits = p['LST-WINTER-03'](makeCtx(b.facts, { documents: [makeDoc({ activityIris: [a.iri], gpx: gpx(1950) })] }))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('1950 m ü. M.')
    expect(msg(hits[0])).toContain('1800 m')
  })
  it('tagged gesicherter-bereich -> none', () => {
    const { b, a } = camp('Schneeschuhwanderung')
    const ctx = makeCtx(b.facts, { documents: [makeDoc({ activityIris: [a.iri], gpx: gpx(1950) })], campConfig: tagged(a.iri, 'gesicherter-bereich') })
    expect(p['LST-WINTER-03'](ctx)).toEqual([])
  })
  it('1700 m or a summer month -> none', () => {
    const { b, a } = camp('Schneeschuhwanderung')
    expect(p['LST-WINTER-03'](makeCtx(b.facts, { documents: [makeDoc({ activityIris: [a.iri], gpx: gpx(1700) })] }))).toEqual([])
    const s = camp('Schneeschuhwanderung', JULY)
    expect(p['LST-WINTER-03'](makeCtx(s.b.facts, { documents: [makeDoc({ activityIris: [s.a.iri], gpx: gpx(2100) })] }))).toEqual([])
  })
})

describe('LST-WINTER-04', () => {
  const build = (safety: string, responsibles: number) => {
    const b = new FactsBuilder({ start: FEB })
    const a = b.activity('Schlitteln', CAT_LS, { content: { safetyText: safety } })
    a.responsibleIris = Array.from({ length: responsibles }, (_, i) => `/api/camp_collaborations/cc${i + 1}`)
    b.entry(a, 2, '14:00', '16:00')
    return b
  }
  it('without Helm -> should', () => {
    const hits = p['LST-WINTER-04'](makeCtx(build('Piste getestet, Sicherheitszone, Aufsicht am Start', 2).facts))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('fehlen: Helm')
  })
  it('all present with two responsibles -> none', () => {
    expect(p['LST-WINTER-04'](makeCtx(build('Helm tragen, Piste getestet, Sicherheitszone, Aufsicht am Start', 2).facts))).toEqual([])
  })
  it('a single responsible adds Aufsicht', () => {
    const hits = p['LST-WINTER-04'](makeCtx(build('Helm tragen, Piste getestet, Sicherheitszone, Aufsicht am Start', 1).facts))
    expect(msg(hits[0])).toContain('fehlen: Aufsicht')
  })
})

describe('LST-WINTER-05', () => {
  const build = (title: string, end: string, start = '2031-01-10') => {
    const b = new FactsBuilder({ start })
    const a = b.activity(title, CAT_LS)
    const e = b.entry(a, 2, '14:00', end)
    return { b, e }
  }
  it('January hike ending 17:45 -> hint', () => {
    const { b, e } = build('Wanderung', '17:45')
    const hits = p['LST-WINTER-05'](makeCtx(b.facts))
    expect(hits).toHaveLength(1)
    expect(hits[0].targets).toEqual([e.iri])
    expect(msg(hits[0])).toContain('endet um 17:45, Sonnenuntergang ca. 17:00')
  })
  it('ending 15:30, or in July -> none', () => {
    expect(p['LST-WINTER-05'](makeCtx(build('Wanderung', '15:30').b.facts))).toEqual([])
    expect(p['LST-WINTER-05'](makeCtx(build('Wanderung', '17:45', JULY).b.facts))).toEqual([])
  })
  it('sledding after dark adds the visibility note', () => {
    const hits = p['LST-WINTER-05'](makeCtx(build('Schlitteln', '18:00').b.facts))
    expect(msg(hits[0])).toContain('nur bei genügender Sicht')
  })
})

describe('LST-WINTER-06', () => {
  const build = (safety: string, start = FEB) => {
    const b = new FactsBuilder({ start })
    const a = b.activity('Schneeschuhtour', CAT_LS, { content: { safetyText: safety } })
    b.entry(a, 2, '09:00', '12:00')
    return b
  }
  it('no mention -> hint', () => expect(p['LST-WINTER-06'](makeCtx(build('Wetter beachten').facts))).toHaveLength(1))
  it('Rückmeldung -> none', () => expect(p['LST-WINTER-06'](makeCtx(build('Rückmeldung an Lagerleitung bis 16:00').facts))).toEqual([]))
  it('summer -> none', () => expect(p['LST-WINTER-06'](makeCtx(build('', JULY).facts))).toEqual([]))
})

describe('LST-WINTER-07', () => {
  const build = (title: string) => {
    const b = new FactsBuilder({ start: FEB })
    const a = b.activity(title, CAT_LS)
    b.entry(a, 2, '09:00', '15:00')
    return { b, a }
  }
  it('Skitour -> should with the term; ebb-a tag lowers to hint', () => {
    const { b, a } = build('Skitour Pizol')
    const hits = p['LST-WINTER-07'](makeCtx(b.facts))
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBeUndefined()
    expect(msg(hits[0])).toContain('«Skitour Pizol» enthält «skitour»')
    expect(p['LST-WINTER-07'](makeCtx(b.facts, { campConfig: tagged(a.iri, 'ebb-a') }))[0].severity).toBe('hint')
  })
  it('Schneeschuhtrail -> none', () => expect(p['LST-WINTER-07'](makeCtx(build('Schneeschuhtrail').b.facts))).toEqual([]))
})

describe('LST-WINTER-08', () => {
  const build = (leaders: number) => {
    const b = new FactsBuilder({ start: FEB })
    const a = b.activity('Schneeschuhtour', CAT_LS)
    a.responsibleIris = Array.from({ length: leaders }, (_, i) => `/api/camp_collaborations/cc${i + 1}`)
    b.entry(a, 2, '09:00', '12:00')
    return b
  }
  const run = (leaders: number, participants: number | null) =>
    p['LST-WINTER-08'](makeCtx(build(leaders).facts, { coachInputs: makeCoachInputs({ participantsCount: participants }) }))
  it('30 participants with 2 leaders -> hint', () => {
    const hits = run(2, 30)
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('30 Teilnehmenden sind 2 Leitende verantwortlich')
  })
  it('3 leaders, or unknown participants -> none', () => {
    expect(run(3, 30)).toEqual([])
    expect(run(1, null)).toEqual([])
  })
})
