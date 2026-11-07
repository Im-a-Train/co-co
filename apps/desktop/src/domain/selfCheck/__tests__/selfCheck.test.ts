import { describe, expect, it } from 'vitest'
import { makeFacts } from '../../rounds/__tests__/factsFixture'
import type { Finding, SelfCheckRun } from '../../types'
import { compareWithRun, isLeaderRole, planSelfCheckRun, renderSelfCheckReport, toSelfCheckFindings } from '../index'

function finding(id: string, over: Partial<Finding> = {}): Finding {
  return {
    id,
    ruleId: id.split(':')[0]!,
    ruleVersion: '1',
    packId: null,
    severity: 'should',
    confidence: 'high',
    title: `Titel ${id}`,
    message: `Meldung ${id}`,
    scope: 'activity',
    targets: ['/api/activities/a1'],
    evidence: [],
    source: null,
    origin: 'rule',
    tags: [],
    override: null,
    ...over,
  } as Finding
}

const override = { id: 'o', campIri: '/api/camps/camp1', findingId: 'x', reason: '', createdAt: 'x' } as unknown as Finding['override']

describe('isLeaderRole', () => {
  it('maps roles', () => {
    expect(isLeaderRole('member')).toBe(true)
    expect(isLeaderRole('manager')).toBe(true)
    expect(isLeaderRole('guest')).toBe(false)
    expect(isLeaderRole(null)).toBe(false)
    expect(isLeaderRole(undefined)).toBe(false)
  })
})

describe('toSelfCheckFindings', () => {
  it('excludes overridden and AI findings and flags red-derived', () => {
    const out = toSelfCheckFindings([
      finding('a:1'),
      finding('b:1', { override }),
      finding('c:1', { origin: 'ai' }),
      finding('d:1', { tags: ['midata'] }),
      finding('e:1', { tags: ['nds-quelle'] }),
    ])
    expect(out.map((f) => f.id)).toEqual(['a:1', 'd:1', 'e:1'])
    expect(out.map((f) => f.redDerived)).toEqual([false, true, true])
  })
})

describe('planSelfCheckRun + compareWithRun', () => {
  const counts = { must: 1, should: 1, hint: 0, overridden: 0 }
  const run: SelfCheckRun = planSelfCheckRun({
    id: 'r1',
    campIri: '/api/camps/camp1',
    by: 'leader',
    snapshotId: 's1',
    note: '  erste  ',
    counts,
    validJsDays: 5,
    totalDays: 6,
    findings: [finding('a:1'), finding('b:1')],
    now: '2026-11-07T10:00:00.000Z',
  })
  it('builds the run', () => {
    expect(run).toMatchObject({ id: 'r1', createdAt: '2026-11-07T10:00:00.000Z', by: 'leader', note: 'erste', snapshotId: 's1' })
    expect(run.findings).toHaveLength(2)
  })
  it('compares fixed / remaining / added', () => {
    const p = compareWithRun(run, [finding('b:1'), finding('c:1')])
    expect(p.fixed.map((f) => f.id)).toEqual(['a:1'])
    expect(p.remaining.map((f) => f.id)).toEqual(['b:1'])
    expect(p.added.map((f) => f.id)).toEqual(['c:1'])
  })
  it('treats overridden findings as fixed and no previous run as all added', () => {
    expect(compareWithRun(run, [finding('a:1', { override }), finding('b:1')]).fixed.map((f) => f.id)).toEqual(['a:1'])
    const p = compareWithRun(null, [finding('a:1')])
    expect(p.added).toHaveLength(1)
    expect(p.fixed).toEqual([])
  })
})

describe('renderSelfCheckReport', () => {
  const facts = makeFacts()
  const base = { instanceBaseUrl: 'https://ecamp.example', now: new Date(2026, 10, 7) }
  const findings = [
    finding('hint:1', { severity: 'hint', targets: [], scope: 'camp' }),
    finding('must:1', { severity: 'must', targets: ['/api/activities/a1'] }),
    finding('should:1', { severity: 'should', targets: ['/api/activities/a2'] }),
    finding('red:1', { severity: 'must', tags: ['midata'], title: 'Rot-Befund' }),
    finding('ign:1', { override }),
    finding('ai:1', { origin: 'ai', title: 'KI-Befund' }),
  ]

  it('groups by severity with header, labels and eCamp links', () => {
    const text = renderSelfCheckReport(facts, findings, { valid: 5, total: 6 }, null, { ...base })
    expect(text).toContain('Selbstcheck «Sola» vom 07.11.2026')
    expect(text).toContain('J+S-Tage: 5 von 6 gültig')
    const iShould = text.indexOf('Soll (')
    expect(text.indexOf('Muss (')).toBeGreaterThan(-1)
    expect(text.indexOf('Muss (')).toBeLessThan(iShould)
    expect(iShould).toBeLessThan(text.indexOf('Hinweis ('))
    expect(text).toContain('- 1.1 Aktivität 1: Titel must:1: Meldung must:1')
    expect(text).toContain('https://ecamp.example/camps/camp1/Sola/program/activity/a1/s1/Aktivitat-1')
    expect(text).not.toContain('KI-Befund')
    expect(text).not.toContain('ign:1')
  })

  it('omits links without base URL and J+S line without days', () => {
    const text = renderSelfCheckReport(facts, findings, null, null, { ...base, instanceBaseUrl: null })
    expect(text).not.toContain('http')
    expect(text).not.toContain('J+S-Tage')
  })

  it('excludes red-derived findings by default, includes with the option', () => {
    const without = renderSelfCheckReport(facts, findings, null, null, base)
    expect(without).not.toContain('Rot-Befund')
    expect(without).toContain('Offen: 1 Muss, 1 Soll, 1 Hinweis')
    const text = renderSelfCheckReport(facts, findings, null, null, { ...base, includeRedDerived: true })
    expect(text).toContain('Rot-Befund')
    expect(text).toContain('Offen: 2 Muss')
  })

  it('adds the progress section, hiding red-derived fixed ones by default', () => {
    const fx = (id: string, title: string, redDerived: boolean) => ({ id, ruleId: id, severity: 'must' as const, title, message: '', targets: [], redDerived })
    const progress = { fixed: [fx('x', 'Behoben A', false), fx('y', 'Behoben Rot', true)], remaining: [], added: [] }
    const text = renderSelfCheckReport(facts, [], null, progress, base)
    expect(text).toContain('Behoben seit letztem Selbstcheck (1)')
    expect(text).toContain('- Behoben A')
    expect(text).not.toContain('Behoben Rot')
    expect(text).toContain('Keine offenen Befunde.')
    expect(renderSelfCheckReport(facts, [], null, progress, { ...base, includeRedDerived: true })).toContain('Behoben Rot')
    expect(renderSelfCheckReport(facts, [], null, null, base)).not.toContain('Behoben seit')
  })
})
