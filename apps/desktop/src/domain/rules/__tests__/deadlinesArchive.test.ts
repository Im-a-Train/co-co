import { describe, expect, it } from 'vitest'
import { addMonths, archiveDeadlines, filterDeadlines, isArchivedCamp, type DeadlineFilter } from '../deadlines'
import type { Deadline, DeadlineKind } from '../../types'

const dl = (campIri: string, kind: DeadlineKind, due: string, done = false): Deadline => ({
  campIri,
  campTitle: campIri,
  kind,
  due,
  done,
  ruleId: null,
  source: null,
})

describe('archive and filter', () => {
  it('addMonths clamps the day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15')
  })
  it('isArchivedCamp: more than one month after the end', () => {
    expect(isArchivedCamp('2026-10-08', '2026-11-08')).toBe(false)
    expect(isArchivedCamp('2026-10-07', '2026-11-08')).toBe(true)
    expect(isArchivedCamp(null, '2026-11-08')).toBe(false)
  })
  it('archiveDeadlines marks only archived camps', () => {
    const out = archiveDeadlines([dl('/a', 'nds-closing', '2026-01-01'), dl('/b', 'nds-closing', '2026-01-01')], { '/a': '2026-01-10', '/b': '2026-11-01' }, '2026-11-08')
    expect(out[0]).toMatchObject({ done: true, archived: true })
    expect(out[1].done).toBe(false)
    expect(out[1].archived).toBeUndefined()
  })
  it('filterDeadlines by camp, kind and status', () => {
    const list = [dl('/a', 'leihmaterial', '2026-11-01'), dl('/a', 'nds-closing', '2026-12-30'), dl('/b', 'leihmaterial', '2026-11-10', true)]
    const f: DeadlineFilter = { campIris: [], kinds: [], statuses: [] }
    expect(filterDeadlines(list, f, '2026-11-08')).toHaveLength(3)
    expect(filterDeadlines(list, { ...f, campIris: ['/a'] }, '2026-11-08')).toHaveLength(2)
    expect(filterDeadlines(list, { ...f, kinds: ['leihmaterial'] }, '2026-11-08')).toHaveLength(2)
    expect(filterDeadlines(list, { ...f, statuses: ['overdue'] }, '2026-11-08').map((d) => d.campIri)).toEqual(['/a'])
    expect(filterDeadlines(list, { ...f, statuses: ['done', 'open'] }, '2026-11-08')).toHaveLength(2)
  })
})
