import { describe, expect, it } from 'vitest'
import type { NdsCampSummary } from '../../types'
import { rankNdsCamps, SUGGEST_MIN_SCORE } from '../match'

const cand = (over: Partial<NdsCampSummary>): NdsCampSummary => ({
  offerBusinessId: 'o',
  campBusinessId: 'c',
  offerNumber: null,
  offerItemNumber: null,
  groupName: null,
  start: null,
  end: null,
  offerState: null,
  offerItemState: null,
  ...over,
})
const camp = { title: 'Sommerlager Bärenwald 2026', shortTitle: 'SoLa', organizer: 'Pfadi Bärenstark', start: '2026-07-12', end: '2026-07-20' }

describe('rankNdsCamps', () => {
  it('scores identical dates plus name and suggests a clear leader', () => {
    const r = rankNdsCamps(camp, [
      cand({ campBusinessId: 'a', groupName: 'Abteilung Bärenstark', organisationName: 'Pfadi Bärenstark', start: '2026-07-12', end: '2026-07-20' }),
      cand({ campBusinessId: 'b', groupName: 'Andere', organisationName: 'Pfadi Anders', start: '2026-09-01', end: '2026-09-05' }),
    ])
    expect(r[0]!.camp.campBusinessId).toBe('a')
    expect(r[0]!.reasons).toEqual(expect.arrayContaining(['sameDates', 'nameMatch']))
    expect(r[0]!.score).toBeGreaterThanOrEqual(SUGGEST_MIN_SCORE)
    expect(r[0]!.suggested).toBe(true)
    expect(r[1]!.suggested).toBe(false)
    expect(r[1]!.score).toBe(0)
  })
  it('overlapping dates score proportionally', () => {
    const [x] = rankNdsCamps(camp, [cand({ start: '2026-07-16', end: '2026-07-24' })])
    expect(x!.reasons).toEqual(['overlapDates'])
    expect(x!.score).toBeCloseTo((0.35 * 5) / 9)
  })
  it('missing dates give no date score; organisation bonus uses the coach orgs', () => {
    const [x] = rankNdsCamps({ ...camp, start: null, end: null }, [cand({ organisationName: 'Pfadi Müllerhausen' })], ['pfadi muellerhausen'])
    expect(x!.reasons).toEqual(['organisation'])
    expect(x!.score).toBeCloseTo(0.15)
  })
  it('stop words and short tokens alone are no name match', () => {
    const [x] = rankNdsCamps(camp, [cand({ groupName: 'Sommerlager 2026 Pfadi' })])
    expect(x!.reasons).toEqual([])
  })
  it('no suggestion when the margin is too small or the score too low', () => {
    const two = rankNdsCamps(camp, [
      cand({ campBusinessId: 'a', start: '2026-07-12', end: '2026-07-20', groupName: 'Bärenstark' }),
      cand({ campBusinessId: 'b', start: '2026-07-12', end: '2026-07-20', groupName: 'Bärenstark' }),
    ])
    expect(two.every((x) => !x.suggested)).toBe(true)
    const low = rankNdsCamps(camp, [cand({ start: '2026-07-19', end: '2026-07-25' })])
    expect(low[0]!.suggested).toBe(false)
  })
  it('sorts ties by start date then group name, deterministically', () => {
    const r = rankNdsCamps({ ...camp, start: null, end: null }, [
      cand({ campBusinessId: 'z', groupName: 'B', start: '2026-02-01' }),
      cand({ campBusinessId: 'y', groupName: 'A', start: '2026-02-01' }),
      cand({ campBusinessId: 'x', groupName: 'C', start: '2026-01-01' }),
    ])
    expect(r.map((x) => x.camp.campBusinessId)).toEqual(['x', 'y', 'z'])
    expect(rankNdsCamps(camp, [])).toEqual([])
  })
})
