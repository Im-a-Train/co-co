/** Review regression: JS-STAFF-02/03 count DISTINCT leaders, never the sum over qualification kinds. */
import { describe, expect, it } from 'vitest'
import type { AppSettings, MidataLeader, MidataQualKey } from '@/domain/types'
import { DEFAULT_APP_SETTINGS } from '@/domain/types'
import { allPredicates as p } from '../predicates'
import { FactsBuilder, makeCtx, makeMidata } from '../factory'

const f = new FactsBuilder().facts
const leader = (nickname: string, leiterLsT: boolean): MidataLeader => ({
  nickname,
  roleLabel: 'Leitung',
  qualifications: { lagerleiter: false, leiterLsT, wasser: false, berg: false, winter: false, slrg: false },
})
const kinds = [
  { label: 'J+S-Leiter/in LS/T', keys: ['leiterLsT' as MidataQualKey], validLeaders: 1, expiredLeaders: 0 },
  { label: 'Zusatz Lagerleiter LS/T', keys: ['leiterLsT' as MidataQualKey], validLeaders: 1, expiredLeaders: 0 },
]

describe('distinct J+S leaders', () => {
  it('one person with two LS/T kinds counts once (JS-STAFF-02 fires)', () => {
    const md = makeMidata({ qualificationsReadable: true, qualificationKinds: kinds, leaders: [leader('A', true), leader('B', false)] })
    expect(p['JS-STAFF-02'](makeCtx(f, { midata: md }))).toHaveLength(1)
  })
  it('two distinct leaders pass', () => {
    const md = makeMidata({ qualificationsReadable: true, qualificationKinds: kinds, leaders: [leader('A', true), leader('B', true)] })
    expect(p['JS-STAFF-02'](makeCtx(f, { midata: md }))).toEqual([])
  })
  it('JS-STAFF-03 uses the same distinct count', () => {
    const md = makeMidata({
      qualificationsReadable: true,
      qualificationKinds: kinds,
      leaders: [leader('A', true)],
      participantsCount: 40,
      participantsJsAgeCount: 40,
    })
    const hits = p['JS-STAFF-03'](makeCtx(f, { midata: md }))
    expect(hits).toHaveLength(1)
    expect(hits[0].inputs?.validJsLeaders).toBe(1)
  })
  it('without leaders the fallback takes the MAX over kinds, not the sum', () => {
    const md = makeMidata({ qualificationsReadable: true, qualificationKinds: kinds, leaders: [] })
    expect(p['JS-STAFF-02'](makeCtx(f, { midata: md }))).toHaveLength(1)
  })
  it('respects the coach qualMapping (override moves a label out of leiterLsT)', () => {
    const md = makeMidata({ qualificationsReadable: true, qualificationKinds: kinds, leaders: [leader('A', true), leader('B', true)] })
    const settings: AppSettings = { ...DEFAULT_APP_SETTINGS, midata: { ...DEFAULT_APP_SETTINGS.midata, qualMapping: { 'Zusatz Lagerleiter LS/T': [] } } }
    // Override changes the label set: kind fallback, max over remaining kinds = 1
    expect(p['JS-STAFF-02'](makeCtx(f, { midata: md, settings }))).toHaveLength(1)
  })
})
