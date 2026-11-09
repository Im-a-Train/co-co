import { describe, expect, it } from 'vitest'
import { toIcs } from '../../rules/ics'
import { isNdsTaskDone, ndsTasksToDeadlines } from '../tasks'
import type { NdsTask } from '@/lib/tauri'

const task = (over: Partial<NdsTask>): NdsTask => ({
  businessId: '42',
  title: 'Lagerbericht',
  correlationTitle: 'Sommerlager',
  dueDate: '2026-12-15',
  escalationDate: null,
  processingStatus: 'OPEN',
  ...over,
})

describe('ndsTasksToDeadlines', () => {
  it('maps tasks with a due date, skips others, sorts by due', () => {
    const out = ndsTasksToDeadlines(
      [task({ businessId: '1', dueDate: '2026-12-20' }), task({ businessId: '2', dueDate: null }), task({ businessId: '3', dueDate: '2026-12-01', correlationTitle: null })],
      '2026-11-09',
    )
    expect(out.map((d) => d.campIri)).toEqual(['nds:3', 'nds:1'])
    expect(out[0]).toMatchObject({ kind: 'nds-task', campTitle: 'NDS', audience: 'coach', done: false, source: null })
  })
  it('marks finished states done and mentions the escalation date', () => {
    expect(isNdsTaskDone('completed')).toBe(true)
    expect(isNdsTaskDone('OPEN')).toBe(false)
    expect(isNdsTaskDone(null)).toBe(false)
    const [d] = ndsTasksToDeadlines([task({ processingStatus: 'DONE', escalationDate: '2026-12-31' })], '2026-11-09', {
      escalation: (x) => `(Eskalation ${x})`,
    })
    expect(d.done).toBe(true)
    expect(d.title).toBe('Lagerbericht (Eskalation 2026-12-31)')
  })
  it('exports to ICS with a stable uid', () => {
    const ds = ndsTasksToDeadlines([task({})], '2026-11-09')
    const ics = toIcs(ds, { titleOf: (d) => d.title ?? '', now: new Date('2026-11-09T10:00:00Z') })
    expect(ics).toContain('UID:nds42-nds-task@co-co')
    expect(ics).toContain('SUMMARY:Sommerlager: Lagerbericht')
    expect(ics).toContain('DTSTART;VALUE=DATE:20261215')
  })
})
