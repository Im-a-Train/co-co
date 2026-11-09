/** Coach checklist data, loader, visibility and the pure config edits of the coach UI. */
import { describe, expect, it } from 'vitest'
import { defaultCampRuleConfig } from '../lib/campRuleConfig'
import { withActivityTags, withChecklistItem, withModuleState, withSbApproval } from '../lib/campConfigEdit'
import {
  campOverlapsMonths,
  checklistProgress,
  groupChecklist,
  loadBundledChecklist,
  parseChecklist,
  validateChecklist,
  visibleChecklist,
  type ChecklistContext,
} from '../lib/checklist'
import { parse } from 'yaml'
import { getSourceRegistry } from '../packs/registry'
import type { ModuleId, ModuleResolution } from '../../types'
import { MODULE_IDS } from '../../types'

/** pack.yaml read directly, so this test does not depend on the predicates of other packs being complete. */
const packYamls = import.meta.glob('../packs/*/pack.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const on = (): ModuleResolution => ({ state: 'on', coachState: 'auto', reasons: [] })
const states = (...ids: ModuleId[]) => Object.fromEntries(ids.map((i) => [i, on()])) as ChecklistContext['moduleStates']

function ctx(over: Partial<ChecklistContext> = {}): ChecklistContext {
  const c = defaultCampRuleConfig('/api/camps/c1')
  return { moduleStates: states(...MODULE_IDS), config: c, coachInputs: null, campInWinter: false, ...over }
}

describe('bundled checklist', () => {
  const items = loadBundledChecklist()

  it('contains all 58 items of catalog §8 with unique ids', () => {
    expect(items).toHaveLength(58)
    expect(new Set(items.map((i) => i.id)).size).toBe(58)
  })

  it('every source resolves and every module exists in the bundled packs', () => {
    const moduleIds = Object.values(packYamls).flatMap((t) => (parse(t).modules as { id: string }[]).map((m) => m.id))
    expect(validateChecklist(items, { registry: getSourceRegistry(), moduleIds })).toEqual([])
  })

  it('kinds: combined cells carry two kinds', () => {
    expect(items.find((i) => i.id === 'CL-LAGER-06')!.kinds).toEqual(['2014', 'B'])
    expect(items.find((i) => i.id === 'CL-JS-01')!.kinds).toEqual(['B'])
    expect(items.find((i) => i.id === 'CL-PBS-01')!.module).toBe('pbs')
  })
})

describe('parseChecklist / validateChecklist', () => {
  const base = { id: 'CL-JS-99', module: 'js', audience: 'coach', text: 'x', sources: [{ key: 'MAN', page: 'S. 1' }], kind: 'B' }

  it('rejects bad structure', () => {
    expect(() => parseChecklist([{ ...base, kind: 'X' }], 't')).toThrow(/kind ungültig/)
    expect(() => parseChecklist([{ ...base, audience: undefined }], 't')).toThrow(/audience/)
    expect(() => parseChecklist([{ ...base, audience: 'all' }], 't')).toThrow(/audience/)
    expect(parseChecklist([{ ...base, audience: 'leaders' }], 't')[0].audience).toBe('leaders')
    expect(() => parseChecklist([{ ...base, module: 'nope' }], 't')).toThrow(/Modul ungültig/)
    expect(() => parseChecklist([{ ...base, sources: [] }], 't')).toThrow(/Quelle/)
    expect(() => parseChecklist([{ ...base, showWhen: [{ bogus: 1 }] }], 't')).toThrow(/showWhen/)
  })

  it('reports unknown sources, unknown modules and duplicate ids', () => {
    const items = parseChecklist([{ ...base, sources: [{ key: 'NOPE', page: '' }] }, base, base], 't')
    const errors = validateChecklist(items, { moduleIds: ['lst'] })
    expect(errors.some((e) => e.includes('NOPE'))).toBe(true)
    expect(errors.some((e) => e.includes('doppelte id'))).toBe(true)
    expect(errors.some((e) => e.includes('Modul js existiert nicht'))).toBe(true)
  })
})

describe('visibleChecklist', () => {
  const items = loadBundledChecklist()
  const ids = (c: ChecklistContext) => visibleChecklist(items, c).map((i) => i.id)

  it('shows only items of effectively active modules', () => {
    const only = ids(ctx({ moduleStates: states('js') }))
    expect(only.every((id) => id.startsWith('CL-JS'))).toBe(true)
    const suggested = ctx({ moduleStates: { ...states('js'), 'lst-berg': { state: 'suggested', coachState: 'auto', reasons: [] } } })
    expect(ids(suggested).some((id) => id.startsWith('CL-BERG'))).toBe(false)
    expect(ids(ctx()).some((id) => id.startsWith('CL-BERG'))).toBe(true)
  })

  it('conditional items follow showWhen', () => {
    const base = ids(ctx())
    expect(base).not.toContain('CL-JS-09')
    expect(base).not.toContain('CL-LAGER-10')
    expect(base).not.toContain('CL-LST-04')
    expect(base).not.toContain('CL-JS-08')

    const c = defaultCampRuleConfig('/api/camps/c1')
    expect(ids(ctx({ config: { ...c, camp: { ...c.camp, abroad: true } } }))).toEqual(expect.arrayContaining(['CL-JS-09', 'CL-WASSER-07']))
    expect(ids(ctx({ config: { ...c, camp: { ...c.camp, campForm: 'zelt' } } }))).toContain('CL-LAGER-10')
    expect(ids(ctx({ config: { ...c, camp: { ...c.camp, campForm: 'haus' } } }))).not.toContain('CL-LAGER-10')
    expect(ids(ctx({ config: { ...c, activityTags: { a: ['sb-wasser'] } } }))).toContain('CL-LST-04')
    expect(ids(ctx({ coachInputs: { leihmaterialOrdered: true } as never }))).toContain('CL-JS-08')
    expect(ids(ctx({ coachInputs: { leihmaterialOrdered: false, leihmaterialDeliveryDate: '2031-07-01' } as never }))).toContain('CL-JS-08')
  })

  it('CL-LST-04 camp case needs both: no winter-safe access and a winter camp', () => {
    const c = defaultCampRuleConfig('/api/camps/c1')
    const noAccess = { ...c, camp: { ...c.camp, winterSafeAccess: false } }
    expect(ids(ctx({ config: noAccess, campInWinter: false }))).not.toContain('CL-LST-04')
    expect(ids(ctx({ config: noAccess, campInWinter: true }))).toContain('CL-LST-04')
    expect(ids(ctx({ campInWinter: true }))).not.toContain('CL-LST-04')
  })

  it('groups by module and counts progress', () => {
    const visible = visibleChecklist(items, ctx())
    const groups = groupChecklist(visible)
    expect(groups[0].module).toBe('js')
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(visible.length)
    expect(checklistProgress(visible, { 'CL-JS-01': { done: true, at: 'x' }, 'CL-JS-02': { done: false, at: 'x', note: 'n' } })).toEqual({
      done: 1,
      total: visible.length,
    })
  })

  it('campOverlapsMonths', () => {
    expect(campOverlapsMonths(['2031-02-10', '2031-02-11'], [11, 12, 1, 2, 3, 4])).toBe(true)
    expect(campOverlapsMonths(['2031-07-10'], [11, 12, 1, 2, 3, 4])).toBe(false)
  })
})

describe('campConfigEdit', () => {
  const c0 = defaultCampRuleConfig('/api/camps/c1')

  it('module state: auto removes the entry', () => {
    const on = withModuleState(c0, 'lst-berg', 'on')
    expect(on.modules['lst-berg']).toBe('on')
    expect(withModuleState(on, 'lst-berg', 'auto').modules).toEqual({})
  })

  it('tags: dropping the last sb tag removes the approval', () => {
    let c = withActivityTags(c0, 'a1', ['sb-berg', 'ef1'])
    c = withSbApproval(c, 'a1', { kind: 'experte', approvedOn: '2031-05-01' })
    expect(c.sbApprovals.a1).toEqual({ kind: 'experte', approvedOn: '2031-05-01' })
    c = withActivityTags(c, 'a1', ['ef1'])
    expect(c.sbApprovals.a1).toBeUndefined()
    expect(withActivityTags(c, 'a1', []).activityTags).toEqual({})
  })

  it('bergfuehrer approval needs no date', () => {
    const c = withSbApproval(c0, 'camp', { kind: 'bergfuehrer', approvedOn: '2031-05-01' })
    expect(c.sbApprovals.camp).toEqual({ kind: 'bergfuehrer', approvedOn: null })
    expect(withSbApproval(c, 'camp', null).sbApprovals).toEqual({})
  })

  it('checklist: done and note, empty entry removed', () => {
    let c = withChecklistItem(c0, 'CL-JS-01', { done: true }, '2031-01-01T00:00:00.000Z')
    expect(c.checklist['CL-JS-01']).toEqual({ done: true, at: '2031-01-01T00:00:00.000Z' })
    c = withChecklistItem(c, 'CL-JS-01', { note: 'Anruf BASPO' })
    expect(c.checklist['CL-JS-01']).toMatchObject({ done: true, note: 'Anruf BASPO' })
    c = withChecklistItem(c, 'CL-JS-01', { done: false, note: '' })
    expect(c.checklist).toEqual({})
  })
})

describe('bundled checklist audience', () => {
  it('every item is classified and both audiences occur', () => {
    const items = loadBundledChecklist()
    expect(items.every((i) => i.audience === 'coach' || i.audience === 'leaders')).toBe(true)
    expect(items.filter((i) => i.audience === 'coach').length).toBeGreaterThan(5)
    expect(items.filter((i) => i.audience === 'leaders').length).toBeGreaterThan(5)
  })
})
