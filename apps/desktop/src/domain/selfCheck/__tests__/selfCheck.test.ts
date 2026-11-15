import { describe, expect, it } from 'vitest'
import { makeFacts } from '../../rounds/__tests__/factsFixture'
import type { Finding, SelfCheckRun } from '../../types'
import {
  buildSelfCheckReport,
  compareWithRun,
  formatDateList,
  groupSelfCheckFindings,
  isLeaderRole,
  planSelfCheckRun,
  renderSelfCheckReport,
  renderSelfCheckReportHtml,
  toSelfCheckFindings,
} from '../index'

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
    expect(text).toContain(
      '- 1.1 Aktivität 1 (https://ecamp.example/camps/camp1/Sola/program/activity/a1/s1/Aktivitat-1): Titel must:1: Meldung must:1',
    )
    expect(text).not.toContain('In eCamp')
    expect(text).not.toContain('KI-Befund')
    expect(text).not.toContain('ign:1')
  })

  it('omits links without base URL and J+S line without days', () => {
    const text = renderSelfCheckReport(facts, findings, null, null, { ...base, instanceBaseUrl: null })
    expect(text).not.toContain('http')
    expect(text).not.toContain('gültig')
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
    const progress = { fixed: [fx('x', 'Behoben A', false), fx('y', 'Behoben Rot', true)], remaining: [], added: [], changed: {} }
    const text = renderSelfCheckReport(facts, [], null, progress, base)
    expect(text).toContain('Behoben seit letztem Selbstcheck (1)')
    expect(text).toContain('- Behoben A')
    expect(text).not.toContain('Behoben Rot')
    expect(text).toContain('Keine offenen Befunde.')
    expect(renderSelfCheckReport(facts, [], null, progress, { ...base, includeRedDerived: true })).toContain('Behoben Rot')
    expect(renderSelfCheckReport(facts, [], null, null, base)).not.toContain('Behoben seit')
  })
})

describe('buildSelfCheckReport + renderSelfCheckReportHtml', () => {
  const facts = makeFacts()
  const base = { instanceBaseUrl: 'https://ecamp.example', now: new Date(2026, 10, 7) }
  const findings = [
    finding('hint:1', { severity: 'hint', targets: [], scope: 'camp' }),
    finding('must:1', { severity: 'must', targets: ['/api/activities/a1'] }),
    finding('lt:1', { severity: 'should', targets: [], scope: 'camp', title: 'A <b>&</b> "B"', message: "it's <i>x</i>" }),
  ]

  it('builds groups in severity order with label and url', () => {
    const m = buildSelfCheckReport(facts, findings, { valid: 1, total: 2 }, null, base)
    expect(m.heading).toBe('Selbstcheck «Sola» vom 07.11.2026')
    expect(m.counts).toEqual({ must: 1, should: 1, hint: 1 })
    expect(m.jsDays).toEqual({ valid: 1, total: 2 })
    expect(m.groups.map((g) => g.severity)).toEqual(['must', 'should', 'hint'])
    const it = m.groups[0]!.items[0]!
    expect(it.findingId).toBe('must:1')
    expect(it.activityLabel).toBe('1.1 Aktivität 1')
    expect(it.url).toContain('/activity/a1/')
    expect(m.groups[2]!.items[0]!.activityLabel).toBeNull()
    expect(m.groups[2]!.items[0]!.url).toBeNull()
  })

  it('renders html with linked labels, escaped text and no visible raw URL', () => {
    const m = buildSelfCheckReport(facts, findings, null, null, base)
    const html = renderSelfCheckReportHtml(m)
    expect(html).toContain('<h3>')
    expect(html).toContain('<h4>Muss (1)</h4>')
    expect(html).toMatch(/<a href="https:\/\/ecamp\.example[^"]*">1\.1 Aktivität 1<\/a>/)
    expect(html).toContain('A &lt;b&gt;&amp;&lt;/b&gt; &quot;B&quot;')
    expect(html).toContain('it&#39;s &lt;i&gt;x&lt;/i&gt;')
    const textNodes = html.replace(/<[^>]*>/g, ' ')
    expect(textNodes).not.toContain('http')
  })

  it('shows the none line and lists fixed ones escaped', () => {
    const fx = { id: 'x', ruleId: 'x', severity: 'must' as const, title: 'Behoben <A>', message: '', targets: [], redDerived: false }
    const m = buildSelfCheckReport(facts, [], null, { fixed: [fx], remaining: [], added: [], changed: {} }, base)
    const html = renderSelfCheckReportHtml(m)
    expect(html).toContain('Keine offenen Befunde.')
    expect(html).toContain('<li>Behoben &lt;A&gt;</li>')
  })
})

