/** Checklist <-> milestone link: parsing, consistency with the bundled packs, merge rows, write plans. */
import { describe, expect, it } from 'vitest'
import { loadBundledChecklist, parseChecklist, validateChecklist } from '../lib/checklist'
import {
  buildChecklistRows,
  deadlineDateField,
  deadlineDateValue,
  planItemToggle,
  planMilestoneToggle,
  showStatusChip,
  withDeadlineDate,
  withDeadlineDone,
  withMilestoneDone,
} from '../lib/checklistSync'
import { emptyCoachInputs } from '../../campFacts/store'
import { computeMilestoneDeadlines, loadBundledMilestones } from '../milestones'
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
  it('a milestone also covers its skipped twins (sameAs), so an old twin tick cannot keep it ticked', () => {
    const d = { kind: 'pbs-milestone' as const, milestoneId: 'M-A', alsoNamed: [{ id: 'M-TWIN', source: 'Hering', due: '2026-03-10' }] }
    const ticked = { ...base, milestonesDone: { 'M-TWIN': '2026-01-01', 'M-OTHER': '2026-01-02' } }
    expect(withDeadlineDone(ticked, d, false, '2026-03-01').milestonesDone).toEqual({ 'M-OTHER': '2026-01-02' })
    expect(withDeadlineDone(base, d, true, '2026-03-01').milestonesDone).toEqual({ 'M-A': '2026-03-01' })
  })
  it('ticking one target of a twin with several sameAs targets leaves the other one open, and the reverse', () => {
    const list = loadBundledMilestones()
    const twin = list.milestones.find((m) => (m.sameAs?.length ?? 0) > 1)
    expect(twin).toBeDefined()
    const camp = { iri: CAMP, title: 'L', start: '2031-07-10', end: '2031-07-20', lastJsDate: null, lastActivityDate: null }
    const ctx = { isModuleActive: () => true }
    const [a, b] = twin!.sameAs!
    let inputs = base
    const find = (i: typeof base, id: string) => computeMilestoneDeadlines(camp, i, list, ctx).find((x) => x.milestoneId === id)!
    inputs = withDeadlineDone(inputs, find(inputs, a), true, '2031-02-01')
    expect(find(inputs, a).done).toBe(true)
    expect(find(inputs, b).done).toBe(false)
    inputs = withDeadlineDone(base, find(base, b), true, '2031-02-01')
    expect(find(inputs, b).done).toBe(true)
    expect(find(inputs, a).done).toBe(false)
  })
  it('NDS rows drop the NDS badge of the values they change (ADR 0007)', () => {
    const nds = { ...base, ndsRegistered: true, ndsRegisteredOn: '2031-01-05', ndsClosed: true, ndsFields: { ndsRegistered: 'x', ndsRegisteredOn: 'x', ndsClosed: 'x' } }
    expect(withDeadlineDone(nds, { kind: 'nds-registration' }, false, 'd').ndsFields).toEqual({ ndsClosed: 'x' })
    expect(withDeadlineDone(nds, { kind: 'nds-closing' }, false, 'd').ndsFields).toEqual({ ndsRegistered: 'x', ndsRegisteredOn: 'x' })
    expect(withDeadlineDate(nds, 'nds-registration', '2031-01-09').ndsFields).toEqual({ ndsRegistered: 'x', ndsClosed: 'x' })
    expect(withDeadlineDate(nds, 'nds-closing', null).ndsFields).toEqual({ ndsRegistered: 'x', ndsRegisteredOn: 'x', ndsClosed: 'x' })
    expect(withDeadlineDone(base, { kind: 'nds-registration' }, true, 'd').ndsFields).toBeUndefined()
  })
  it('unticking a de-duplicated bundled milestone sticks after recomputing the deadlines', () => {
    const list = loadBundledMilestones()
    const twin = list.milestones.find((m) => m.sameAs?.length)
    expect(twin).toBeDefined()
    const camp = { iri: CAMP, title: 'L', start: '2031-07-10', end: '2031-07-20', lastJsDate: null, lastActivityDate: null }
    const modulesOn = { isModuleActive: () => true }
    const inputs = { ...base, milestonesDone: { [twin!.id]: '2031-01-01' } }
    const target = computeMilestoneDeadlines(camp, inputs, list, modulesOn).find((x) => x.milestoneId === twin!.sameAs![0])
    expect(target).toMatchObject({ done: true })
    expect(target!.alsoNamed?.map((a) => a.id)).toContain(twin!.id)
    const cleared = withDeadlineDone(inputs, target!, false, '2031-02-01')
    const after = computeMilestoneDeadlines(camp, cleared, list, modulesOn).find((x) => x.milestoneId === twin!.sameAs![0])
    expect(after?.done).toBe(false)
  })
})

describe('inline deadline dates', () => {
  const base = emptyCoachInputs(CAMP)
  it('NDS rows carry the done date, order rows the delivery date', () => {
    expect(deadlineDateField('nds-registration')).toBe('done')
    expect(deadlineDateField('nds-closing')).toBe('done')
    expect(deadlineDateField('leihmaterial')).toBe('delivery')
    expect(deadlineDateField('landeskarten')).toBe('delivery')
    expect(deadlineDateField('lagerbewilligung')).toBeNull()
    expect(deadlineDateField('pbs-milestone')).toBeNull()
  })
  it('writes and reads the same fields as «Angaben»', () => {
    const a = withDeadlineDate(base, 'nds-registration', '2026-05-01')
    expect(a.ndsRegisteredOn).toBe('2026-05-01')
    expect(deadlineDateValue(a, 'nds-registration')).toBe('2026-05-01')
    expect(withDeadlineDate(a, 'nds-registration', '').ndsRegisteredOn).toBeNull()
    expect(withDeadlineDate(base, 'leihmaterial', '2026-06-01').leihmaterialDeliveryDate).toBe('2026-06-01')
    expect(withDeadlineDate(base, 'landeskarten', '2026-06-02').landeskartenDeliveryDate).toBe('2026-06-02')
    expect(withDeadlineDate(base, 'lagerbewilligung', '2026-06-02')).toBe(base)
    expect(base.leihmaterialDeliveryDate ?? null).toBeNull()
  })
  it('ticking a delivery row does not touch the delivery date', () => {
    const on = withDeadlineDone(withDeadlineDate(base, 'leihmaterial', '2026-06-01'), { kind: 'leihmaterial' }, true, '2026-03-01')
    expect(on.leihmaterialDeliveryDate).toBe('2026-06-01')
    expect(withDeadlineDone(base, { kind: 'leihmaterial' }, true, '2026-03-01').leihmaterialDeliveryDate ?? null).toBeNull()
  })
  it('status chip only for soon / overdue / done', () => {
    expect(showStatusChip('open')).toBe(false)
    expect(showStatusChip(null)).toBe(false)
    expect(showStatusChip('soon')).toBe(true)
    expect(showStatusChip('overdue')).toBe(true)
    expect(showStatusChip('done')).toBe(true)
  })
})
