import { describe, expect, it } from 'vitest'
import { computeMilestoneDeadlines, loadBundledMilestoneLists, loadBundledMilestones, milestoneContextFromConfig, parseMilestonesYaml, radarBucket } from '../milestones'
import type { MilestoneContext, MilestoneList } from '../milestones'

const SRC = { title: 'Hering', url: 'https://hering.scout.ch/de' }
const LIST: MilestoneList = {
  id: 't',
  name: 'T',
  version: '1',
  milestones: [
    { id: 'a', title: 'A', description: '', anchor: 'start', audience: 'coach', offsetDays: -10, source: SRC, confidence: 'unverified' },
    { id: 'b', title: 'B', description: '', anchor: 'end', audience: 'leaders', offsetDays: 14, source: SRC, confidence: 'unverified' },
  ],
}
const camp = { iri: '/api/camps/c1', title: 'Sola', start: '2026-07-10', end: '2026-07-20' }

const VALID = `
id: x
name: X
version: "1"
milestones:
  - id: m1
    title: M1
    audience: coach
    anchor: start
    offsetDays: -5
    confidence: unverified
    source: { title: Hering, url: "https://hering.scout.ch/de" }
`

describe('computeMilestoneDeadlines', () => {
  it('applies start and end offsets', () => {
    const d = computeMilestoneDeadlines(camp, null, LIST)
    expect(d.map((x) => [x.milestoneId, x.due])).toEqual([
      ['a', '2026-06-30'],
      ['b', '2026-08-03'],
    ])
    expect(d[0]).toMatchObject({ kind: 'pbs-milestone', title: 'A', confidence: 'unverified', done: false, ruleId: null, source: SRC })
  })
  it('end anchor falls back to start without end; no start gives nothing', () => {
    expect(computeMilestoneDeadlines({ ...camp, end: null }, null, LIST)[1].due).toBe('2026-07-24')
    expect(computeMilestoneDeadlines({ ...camp, start: null }, null, LIST)).toEqual([])
  })
  it('marks done from milestonesDone', () => {
    const inputs = { milestonesDone: { a: '2026-06-01' } } as never
    expect(computeMilestoneDeadlines(camp, inputs, LIST).map((x) => x.done)).toEqual([true, false])
  })
})

describe('radarBucket', () => {
  const today = '2026-06-01'
  const at = (due: string, done = false) => radarBucket({ due, done }, today)
  it('uses the documented boundaries', () => {
    expect(at('2026-05-31')).toBe('overdue')
    expect(at('2026-06-01')).toBe('week')
    expect(at('2026-06-08')).toBe('week')
    expect(at('2026-06-09')).toBe('month')
    expect(at('2026-06-29')).toBe('month')
    expect(at('2026-06-30')).toBe('later')
  })
  it('done wins', () => expect(at('2026-01-01', true)).toBe('done'))
})

describe('parseMilestonesYaml', () => {
  it('parses a valid list', () => expect(parseMilestonesYaml(VALID).milestones[0].offsetDays).toBe(-5))
  it('resolves registry sources', () => {
    const l = parseMilestonesYaml(VALID.replace('source: { title: Hering, url: "https://hering.scout.ch/de" }', 'sources: [{ key: WEB-C, page: "Abschnitt" }]'))
    expect(l.milestones[0].source.title).toContain('Abschnitt')
    expect(l.milestones[0].source.url).toMatch(/^https:/)
  })
  it('reports German errors', () => {
    expect(() => parseMilestonesYaml('')).toThrow(/leer oder ungültig/)
    expect(() => parseMilestonesYaml('id: x\nname: X\nversion: 1\nmilestones: []')).toThrow(/«milestones» fehlt/)
    expect(() => parseMilestonesYaml(VALID.replace('anchor: start', 'anchor: mid'))).toThrow(/«anchor»/)
    expect(() => parseMilestonesYaml(VALID.replace('    audience: coach\n', ''))).toThrow(/«audience»/)
    expect(() => parseMilestonesYaml(VALID.replace('audience: coach', 'audience: everyone'))).toThrow(/«audience»/)
    expect(() => parseMilestonesYaml(VALID.replace('-5', 'x'))).toThrow(/«offsetDays»/)
    expect(() => parseMilestonesYaml(VALID.replace('unverified', 'sure'))).toThrow(/«confidence»/)
    expect(() => parseMilestonesYaml(VALID.replace('https://hering.scout.ch/de', 'ftp://x'))).toThrow(/«source.url»/)
    expect(() => parseMilestonesYaml(VALID.replace('source: { title: Hering, url: "https://hering.scout.ch/de" }', 'sources: [{ key: NOPE }]'))).toThrow(/nicht in sources.yaml/)
    expect(() => parseMilestonesYaml(VALID.replace('confidence: unverified', 'confidence: unverified\n    module: nope'))).toThrow(/«module»/)
    const dup = VALID + VALID.split('milestones:\n')[1]
    expect(() => parseMilestonesYaml(dup)).toThrow(/doppelt/)
    expect(() => parseMilestonesYaml('a: [')).toThrow(/ungültig/)
  })
})

