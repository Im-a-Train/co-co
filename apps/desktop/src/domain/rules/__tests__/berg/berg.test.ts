/** Module lst-berg: LST-BERG-01..04 (catalog v2 §5.5). */
import { describe, expect, it } from 'vitest'
import type { ActivityContent, ActivityTag, DocumentRecord, CoachInputs } from '@/domain/types'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCoachInputs, makeCtx, makeDoc, makeMidata, msg } from '../factory'

interface Opts {
  title: string
  day?: number
  from?: string
  to?: string
  tags?: ActivityTag[]
  content?: Partial<ActivityContent>
  start?: string
  coachInputs?: CoachInputs
  midata?: ReturnType<typeof makeMidata>
  gpxHighest?: number
}

function setup(o: Opts) {
  const b = new FactsBuilder({ start: o.start ?? '2031-07-12', days: 5 })
  const a = b.activity(o.title, CAT_LS, { content: o.content })
  b.entry(a, o.day ?? 2, o.from ?? '09:00', o.to ?? '12:00')
  const documents: DocumentRecord[] =
    o.gpxHighest === undefined
      ? []
      : [makeDoc({ activityIris: [a.iri], gpx: { highestPointM: o.gpxHighest } as DocumentRecord['gpx'] })]
  const ctx = makeCtx(b.facts, {
    campConfig: { activityTags: o.tags ? { [a.iri]: o.tags } : {} },
    coachInputs: o.coachInputs ?? null,
    midata: o.midata,
    documents,
  })
  return { ctx, a }
}

describe('LST-BERG-01 Tour ausserhalb LS/T', () => {
  it('fires for Klettersteig', () => {
    const { ctx } = setup({ title: 'Klettersteig Braunwald' })
    const hits = p['LST-BERG-01'](ctx)
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('Klettersteig')
    expect(hits[0].severity).toBeUndefined()
  })
  it('fires for T5 in material text', () => {
    const { ctx } = setup({ title: 'Tour', content: { materialText: 'Steigeisen und Pickel' } })
    expect(p['LST-BERG-01'](ctx)).toHaveLength(1)
  })
  it('is downgraded to hint when tagged ebb-a', () => {
    const { ctx } = setup({ title: 'Klettersteig Braunwald', tags: ['ebb-a'] })
    const [hit] = p['LST-BERG-01'](ctx)
    expect(hit.severity).toBe('hint')
    expect(msg(hit)).toContain('Bergsteigen')
  })
  it('ignores T2', () => {
    expect(p['LST-BERG-01'](setup({ title: 'Wanderung T2' }).ctx)).toEqual([])
  })
})

describe('LST-BERG-02 T3', () => {
  it('hints for T3', () => {
    const hits = p['LST-BERG-02'](setup({ title: 'Wanderung T3' }).ctx)
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).not.toContain('für Kinder ungeeignet')
  })
  it('adds the kids note for Stufe woelfe', () => {
    const { ctx } = setup({ title: 'Wanderung T3', coachInputs: makeCoachInputs({ stufe: 'woelfe' }) })
    expect(msg(p['LST-BERG-02'](ctx)[0])).toContain('für Kinder ungeeignet')
  })
  it('adds the kids note for participants born less than 10 years before camp (Jahrgang)', () => {
    const { ctx } = setup({ title: 'Wanderung T3', midata: makeMidata({ participantsByBirthYear: { 2023: 3 } }) })
    const [hit] = p['LST-BERG-02'](ctx)
    expect(msg(hit)).toContain('für Kinder ungeeignet')
    expect(hit.redKeys).toContain('kidsPresent')
  })
  it('skips sb-berg activities and T2', () => {
    expect(p['LST-BERG-02'](setup({ title: 'Wanderung T3', tags: ['sb-berg'] }).ctx)).toEqual([])
    expect(p['LST-BERG-02'](setup({ title: 'Wanderung T2' }).ctx)).toEqual([])
  })
})

describe('LST-BERG-03 Gewitter', () => {
  it('hints for a July hike ending 17:30', () => {
    const hits = p['LST-BERG-03'](setup({ title: 'Gipfelwanderung', from: '12:00', to: '17:30' }).ctx)
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('17:30')
  })
  it('is silent when Gewitter is in the safety text', () => {
    const { ctx } = setup({ title: 'Gipfelwanderung', from: '12:00', to: '17:30', content: { safetyText: 'Gewitter: früh umkehren' } })
    expect(p['LST-BERG-03'](ctx)).toEqual([])
  })
  it('is silent outside the thunderstorm months or before the limit, and for supervised baths', () => {
    expect(p['LST-BERG-03'](setup({ title: 'Gipfelwanderung', start: '2031-04-12', from: '12:00', to: '17:30' }).ctx)).toEqual([])
    expect(p['LST-BERG-03'](setup({ title: 'Gipfelwanderung', from: '09:00', to: '15:00' }).ctx)).toEqual([])
    expect(p['LST-BERG-03'](setup({ title: 'Baden im Hallenbad', from: '12:00', to: '17:30' }).ctx)).toEqual([])
  })
  it('also covers water activities', () => {
    expect(p['LST-BERG-03'](setup({ title: 'Baden im See', from: '12:00', to: '17:30' }).ctx)).toHaveLength(1)
  })
})

describe('LST-BERG-04 Altschnee', () => {
  it('hints for 2300 m in June', () => {
    const hits = p['LST-BERG-04'](setup({ title: 'Wanderung', start: '2031-06-10', gpxHighest: 2300 }).ctx)
    expect(hits).toHaveLength(1)
    const text = msg(hits[0])
    expect(text).toContain('2300')
    expect(text).toContain('Juni')
  })
  it('is silent for 2300 m in August and when snow/fog is mentioned', () => {
    expect(p['LST-BERG-04'](setup({ title: 'Wanderung', start: '2031-08-10', gpxHighest: 2300 }).ctx)).toEqual([])
    expect(p['LST-BERG-04'](setup({ title: 'Wanderung', start: '2031-06-10', gpxHighest: 2300, content: { safetyText: 'Bei Nebel Variante' } }).ctx)).toEqual([])
  })
  it('uses the low-altitude window (1200 m in November)', () => {
    expect(p['LST-BERG-04'](setup({ title: 'Wanderung', start: '2031-11-05', gpxHighest: 1200 }).ctx)).toHaveLength(1)
    expect(p['LST-BERG-04'](setup({ title: 'Wanderung', start: '2031-07-05', gpxHighest: 1200 }).ctx)).toEqual([])
  })
})
