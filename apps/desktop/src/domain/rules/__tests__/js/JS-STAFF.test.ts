import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { FactsBuilder, makeCoachInputs, makeCtx, makeMidata, msg, ruleMeta } from '../factory'
import type { MidataAggregate } from '@/domain/types'

const f = new FactsBuilder().facts
const leaders = (validLeaders: number): Partial<MidataAggregate> => ({
  qualificationsReadable: true,
  qualificationKinds: [{ label: 'Leiter/in LS/T', keys: ['leiterLsT'], validLeaders, expiredLeaders: 0 }],
})

describe('JS-STAFF-01', () => {
  it('is retired and never fires', () => {
    expect(ruleMeta('JS-STAFF-01').status).toBe('retired')
    expect(p['JS-STAFF-01'](makeCtx(f, { coachInputs: makeCoachInputs({ participantsCount: 50, leadersCount: 1 }) }))).toEqual([])
  })
})

describe('JS-STAFF-02', () => {
  it('is must/verified', () => {
    expect(ruleMeta('JS-STAFF-02')).toMatchObject({ severity: 'must', confidence: 'verified' })
  })
  it('fires with one valid leiterLsT in MiData (must)', () => {
    const hits = p['JS-STAFF-02'](makeCtx(f, { midata: makeMidata(leaders(1)) }))
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBeUndefined()
    expect(msg(hits[0])).toContain('1 J+S-Leitende')
    expect(hits[0].redKeys).toContain('validJsLeaders')
  })
  it('passes with two valid leaders', () => {
    expect(p['JS-STAFF-02'](makeCtx(f, { midata: makeMidata(leaders(2)) }))).toEqual([])
  })
  it('hints «Anzahl unbekannt» without MiData and coach count', () => {
    const hits = p['JS-STAFF-02'](makeCtx(f))
    expect(hits[0].severity).toBe('hint')
    expect(msg(hits[0])).toContain('Anzahl J+S-Leitende unbekannt')
  })
  it('falls back to the coach count, also when qualifications are not readable', () => {
    const unreadable = makeMidata({ qualificationsReadable: false, qualificationKinds: leaders(5).qualificationKinds })
    expect(p['JS-STAFF-02'](makeCtx(f, { midata: unreadable, coachInputs: makeCoachInputs({ jsLeadersCount: 1 }) }))).toHaveLength(1)
    expect(p['JS-STAFF-02'](makeCtx(f, { coachInputs: makeCoachInputs({ jsLeadersCount: 2 }) }))).toEqual([])
  })
})

describe('JS-STAFF-03', () => {
  it('is hint/unverified', () => {
    expect(ruleMeta('JS-STAFF-03')).toMatchObject({ severity: 'hint', confidence: 'unverified' })
  })
  it('fires with 2 leaders and 40 participants (max 32)', () => {
    const md = makeMidata({ ...leaders(2), participantsCount: 40, participantsJsAgeCount: 40 })
    const hits = p['JS-STAFF-03'](makeCtx(f, { midata: md }))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('höchstens für 32 Teilnehmende')
  })
  it('is silent with 3 leaders and 40 participants', () => {
    const md = makeMidata({ ...leaders(3), participantsCount: 40, participantsJsAgeCount: 40 })
    expect(p['JS-STAFF-03'](makeCtx(f, { midata: md }))).toEqual([])
  })
})