describe('compareWithRun pairing (PREP-08)', () => {
  const camp = '/api/camps/camp1'
  const run = (findings: SelfCheckRun['findings']): SelfCheckRun =>
    ({ id: 'r', campIri: camp, createdAt: 'x', by: 'leader', snapshotId: null, note: '', counts: { must: 0, should: 0, hint: 1 }, validJsDays: null, totalDays: null, findings }) as SelfCheckRun

  it('pairs noMapping hint → real jsDays must as «Offen» with changed severity', () => {
    const prev = run([
      { id: 'JS-CAMP-01:noMapping', ruleId: 'JS-CAMP-01', severity: 'hint', title: 'Lager', message: 'Zuordnung fehlt', targets: [camp, 'noMapping'], redDerived: false },
    ])
    const p = compareWithRun(prev, [finding('JS-CAMP-01:camp', { ruleId: 'JS-CAMP-01', severity: 'must', targets: [camp], scope: 'camp' })])
    expect(p.fixed).toEqual([])
    expect(p.added).toEqual([])
    expect(p.remaining.map((f) => f.id)).toEqual(['JS-CAMP-01:camp'])
    expect(p.changed['JS-CAMP-01:camp']).toMatchObject({ severityChanged: true, before: { severity: 'hint' }, now: { severity: 'must' } })
  })
  it('same severity → changed without severity marker; other rules/subjects stay fixed/added', () => {
    const prev = run([
      { id: 'A:1', ruleId: 'A', severity: 'should', title: 'a', message: 'x', targets: ['/api/days/d1'], redDerived: false },
      { id: 'B:1', ruleId: 'B', severity: 'should', title: 'b', message: 'x', targets: ['/api/days/d1'], redDerived: false },
    ])
    const p = compareWithRun(prev, [
      finding('A:2', { ruleId: 'A', targets: ['/api/days/d1', 'v'] }),
      finding('A:3', { ruleId: 'A', targets: ['/api/days/d2'] }),
    ])
    expect(p.changed['A:2']!.severityChanged).toBe(false)
    expect(p.fixed.map((f) => f.id)).toEqual(['B:1'])
    expect(p.added.map((f) => f.id)).toEqual(['A:3'])
  })
})

