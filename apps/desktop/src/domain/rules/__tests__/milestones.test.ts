import { describe, expect, it } from 'vitest'
import { computeMilestoneDeadlines, loadBundledMilestones, parseMilestonesYaml, radarBucket } from '../milestones'
import type { MilestoneList } from '../milestones'

const SRC = { title: 'Hering', url: 'https://hering.scout.ch/de' }
const LIST: MilestoneList = {
  id: 't',
  name: 'T',
  version: '1',
  milestones: [
    { id: 'a', title: 'A', description: '', anchor: 'start', offsetDays: -10, source: SRC, confidence: 'unverified' },
    { id: 'b', title: 'B', description: '', anchor: 'end', offsetDays: 14, source: SRC, confidence: 'unverified' },
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
  it('reports German errors', () => {
    expect(() => parseMilestonesYaml('')).toThrow(/leer oder ungültig/)
    expect(() => parseMilestonesYaml('id: x\nname: X\nversion: 1\nmilestones: []')).toThrow(/«milestones» fehlt/)
    expect(() => parseMilestonesYaml(VALID.replace('anchor: start', 'anchor: mid'))).toThrow(/«anchor»/)
    expect(() => parseMilestonesYaml(VALID.replace('-5', 'x'))).toThrow(/«offsetDays»/)
    expect(() => parseMilestonesYaml(VALID.replace('unverified', 'sure'))).toThrow(/«confidence»/)
    expect(() => parseMilestonesYaml(VALID.replace('https://hering.scout.ch/de', 'ftp://x'))).toThrow(/«source.url»/)
    const dup = VALID + VALID.split('milestones:\n')[1]
    expect(() => parseMilestonesYaml(dup)).toThrow(/doppelt/)
    expect(() => parseMilestonesYaml('a: [')).toThrow(/ungültig/)
  })
})

describe('bundled list', () => {
  it('parses; all unverified with a hering source and unique ids', () => {
    const l = loadBundledMilestones()
    expect(l.name).toBe('PBS-Meilensteine (Hering)')
    expect(l.milestones.length).toBeGreaterThanOrEqual(5)
    expect(new Set(l.milestones.map((m) => m.id)).size).toBe(l.milestones.length)
    for (const m of l.milestones) {
      expect(m.confidence).toBe('unverified')
      expect(m.source.url).toMatch(/^https:\/\/hering\.scout\.ch\//)
    }
  })
})
