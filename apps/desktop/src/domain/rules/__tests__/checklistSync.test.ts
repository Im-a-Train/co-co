/** Checklist <-> milestone link: parsing, consistency with the bundled packs, merge rows, write plans. */
import { describe, expect, it } from 'vitest'
import { loadBundledChecklist, parseChecklist, validateChecklist } from '../lib/checklist'
import { buildChecklistRows, planItemToggle, planMilestoneToggle, withDeadlineDone, withMilestoneDone } from '../lib/checklistSync'
import { emptyCoachInputs } from '../../campFacts/store'
import { loadBundledMilestones } from '../milestones'
import type { Deadline } from '../../types'

const CAMP = '/api/camps/c1'
const ms = (id: string, due: string, done = false): Deadline => ({
  campIri: CAMP,
  campTitle: 'L',
  kind: 'pbs-milestone',
  due,
  done,
  ruleId: null,
  source: { title: 's', url: 'https://x.ch' },
  milestoneId: id,
})
const raw = (extra: Record<string, unknown> = {}) => [
  { id: 'CL-LST-04', module: 'lst', audience: 'coach', text: 'x', sources: [{ key: 'WEB-C', page: '' }], kind: 'B', ...extra },
]

describe('checklist milestone link', () => {
  it('parses the optional milestone field', () => {
    expect(parseChecklist(raw({ milestone: 'M-A' }), 't')[0]?.milestone).toBe('M-A')
    expect(parseChecklist(raw(), 't')[0]?.milestone).toBeUndefined()
    expect(() => parseChecklist(raw({ milestone: '' }), 't')).toThrow(/milestone/)
  })

  it('validate flags an unknown milestone id', () => {
    const items = parseChecklist(raw({ milestone: 'M-GIBT-ES-NICHT' }), 't')
    expect(validateChecklist(items, { milestoneIds: ['M-A'] }).join()).toMatch(/Meilenstein M-GIBT-ES-NICHT/)
    expect(validateChecklist(items, { milestoneIds: ['M-GIBT-ES-NICHT'] }).filter((e) => /Meilenstein/.test(e))).toEqual([])
  })

  it('every bundled link points at an existing milestone', () => {
    const ids = new Set(loadBundledMilestones().milestones.map((m) => m.id))
    const linked = loadBundledChecklist().filter((i) => i.milestone)
    expect(linked.length).toBeGreaterThan(0)
    for (const i of linked) expect(ids.has(i.milestone as string), `${i.id} -> ${i.milestone}`).toBe(true)
  })
})

describe('buildChecklistRows', () => {
  const items = parseChecklist(
    [...raw({ milestone: 'M-A' }), { id: 'CL-LST-05', module: 'lst', audience: 'coach', text: 'y', sources: [{ key: 'WEB-C', page: '' }], kind: 'B' }],
    't',
  )
  it('linked rows take done, due and status from the milestone', () => {
    const rows = buildChecklistRows(items, { 'CL-LST-04': { done: true, at: 'x' } }, [ms('M-A', '2026-01-01')], '2026-02-01')
    expect(rows[0]).toMatchObject({ done: false, status: 'overdue', deadline: { due: '2026-01-01' } })
  })
  it('a done milestone makes the item done even without checklist state', () => {
    expect(buildChecklistRows(items, {}, [ms('M-A', '2026-01-01', true)], '2026-02-01')[0]).toMatchObject({ done: true, status: 'done' })
  })
  it('unlinked items and items whose milestone is not in the deadlines use the stored state', () => {
    const rows = buildChecklistRows(items, { 'CL-LST-04': { done: true, at: 'x' }, 'CL-LST-05': { done: true, at: 'x' } }, [], '2026-02-01')
    expect(rows.map((r) => [r.done, r.deadline, r.status])).toEqual([
      [true, null, null],
      [true, null, null],
    ])
  })
})

describe('write plans', () => {
  const items = [{ id: 'CL-A', milestone: 'M-A' }, { id: 'CL-B', milestone: 'M-A' }, { id: 'CL-C' }]
  it('toggling an item writes its milestone first, then the item', () => {
    expect(planItemToggle(items[0] as never, true)).toEqual({ milestone: { id: 'M-A', done: true }, checklist: [{ id: 'CL-A', done: true }] })
    expect(planItemToggle(items[2] as never, true)).toEqual({ checklist: [{ id: 'CL-C', done: true }] })
  })
  it('toggling a milestone marks every linked item', () => {
    expect(planMilestoneToggle('M-A', false, items)).toEqual({
      milestone: { id: 'M-A', done: false },
      checklist: [
        { id: 'CL-A', done: false },
        { id: 'CL-B', done: false },
      ],
    })
    expect(planMilestoneToggle('M-X', true, items).checklist).toEqual([])
  })
})

describe('withDeadlineDone', () => {
  const base = emptyCoachInputs(CAMP)
  it('milestones go to milestonesDone (date = today, cleared on undo)', () => {
    const on = withDeadlineDone(base, { kind: 'pbs-milestone', milestoneId: 'M-A' }, true, '2026-03-01')
    expect(on.milestonesDone).toEqual({ 'M-A': '2026-03-01' })
    expect(withMilestoneDone(on.milestonesDone, 'M-A', true, '2026-04-01')).toEqual({ 'M-A': '2026-03-01' })
    expect(withDeadlineDone(on, { kind: 'pbs-milestone', milestoneId: 'M-A' }, false, '2026-03-02').milestonesDone).toEqual({})
    expect(base.milestonesDone).toBeUndefined()
  })
  it('other kinds write the flags that «Angaben» edits', () => {
    expect(withDeadlineDone(base, { kind: 'nds-registration' }, true, '2026-03-01')).toMatchObject({ ndsRegistered: true, ndsRegisteredOn: '2026-03-01' })
    expect(withDeadlineDone({ ...base, ndsClosed: true, ndsClosedOn: '2026-01-01' }, { kind: 'nds-closing' }, false, '2026-03-01')).toMatchObject({ ndsClosed: false, ndsClosedOn: null })
    expect(withDeadlineDone(base, { kind: 'leihmaterial' }, true, 'x').leihmaterialOrdered).toBe(true)
    expect(withDeadlineDone(base, { kind: 'landeskarten' }, true, 'x').landeskartenOrdered).toBe(true)
    expect(withDeadlineDone(base, { kind: 'lagerbewilligung' }, true, 'x').lagerbewilligungDone).toBe(true)
  })
})