describe('report grouping, provisional, fixed message (PREP-09 / PREP-01 / PREP-08)', () => {
  const facts = makeFacts()
  const dayFinding = (n: number, _date: string, over: Partial<Finding> = {}) =>
    finding(`R-DAY:${n}`, { ruleId: 'R-DAY', severity: 'hint', title: 'Tag ohne Tagesverantwortung', scope: 'day', targets: [`/api/days/x${n}`], ...over })
  const f2 = {
    ...facts,
    days: ['2031-01-29', '2031-01-26', '2031-01-30', '2031-01-27'].map((date, i) => ({ ...facts.days[0]!, iri: `/api/days/x${i}`, date })),
  }
  const opts = { instanceBaseUrl: null, now: new Date('2031-02-01T10:00:00') }

  it('formats date lists', () => {
    expect(formatDateList(['2031-01-26', '2031-01-24', '2031-01-25'])).toBe('24.–26.01.2031')
    expect(formatDateList(['2031-01-30', '2031-01-26', '2031-01-27', '2031-01-29'])).toBe('26., 27., 29., 30.01.2031')
    expect(formatDateList(['2031-02-02', '2031-01-30'])).toBe('30.01., 02.02.2031')
    expect(formatDateList([])).toBe('')
  })
  it('merges day findings of one rule into one dated item, keeps activity items single', () => {
    const findings = [
      dayFinding(0, '', { id: 'R-DAY:0' }),
      dayFinding(1, '', { id: 'R-DAY:1' }),
      dayFinding(2, '', { id: 'R-DAY:2' }),
      dayFinding(3, '', { id: 'R-DAY:3' }),
      finding('R-ACT:1', { ruleId: 'R-ACT', severity: 'hint', targets: ['/api/activities/a1'] }),
    ]
    const m = buildSelfCheckReport(f2 as never, findings, null, null, opts)
    const g = m.groups[0]!
    expect(g.topics).toBe(2)
    expect(g.places).toBe(5)
    expect(g.header).toBe('Hinweis (2 Themen, 5 Stellen)')
    const merged = g.items.find((i) => i.findingIds.length === 4)!
    expect(merged.message).toBe('an 4 Tagen (26., 27., 29., 30.01.2031)')
    expect(merged.dates).toEqual(['2031-01-26', '2031-01-27', '2031-01-29', '2031-01-30'])
    expect(g.items.filter((i) => i.findingIds.length === 1)).toHaveLength(1)
    const text = renderSelfCheckReport(f2 as never, findings, null, null, opts)
    expect(text).toContain('\nHinweis (2 Themen, 5 Stellen)\n')
    expect(text).toContain('- Tag ohne Tagesverantwortung: an 4 Tagen (26., 27., 29., 30.01.2031)\n')
  })
  it('groupSelfCheckFindings sorts merged items by date and leaves singles alone', () => {
    const items = [0, 1].map((i) => ({ id: `i${i}`, ruleId: 'R', severity: 'hint' as const, title: 't', targets: [`/api/days/x${i}`] }))
    const groups = groupSelfCheckFindings([items[0]!, items[1]!], f2 as never)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.dates).toEqual(['2031-01-26', '2031-01-29'])
    expect(groupSelfCheckFindings([items[0]!], f2 as never)[0]!.merged).toBe(false)
  })
  it('prints the provisional line first in text and HTML only when provisional', () => {
    const findings = [finding('A:1')]
    const text = renderSelfCheckReport(facts, findings, null, null, opts, true)
    const lines = text.split('\n')
    expect(lines[1]).toBe('Vorläufig: Die Kategorien-Zuordnung ist noch nicht bestätigt – J+S-Tage und Tagesregeln sind nicht geprüft.')
    expect(renderSelfCheckReport(facts, findings, null, null, opts)).not.toContain('Vorläufig')
    const html = renderSelfCheckReportHtml(buildSelfCheckReport(facts, findings, null, null, opts, true))
    expect(html.indexOf('Vorläufig')).toBeGreaterThan(-1)
    expect(html.indexOf('Vorläufig')).toBeLessThan(html.indexOf('Offen:'))
  })
  it('drops the J+S count while provisional and carries the minimum once confirmed', () => {
    const js = { valid: 0, total: 7, required: 4 }
    const prov = buildSelfCheckReport(facts, [finding('A:1')], js, null, opts, true)
    expect(prov.jsDays).toBeNull()
    const text = renderSelfCheckReport(facts, [finding('A:1')], js, null, opts, true)
    expect(text).not.toContain('J+S-Tage:')
    expect(renderSelfCheckReportHtml(prov)).not.toContain('gültig')
    expect(buildSelfCheckReport(facts, [finding('A:1')], js, null, opts, false).jsDays).toEqual(js)
  })
  it('groups fixed day findings of one rule, sorted by date', () => {
    const prev = {
      id: 'r', campIri: 'x', createdAt: 'x', by: 'leader', snapshotId: null, note: '', counts: { must: 0, should: 0, hint: 0 }, validJsDays: null, totalDays: null,
      findings: [2, 0, 3, 1].map((i) => ({ id: `R-DAY:${i}`, ruleId: 'R-DAY', severity: 'hint', title: 'Fixpunkte fehlen', message: `Am Tag ${i}`, targets: [`/api/days/x${i}`], redDerived: false })),
    } as unknown as SelfCheckRun
    const m = buildSelfCheckReport(f2 as never, [], null, compareWithRun(prev, []), opts)
    expect(m.fixed).toHaveLength(1)
    expect(m.fixed[0]).toMatchObject({ title: 'Fixpunkte fehlen', message: 'an 4 Tagen (26., 27., 29., 30.01.2031)' })
    const text = renderSelfCheckReport(f2 as never, [], null, compareWithRun(prev, []), opts)
    expect(text).toContain('Behoben seit letztem Selbstcheck (1)')
    expect(text).toContain('- Fixpunkte fehlen – an 4 Tagen (26., 27., 29., 30.01.2031)')
  })
  it('progress ignores coach homework (needsInput)', () => {
    const prev = {
      id: 'r', campIri: 'x', createdAt: 'x', by: 'leader', snapshotId: null, note: '', counts: { must: 0, should: 0, hint: 0 }, validJsDays: null, totalDays: null,
      findings: [{ id: 'H:1', ruleId: 'H', severity: 'must', title: 'Angabe', message: 'm', targets: [], redDerived: false }],
    } as unknown as SelfCheckRun
    const homework = finding('H:1', { ruleId: 'H', severity: 'must', targets: [], scope: 'camp', needsInput: 'coachInputs' })
    const newHomework = finding('H:2', { ruleId: 'H', severity: 'must', targets: [], scope: 'camp', needsInput: 'coachInputs' })
    const p = compareWithRun(prev, [homework, newHomework, finding('A:1')])
    expect(p.remaining).toEqual([])
    expect(p.fixed).toEqual([])
    expect(p.added.map((f) => f.id)).toEqual(['A:1'])
    expect(toSelfCheckFindings([homework, finding('A:1')]).map((f) => f.id)).toEqual(['A:1'])
  })
  it('lists fixed findings with title and old message', () => {
    const prev = { id: 'r', campIri: 'x', createdAt: 'x', by: 'leader', snapshotId: null, note: '', counts: { must: 0, should: 0, hint: 0 }, validJsDays: null, totalDays: null,
      findings: [{ id: 'Z:1', ruleId: 'Z', severity: 'hint', title: 'Lager mit 4 Tagen', message: 'Zuordnung fehlt', targets: ['/api/x'], redDerived: false }] } as SelfCheckRun
    const m = buildSelfCheckReport(facts, [], null, compareWithRun(prev, []), opts)
    expect(m.fixed[0]).toMatchObject({ title: 'Lager mit 4 Tagen', message: 'Zuordnung fehlt' })
    expect(renderSelfCheckReport(facts, [], null, compareWithRun(prev, []), opts)).toContain('- Lager mit 4 Tagen – Zuordnung fehlt')
  })
})

