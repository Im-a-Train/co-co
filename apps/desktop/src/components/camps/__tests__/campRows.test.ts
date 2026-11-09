import { describe, expect, it } from 'vitest'
import { buildCampRows, campPhase, filterCampRows, filterCampsByPhase, sortCampRows } from '../campRows'
import type { CampListEntry } from '@/domain/types'

const entry = (o: Partial<CampListEntry>): CampListEntry => ({
  iri: '/api/camps/a', id: 'a', title: 'Sola', shortTitle: null, motto: 'Wald', start: '2031-07-20', end: '2031-07-30',
  role: 'manager', isPrototype: false, ...o,
})
const none = { summaries: [], reviews: [], rounds: [], inputs: [] }

describe('campRows', () => {
  it('defaults: review neu, counts null, next deadline computed', () => {
    const [r] = buildCampRows([entry({})], none)
    expect(r.review).toBe('neu')
    expect(r.counts).toBeNull()
    expect(r.nextDeadline?.kind).toBe('leihmaterial')
    expect(r.lastRoundAt).toBeNull()
  })
  it('joins summary, review, latest round and skips done deadlines', () => {
    const [r] = buildCampRows([entry({})], {
      summaries: [{ campIri: '/api/camps/a', title: 'Sola', start: null, end: null, counts: { must: 1, should: 2, hint: 3, overridden: 0 }, validJsDays: null, totalDays: null, evaluatedAt: '' }],
      reviews: [{ campIri: '/api/camps/a', status: 'in_review', history: [], updatedAt: '' }],
      rounds: [
        { id: '1', campIri: '/api/camps/a', number: 1, startedAt: '2031-01-01T00:00:00Z', closedAt: null, snapshotId: 's', note: '', exportedAt: null },
        { id: '2', campIri: '/api/camps/a', number: 2, startedAt: '2031-02-01T00:00:00Z', closedAt: null, snapshotId: 's', note: '', exportedAt: null },
      ],
      inputs: [{ campIri: '/api/camps/a', leihmaterialOrdered: true, landeskartenOrdered: true } as never],
    })
    expect(r.counts?.must).toBe(1)
    expect(r.review).toBe('in_review')
    expect(r.lastRoundAt).toBe('2031-02-01T00:00:00Z')
    expect(r.nextDeadline?.kind).not.toBe('leihmaterial')
    expect(r.nextDeadline?.kind).not.toBe('landeskarten')
  })
  it('filters and sorts', () => {
    const rows = buildCampRows([entry({ title: 'B', iri: '/b', start: null }), entry({ title: 'A', iri: '/a', motto: 'Meer' })], none)
    expect(filterCampRows(rows, 'meer').map((r) => r.title)).toEqual(['A'])
    expect(filterCampRows(rows, ' ')).toHaveLength(2)
    expect(sortCampRows(rows).map((r) => r.title)).toEqual(['A', 'B'])
  })
})

describe('camp phase', () => {
  const today = '2026-11-08'
  it('classifies camps', () => {
    expect(campPhase({ start: null, end: null }, today)).toBe('upcoming')
    expect(campPhase({ start: '2026-12-01', end: '2026-12-08' }, today)).toBe('upcoming')
    expect(campPhase({ start: '2026-11-05', end: '2026-11-12' }, today)).toBe('running')
    expect(campPhase({ start: '2026-11-01', end: '2026-11-08' }, today)).toBe('running')
    expect(campPhase({ start: '2026-10-01', end: '2026-10-07' }, today)).toBe('ended')
    expect(campPhase({ start: '2026-08-01', end: '2026-08-08' }, today)).toBe('ended')
    expect(campPhase({ start: '2026-07-01', end: '2026-08-07' }, today)).toBe('old')
  })
  it('filters by phase, default hides ended and old', () => {
    const rows = buildCampRows(
      [
        entry({ iri: '/up', start: '2026-12-01', end: '2026-12-08' }),
        entry({ iri: '/end', start: '2026-10-01', end: '2026-10-07' }),
        entry({ iri: '/old', start: '2026-02-01', end: '2026-02-07' }),
      ],
      none,
    )
    const iris = (f: { showEnded: boolean; showOld: boolean }) => filterCampsByPhase(rows, f, today).map((r) => r.iri)
    expect(iris({ showEnded: false, showOld: false })).toEqual(['/up'])
    expect(iris({ showEnded: true, showOld: false })).toEqual(['/up', '/end'])
    expect(iris({ showEnded: false, showOld: true })).toEqual(['/up', '/old'])
  })
})
