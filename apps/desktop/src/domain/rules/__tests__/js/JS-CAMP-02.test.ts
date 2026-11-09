import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { FactsBuilder, makeCoachInputs, makeCtx, makeMidata, msg, ruleMeta } from '../factory'

describe('JS-CAMP-02', () => {
  const f = new FactsBuilder({ start: '2027-07-12' }).facts
  const run = (over: Parameters<typeof makeCtx>[1] = {}) => p['JS-CAMP-02'](makeCtx(f, over))

  it('is must/verified', () => {
    expect(ruleMeta('JS-CAMP-02')).toMatchObject({ severity: 'must', confidence: 'verified', version: '2.0.0' })
  })
  it('asks for input when nothing is known (hint, «Angabe fehlt»)', () => {
    const hits = run()
    expect(hits[0].severity).toBe('hint')
    expect(msg(hits[0])).toContain('Angabe fehlt')
  })
  it('uses the coach J+S-age count: 11 fires (must), 12 passes', () => {
    const hits = run({ coachInputs: makeCoachInputs({ participantsJsAgeCount: 11 }) })
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBeUndefined()
    expect(hits[0].variant).toBeUndefined()
    expect(msg(hits[0])).toContain('nicht beitragsberechtigt')
    expect(run({ coachInputs: makeCoachInputs({ participantsJsAgeCount: 12 }) })).toEqual([])
  })
  it('falls back to the total count with variant ageUnknown and severity should', () => {
    const hits = run({ coachInputs: makeCoachInputs({ participantsCount: 9 }) })
    expect(hits[0].variant).toBe('ageUnknown')
    expect(hits[0].severity).toBe('should')
    expect(msg(hits[0])).toMatch(/9/)
    expect(run({ coachInputs: makeCoachInputs({ participantsCount: 12 }) })).toEqual([])
  })
  it('counts MiData by Jahrgang (camp year 2027: born 2007–2022)', () => {
    // 8 in J+S age (2010) + 6 too old (2000) = 14 total, but only 8 count
    const md = makeMidata({ participantsCount: 14, participantsJsAgeCount: 14, participantsByBirthYear: { 2010: 8, 2000: 6 } })
    const hits = run({ midata: md })
    expect(hits).toHaveLength(1)
    expect(hits[0].params?.count).toBe(8)
    expect(hits[0].redKeys).toContain('participants')
    expect(run({ midata: makeMidata({ participantsByBirthYear: { 2010: 12 } }) })).toEqual([])
  })
  it('is silent for camps marked as non-J+S', () => {
    expect(run({ coachInputs: makeCoachInputs({ isJsCamp: false }) })).toEqual([])
  })
})
