import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, msg } from '../factory'
import { Y2027 } from './helpers'

const elsewhere = { angebot: { other4DayCamp: null, unternehmungElsewhere: true, efCoveredElsewhere: null, lastActivityDate: null } }

function camp(...titles: Array<[string, string | null]>) {
  const b = new FactsBuilder({ start: Y2027, days: 4 })
  for (const [t, loc] of titles) b.entry(b.activity(t, CAT_LS, { location: loc }), 2, '09:00', '11:00')
  return b
}

describe('LST-ANG-01', () => {
  it('no hike in the programme -> should', () => {
    const hits = p['LST-ANG-01'](makeCtx(camp(['Basteln', null], ['Geländespiel', null]).facts))
    expect(hits).toHaveLength(1)
    expect(hits[0].targets).toEqual(['/api/camps/c1'])
    expect(msg(hits[0])).toContain('keine Unternehmung erkennbar')
  })
  it('«Tageswanderung Napf» -> none', () => {
    expect(p['LST-ANG-01'](makeCtx(camp(['Tageswanderung Napf', null]).facts))).toEqual([])
  })
  it('a hike at the camp address does not count; a hike elsewhere does', () => {
    const b = camp(['Wanderung', 'Sörenberg'])
    b.facts.camp.address.city = 'Sörenberg'
    expect(p['LST-ANG-01'](makeCtx(b.facts))).toHaveLength(1)
    b.facts.activities[0].location = 'Brienzer Rothorn'
    expect(p['LST-ANG-01'](makeCtx(b.facts))).toEqual([])
  })
  it('tag unternehmung satisfies, tag keine-unternehmung excludes, elsewhere flag skips', () => {
    const b = camp(['Basteln', null], ['Wanderung', null])
    const [bastel, wander] = b.facts.activities
    expect(p['LST-ANG-01'](makeCtx(b.facts, { campConfig: { activityTags: { [bastel.iri]: ['unternehmung'] } } }))).toEqual([])
    expect(p['LST-ANG-01'](makeCtx(b.facts, { campConfig: { activityTags: { [wander.iri]: ['keine-unternehmung'] } } }))).toHaveLength(1)
    expect(p['LST-ANG-01'](makeCtx(camp(['Basteln', null]).facts, { campConfig: elsewhere }))).toEqual([])
  })
  it('is silent without mapping', () => {
    expect(p['LST-ANG-01'](makeCtx(camp(['Basteln', null]).facts, { mapping: null }))).toEqual([])
  })
})
