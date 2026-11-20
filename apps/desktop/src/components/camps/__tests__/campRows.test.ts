import { describe, expect, it } from 'vitest'
import { approvedWithOpenMust, buildCampRows, campNext, campPhase, endedCount, filterCampRows, filterCampsByPhase, findingsText, sortCampRows } from '../campRows'
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
      today,
    )
    const iris = (showEnded: boolean) => filterCampsByPhase(rows, { showEnded }, today).map((r) => r.iri)
    expect(iris(false)).toEqual(['/up'])
    expect(iris(true)).toEqual(['/up', '/end', '/old'])
    expect(endedCount(rows, today)).toBe(2)
  })
})

describe('sort and archive', () => {
  const today = '2026-11-08'
  it('running, then upcoming by start, then ended by end descending', () => {
    const rows = buildCampRows(
      [
        entry({ iri: '/e1', title: 'E1', start: '2026-09-01', end: '2026-09-08' }),
        entry({ iri: '/u2', title: 'U2', start: '2026-12-20', end: '2026-12-27' }),
        entry({ iri: '/r', title: 'R', start: '2026-11-05', end: '2026-11-12' }),
        entry({ iri: '/u1', title: 'U1', start: '2026-12-01', end: '2026-12-08' }),
        entry({ iri: '/e2', title: 'E2', start: '2026-10-01', end: '2026-10-07' }),
      ],
      none,
      today,
    )
    expect(sortCampRows(rows, today).map((r) => r.iri)).toEqual(['/r', '/u1', '/u2', '/e2', '/e1'])
  })
  it('archived camps show no open deadline', () => {
    const [ended, recent] = buildCampRows(
      [entry({ iri: '/a', start: '2026-05-01', end: '2026-05-08' }), entry({ iri: '/b', start: '2026-10-25', end: '2026-11-01' })],
      none,
      today,
    )
    expect(ended.archived).toBe(true)
    expect(ended.nextDeadline).toBeNull()
    expect(recent.archived).toBe(false)
  })
})

describe('next step, findings text, approval', () => {
  const base = { progress: null, review: 'neu' as const, lastRoundAt: null, lastRoundNumber: null }
  const progress = (nextStep: string | null, triageOpen = 0) => ({ percent: 10, nextStep, triageOpen, openMust: 0, updatedAt: '' })
  it('derives the next step text', () => {
    expect(campNext(base)).toEqual({ key: 'never', params: {} })
    expect(campNext({ ...base, progress: progress('triage', 17) })).toEqual({ key: 'triage', params: { n: 17 } })
    expect(campNext({ ...base, progress: progress('feedback') })).toEqual({ key: 'feedback', params: {} })
    expect(campNext({ ...base, progress: progress(null) })).toEqual({ key: 'done', params: {} })
    expect(campNext({ ...base, review: 'aenderungen_angefragt', lastRoundAt: '2026-11-12T08:00:00Z', lastRoundNumber: 2 })).toEqual({
      key: 'waitingSince',
      params: { n: 2, date: '12.11.2026' },
    })
    expect(campNext({ ...base, review: 'aenderungen_angefragt' }).key).toBe('waiting')
    // approved: finished even when a later step (documents, checklist) was never ticked
    expect(campNext({ ...base, review: 'bewilligt', progress: progress('documents') }).key).toBe('done')
    expect(campNext({ ...base, review: 'bewilligt_mit_auflagen' }).key).toBe('done')
  })
  it('colours findings by the most severe bucket', () => {
    expect(findingsText(null)).toBeNull()
    expect(findingsText({ must: 2, should: 5, hint: 17, overridden: 0 })?.tone).toBe('error')
    expect(findingsText({ must: 0, should: 5, hint: 17, overridden: 0 })?.tone).toBe('warning')
    expect(findingsText({ must: 0, should: 0, hint: 3, overridden: 0 })?.tone).toBe('info')
    expect(findingsText({ must: 0, should: 0, hint: 0, overridden: 0 })?.tone).toBe('neutral')
  })
  it('flags approved camps with an open Muss', () => {
    const counts = { must: 1, should: 0, hint: 0, overridden: 0 }
    expect(approvedWithOpenMust({ review: 'bewilligt', counts })).toBe(1)
    expect(approvedWithOpenMust({ review: 'in_review', counts })).toBe(0)
    expect(approvedWithOpenMust({ review: 'bewilligt', counts: { ...counts, must: 0 } })).toBe(0)
  })
  it('keeps the persisted progress on the row', () => {
    const [r] = buildCampRows(
      [entry({})],
      { ...none, summaries: [{ campIri: '/api/camps/a', title: 'S', start: null, end: null, counts: { must: 0, should: 0, hint: 0, overridden: 0 }, validJsDays: null, totalDays: null, evaluatedAt: '', progress: progress('inputs') }] },
    )
    expect(r.progress?.nextStep).toBe('inputs')
  })
})