describe('review fixes: pairing, date ranges, severity, activity order', () => {
  const camp = '/api/camps/camp1'
  const prevRun = (findings: SelfCheckRun['findings']): SelfCheckRun =>
    ({ id: 'r', campIri: camp, createdAt: 'x', by: 'leader', snapshotId: null, note: '', counts: { must: 0, should: 1, hint: 0 }, validJsDays: null, totalDays: null, findings }) as SelfCheckRun

  it('does not pair two different subjects on the camp (Leihmaterial fixed, Landeskarten new)', () => {
    const prev = prevRun([
      { id: `JS-DL-03:${camp}|leihmaterial`, ruleId: 'JS-DL-03', severity: 'should', title: 'Material', message: 'Leihmaterial', targets: [camp, 'leihmaterial'], redDerived: false },
    ])
    const p = compareWithRun(prev, [finding(`JS-DL-03:${camp}|landeskarten`, { ruleId: 'JS-DL-03', targets: [camp, 'landeskarten'], scope: 'camp' })])
    expect(p.changed).toEqual({})
    expect(p.fixed.map((f) => f.targets[1])).toEqual(['leihmaterial'])
    expect(p.added.map((f) => f.targets[1])).toEqual(['landeskarten'])
    expect(p.remaining).toEqual([])
  })

  it('formats runs across a month and a year boundary', () => {
    expect(formatDateList(['2031-02-02', '2031-01-30', '2031-01-31', '2031-02-01'])).toBe('30.01.–02.02.2031')
    expect(formatDateList(['2030-12-31', '2031-01-01', '2030-12-30'])).toBe('30.12.2030–01.01.2031')
    expect(formatDateList(['2030-12-31', '2031-01-02'])).toBe('31.12.2030, 02.01.2031')
  })

  it('a merged day group takes the most severe severity of its items', () => {
    const facts = { ...makeFacts(), days: ['2031-01-26', '2031-01-27'].map((date, i) => ({ ...makeFacts().days[0]!, iri: `/api/days/x${i}`, date })) }
    const items = [
      { id: 'a', ruleId: 'R', severity: 'hint' as const, title: 't', targets: ['/api/days/x1'] },
      { id: 'b', ruleId: 'R', severity: 'must' as const, title: 't', targets: ['/api/days/x0'] },
    ]
    const [g] = groupSelfCheckFindings(items, facts)
    expect(g).toMatchObject({ merged: true, severity: 'must', dates: ['2031-01-26', '2031-01-27'] })
    expect(g!.items.map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('keeps a camp item of a rule that also has merged day items (nothing is dropped)', () => {
    const facts = { ...makeFacts(), days: ['2031-01-26', '2031-01-27'].map((date, i) => ({ ...makeFacts().days[0]!, iri: `/api/days/x${i}`, date })) }
    const items = [
      { id: 'c', ruleId: 'R', severity: 'hint' as const, title: 't', targets: [camp] },
      { id: 'a', ruleId: 'R', severity: 'hint' as const, title: 't', targets: ['/api/days/x1'] },
      { id: 'b', ruleId: 'R', severity: 'hint' as const, title: 't', targets: ['/api/days/x0'] },
    ]
    const groups = groupSelfCheckFindings(items, facts)
    expect(groups.map((g) => ({ merged: g.merged, ids: g.items.map((i) => i.id) }))).toEqual([
      { merged: false, ids: ['c'] },
      { merged: true, ids: ['b', 'a'] },
    ])
  })

  it('sorts activity items of one rule by block number (1.2 before 1.10) and prints merged day items', () => {
    const facts = makeFacts(10)
    const findings = [
      finding('R-ACT:/api/activities/a10', { ruleId: 'R-ACT', targets: ['/api/activities/a10'] }),
      finding('R-ACT:/api/activities/a2', { ruleId: 'R-ACT', targets: ['/api/activities/a2'] }),
    ]
    const m = buildSelfCheckReport(facts, findings, null, null, { instanceBaseUrl: null, now: new Date('2031-02-01T10:00:00') })
    expect(m.groups[0]!.items.map((i) => i.activityLabel)).toEqual(['1.2 Aktivität 2', '1.10 Aktivität 10'])
    expect(m.groups[0]!.header).toBe('Soll (2)')
  })
})

describe('report leaves out coach homework (needsInput)', () => {
  it('drops needsInput findings from groups and counts', () => {
    const facts = makeFacts()
    const real = finding('should:1', { severity: 'should', targets: [], scope: 'camp', title: 'Echter Punkt' })
    const todo = finding('must:9', { severity: 'must', targets: [], scope: 'camp', title: 'Angabe fehlt', needsInput: 'coachInputs' })
    const m = buildSelfCheckReport(facts, [real, todo], null, null, { instanceBaseUrl: null, now: new Date(2026, 10, 7) })
    const ids = m.groups.flatMap((g) => g.items.map((i) => i.title))
    expect(ids).toContain(real.title)
    expect(m.groups.some((g) => g.severity === 'must')).toBe(false)
  })
})