describe('bundled lists', () => {
  it('pbs list: all unverified with a hering source; existing ids stay stable', () => {
    const l = loadBundledMilestoneLists().find((x) => x.id === 'pbs-hering')!
    expect(l.name).toBe('PBS-Meilensteine (Hering)')
    expect(l.milestones.map((m) => m.id)).toEqual([
      'lagerplatz-reserviert',
      'grobprogramm-coach',
      'lagermeldung-kantonalverband',
      'elterninformation',
      'sicherheitskonzept',
      'lagerdossier-coach',
      'lagerbericht',
      'lagerabrechnung',
    ])
    for (const m of l.milestones) {
      expect(m.confidence).toBe('unverified')
      expect(m.module).toBe('pbs')
      expect(m.source.url).toMatch(/^https:\/\/hering\.scout\.ch\//)
    }
  })
  it('jslst list has the catalog §9 items', () => {
    const l = loadBundledMilestoneLists().find((x) => x.id === 'jslst-milestones')!
    expect(l.milestones).toHaveLength(15)
    const byId = Object.fromEntries(l.milestones.map((m) => [m.id, m]))
    expect(byId['M-JS-PROGRAMM-NDS']).toMatchObject({ anchor: 'lastActivity', offsetDays: 30, confidence: 'verified', module: 'js' })
    // NDS registration/closing, Leihmaterial and Landeskarten are built-in deadline kinds (lib/deadlines.ts), not milestones.
    expect(byId['M-JS-ANMELDUNG']).toBeUndefined()
    expect(byId['M-LST-GROBPROGRAMM']).toMatchObject({ offsetDays: -90, offsetEarliestDays: -120, confidence: 'unverified' })
    expect(byId['M-WINTER-LAWINENBULLETIN']).toMatchObject({ module: 'lst-winter', confidence: 'best-practice' })
    expect(byId['M-JS-PROGRAMM-NDS'].source.url).toMatch(/^https:/)
  })
  it('merged list has globally unique ids', () => {
    const all = loadBundledMilestones().milestones
    expect(new Set(all.map((m) => m.id)).size).toBe(all.length)
    expect(all).toHaveLength(23)
  })
})

describe('computeMilestoneDeadlines with the bundled list', () => {
  const list = loadBundledMilestones()
  const due = (c: typeof camp, inputs: unknown = null, ctx: MilestoneContext = {}) =>
    Object.fromEntries(computeMilestoneDeadlines(c, inputs as never, list, ctx).map((d) => [d.milestoneId, d.due]))
  it('hides milestones of auto modules unless the module is active', () => {
    expect(due(camp)['M-WINTER-LAWINENBULLETIN']).toBeUndefined()
    expect(due(camp)['M-JS-PROGRAMM-NDS']).toBe('2026-08-19')
    expect(due(camp, null, { isModuleActive: () => true })['M-WINTER-LAWINENBULLETIN']).toBe('2026-07-10')
  })
  it('lastActivity anchor falls back to the camp end', () => {
    expect(due(camp)['M-JS-PROGRAMM-NDS']).toBe('2026-08-19')
    expect(due(camp, null, { lastActivityDate: '2026-07-18' })['M-JS-PROGRAMM-NDS']).toBe('2026-08-17')
  })
  it('Lieferunterbruch needs the outage and an overlapping material window', () => {
    const outage = { outageStart: '2026-12-11', outageEnd: '2027-01-10', orderBy: '2026-11-04' }
    expect(due(camp, null, { outage })['M-JS-LIEFERUNTERBRUCH']).toBeUndefined()
    const winter = { ...camp, start: '2026-12-27', end: '2027-01-02' }
    expect(due(winter, null, { outage })['M-JS-LIEFERUNTERBRUCH']).toBe('2026-11-04')
    expect(due(winter)['M-JS-LIEFERUNTERBRUCH']).toBeUndefined()
  })
  it('SB-Bewilligung needs the first sb date; non-J+S camps lose the J+S milestones', () => {
    expect(due(camp)['M-LST-SB-BEWILLIGUNG']).toBeUndefined()
    expect(due(camp, null, { firstSbDate: '2026-07-12' })['M-LST-SB-BEWILLIGUNG']).toBe('2026-06-28')
    const d = due(camp, { isJsCamp: false })
    expect(d['M-JS-PROGRAMM-NDS']).toBeUndefined()
    expect(d['grobprogramm-coach']).toBeDefined()
  })
})

describe('milestoneContextFromConfig', () => {
  it('uses coach module states; auto modules stay inactive without facts', () => {
    const ctx = milestoneContextFromConfig({ modules: { 'lst-winter': 'on', pbs: 'off' }, angebot: { lastActivityDate: '2026-07-18' } } as never)
    expect(ctx.isModuleActive!('lst-winter')).toBe(true)
    expect(ctx.isModuleActive!('pbs')).toBe(false)
    expect(ctx.isModuleActive!('lst-berg')).toBe(false)
    expect(ctx.isModuleActive!('js')).toBe(true)
    expect(ctx.lastActivityDate).toBe('2026-07-18')
    expect(milestoneContextFromConfig(null).isModuleActive!('lst')).toBe(true)
  })
})

describe('milestone audience', () => {
  it('propagates to Deadline.audience', () => {
    const ds = computeMilestoneDeadlines(camp, null, LIST)
    expect(ds.map((d) => [d.milestoneId, d.audience])).toEqual([
      ['a', 'coach'],
      ['b', 'leaders'],
    ])
  })

  it('every bundled milestone has an audience and both audiences occur', () => {
    const all = loadBundledMilestones().milestones
    expect(all.every((m) => m.audience === 'coach' || m.audience === 'leaders')).toBe(true)
    expect(all.some((m) => m.audience === 'coach')).toBe(true)
    expect(all.some((m) => m.audience === 'leaders')).toBe(true)
  })
})
