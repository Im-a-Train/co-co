import { describe, expect, it } from 'vitest'
import { computeDeadlines } from '../lib/deadlines'
import { defaultCampRuleConfig, normalizeCampRuleConfig } from '../lib/campRuleConfig'
import { withChecklistHidden, withCustomChecklistItem, withoutCustomChecklistItem, withChecklistItem } from '../lib/campConfigEdit'
import { buildCustomRows, coachDeadlines, deadlineKey, splitHidden } from '../lib/checklistSync'
import { computeMilestoneDeadlines, loadBundledMilestones } from '../milestones'

const IRI = '/api/camps/c1'
const camp = { iri: IRI, title: 'L', start: '2026-07-10', end: '2026-07-20' }

describe('coach deadline filtering', () => {
  it('built-in deadlines are coach; leader milestones are filtered out', () => {
    const builtin = computeDeadlines(camp, null)
    expect(builtin.every((d) => d.audience === 'coach')).toBe(true)
    const ms = computeMilestoneDeadlines(camp, null, loadBundledMilestones())
    const coach = coachDeadlines(ms)
    expect(coach.length).toBeGreaterThan(0)
    expect(coach.length).toBeLessThan(ms.length)
    expect(coach.every((d) => d.audience === 'coach')).toBe(true)
    expect(coachDeadlines([{ audience: undefined }]).length).toBe(1)
  })

  it('deadlineKey distinguishes milestones', () => {
    expect(deadlineKey({ kind: 'nds-closing' })).toBe('nds-closing')
    expect(deadlineKey({ kind: 'pbs-milestone', milestoneId: 'x' })).toBe('pbs-milestone:x')
  })
})

describe('custom + hidden checklist edits', () => {
  it('adds, trims, rejects empty and removes custom points incl. their done state', () => {
    let c = defaultCampRuleConfig(IRI)
    expect(withCustomChecklistItem(c, { id: 'CL-CUSTOM-1', text: '  ' })).toBe(c)
    c = withCustomChecklistItem(c, { id: 'CL-CUSTOM-1', text: ' Besuch planen ', due: '2026-06-01' }, '2026-01-01T00:00:00.000Z')
    c = withCustomChecklistItem(c, { id: 'CL-CUSTOM-2', text: 'Ohne Datum' })
    expect(c.customChecklist?.map((i) => [i.id, i.text, i.due])).toEqual([
      ['CL-CUSTOM-1', 'Besuch planen', '2026-06-01'],
      ['CL-CUSTOM-2', 'Ohne Datum', undefined],
    ])
    c = withChecklistItem(c, 'CL-CUSTOM-1', { done: true })
    c = withoutCustomChecklistItem(c, 'CL-CUSTOM-1')
    expect(c.customChecklist?.map((i) => i.id)).toEqual(['CL-CUSTOM-2'])
    expect(c.checklist['CL-CUSTOM-1']).toBeUndefined()
  })

  it('hides and restores without duplicates; missing field counts as empty', () => {
    let c = defaultCampRuleConfig(IRI)
    expect(c.hiddenChecklist).toBeUndefined()
    c = withChecklistHidden(c, 'CL-JS-01', true)
    c = withChecklistHidden(c, 'CL-JS-01', true)
    expect(c.hiddenChecklist).toEqual(['CL-JS-01'])
    c = withChecklistHidden(c, 'CL-JS-01', false)
    expect(c.hiddenChecklist).toEqual([])
  })

  it('splitHidden separates shown and hidden', () => {
    const r = splitHidden([{ id: 'a' }, { id: 'b' }], (e) => e.id, ['b'])
    expect(r.shown).toEqual([{ id: 'a' }])
    expect(r.hiddenEntries).toEqual([{ id: 'b' }])
    expect(splitHidden([{ id: 'a' }], (e) => e.id, undefined).shown.length).toBe(1)
  })

  it('custom rows: done state and deadline status', () => {
    const items = [
      { id: 'CL-CUSTOM-1', text: 'a', due: '2026-05-01', createdAt: 'x' },
      { id: 'CL-CUSTOM-2', text: 'b', createdAt: 'x' },
    ]
    const rows = buildCustomRows(items, { 'CL-CUSTOM-2': { done: true, at: 'x' } }, '2026-05-10')
    expect(rows[0]).toMatchObject({ done: false, status: 'overdue', left: -9 })
    expect(rows[1]).toMatchObject({ done: true, status: null, left: null })
    expect(buildCustomRows(undefined, {}, '2026-05-10')).toEqual([])
  })

  it('normalize keeps the new fields, drops malformed entries, tolerates old records', () => {
    const n = normalizeCampRuleConfig(
      { customChecklist: [{ id: 'CL-CUSTOM-1', text: 'a', createdAt: 'x' }, { bogus: 1 }], hiddenChecklist: ['CL-JS-01', 5] },
      IRI,
    )
    expect(n.customChecklist).toHaveLength(1)
    expect(n.hiddenChecklist).toEqual(['CL-JS-01'])
    const old = normalizeCampRuleConfig({ sport: 'lst' }, IRI)
    expect(old.customChecklist).toBeUndefined()
    expect(old.hiddenChecklist).toBeUndefined()
  })
})
