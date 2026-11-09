import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/tauriAi', () => ({ aiComplete: vi.fn() }))
vi.mock('../../storage/settings', () => ({ getAppSettings: async () => ({ ai: { enabled: true, model: 'claude-sonnet-5-5' } }) }))
vi.mock('../../storage/db', () => ({ getDb: () => ({ aiLog: { add: async () => 1 } }) }))

import { loadBundledPacks } from '../../rules/packs'
import { aiGuidanceRules } from '../../rules/aiGuidance'
import { assertSendable, maxPromptChars } from '../aiGateway'
import { parseCampReviewFindings, reviewCamp } from '../features'
import type { CampFacts, Finding } from '../../types'

const packs = loadBundledPacks()
const guidance = aiGuidanceRules(packs, { campStart: '2031-07-12' })

function makeFacts(activityCount: number): CampFacts {
  const activities = Array.from({ length: activityCount }, (_, i) => ({
    iri: `/api/activities/a${i}`,
    title: `Aktivität ${i} mit Anna`,
    location: 'Waldplatz',
    categoryIri: '/api/categories/c1',
    responsibleIris: [],
    content: { storyboardText: 'Bauen und spielen '.repeat(100), safetyText: 'Ruf 079 123 45 67 '.repeat(50) },
  }))
  return {
    camp: { iri: '/api/camps/1' },
    collaborators: [{ iri: 'c1', displayName: 'Anna', nickname: 'Anna', firstname: 'Anna', surname: 'Meier' }],
    days: [{ iri: '/api/days/d1', number: 1, date: '2031-07-12' }],
    categories: [{ iri: '/api/categories/c1', short: 'LS', name: 'Lagersport' }],
    activities,
    scheduleEntries: activities.map((a, i) => ({
      iri: `/api/se/${i}`,
      activityIri: a.iri,
      dayIri: '/api/days/d1',
      start: '2031-07-12T09:00:00+00:00',
      end: '2031-07-12T10:00:00+00:00',
      number: `1.${i + 1}`,
    })),
  } as unknown as CampFacts
}

const finding = (over: Partial<Finding>): Finding =>
  ({ id: 'X:1', ruleId: 'JS-DAY-01', severity: 'should', title: 'Titel', message: 'm', origin: 'rule', tags: [], targets: [], override: null, ...over }) as Finding

describe('reviewCamp', () => {
  it('includes guidance, hard findings and the redacted program; sendable and within the limit', () => {
    const p = reviewCamp(makeFacts(8), guidance, [finding({})])
    expect(p.request.feature).toBe('campReview')
    expect(p.previewText).toContain('LST-')
    expect(p.previewText).toContain('JS-DAY-01')
    expect(p.previewText).toContain("1.2")
    expect(p.previewText).not.toContain('Anna')
    expect(p.previewText).not.toMatch(/079 123/)
    const zones = p.request.parts.map((x) => x.zone)
    expect(zones).toEqual(['green', 'green', 'yellow'])
    expect(p.request.parts[2].redacted).toBe(true)
    expect(() => assertSendable({ ...p.request, confirmed: true })).not.toThrow()
  })

  it('stays within the campReview limit for a huge camp (program is cut)', () => {
    const p = reviewCamp(makeFacts(400), guidance, [])
    const size = p.request.system.value.length + p.request.parts.reduce((n, x) => n + x.value.length, 0)
    expect(size).toBeLessThanOrEqual(maxPromptChars('campReview'))
    expect(p.previewText).toContain('[Programm gekürzt]')
    expect(() => assertSendable({ ...p.request, confirmed: true })).not.toThrow()
  })

  it('sends every ai guidance rule and names the activity number of known findings', () => {
    const p = reviewCamp(makeFacts(2), guidance, [finding({ targets: ['/api/activities/a1'] })])
    for (const r of guidance.filter((x) => x.kind === 'ai')) expect(p.previewText, r.id).toContain(`- ${r.id} [Leitfaden]`)
    expect(p.previewText).toContain('JS-DAY-01: Titel (Aktivität 1.2)')
  })

  it('shrinks the program when redaction makes it longer than its budget', () => {
    const facts = makeFacts(400)
    // a very short collaborator name is replaced by a much longer placeholder everywhere
    Object.assign(facts.collaborators[0], { displayName: 'Bo', nickname: 'Bo', firstname: 'Bo' })
    for (const a of facts.activities) a.content.storyboardText = 'Bo Bo Bo Bo Bo '.repeat(40)
    const p = reviewCamp(facts, guidance, [], { programChars: 59000 })
    const size = p.request.system.value.length + p.request.parts.reduce((n, x) => n + x.value.length, 0)
    expect(size).toBeLessThanOrEqual(maxPromptChars('campReview'))
    expect(() => assertSendable({ ...p.request, confirmed: true })).not.toThrow()
  })

  it('does not leak a half e-mail address at an excerpt cut', () => {
    const facts = makeFacts(1)
    facts.activities[0].content.safetyText = `${'x'.repeat(290)} kontakt@beispiel-pfadi.ch Notfall`
    const p = reviewCamp(facts, guidance, [])
    expect(p.previewText).not.toMatch(/kontakt@/)
  })

  it('never carries midata/nds findings or explain data', () => {
    const p = reviewCamp(
      makeFacts(1),
      guidance,
      [finding({ id: 'A', ruleId: 'CMP-NDS-01', title: 'NDS-Befund', tags: ['nds-quelle'] }), finding({ id: 'B', ruleId: 'MID-X-01', title: 'MiData-Befund', tags: ['midata'] })],
    )
    expect(p.previewText).not.toContain('NDS-Befund')
    expect(p.previewText).not.toContain('MiData-Befund')
  })
})

describe('parseCampReviewFindings', () => {
  const facts = makeFacts(3)
  it('caps severity, tags, resolves the activity by number and falls back to the camp', () => {
    const text =
      '```json\n[{"title":"A","message":"x","severity":"must","activityNumber":"1.2"},{"title":"B","message":"y","severity":"should"},{"title":"C","message":"z","activityNumber":"9.9"}]\n```'
    const f = parseCampReviewFindings(text, facts)
    expect(f).toHaveLength(3)
    expect(f.every((x) => x.severity !== 'must' && x.origin === 'ai' && x.confidence === 'heuristic')).toBe(true)
    expect(f.every((x) => x.tags.includes('KI-Einschätzung') && x.tags.includes('KI-Lagerreview'))).toBe(true)
    expect(f[0].targets).toEqual(['/api/activities/a1'])
    expect(f[0].scope).toBe('activity')
    expect(f[0].id).toBe('AI-REVIEW-01:/api/activities/a1:0')
    expect(f[1].targets).toEqual(['/api/camps/1'])
    expect(f[1].scope).toBe('camp')
    expect(f[1].severity).toBe('should')
    expect(f[2].targets).toEqual(['/api/camps/1'])
  })

  it('caps at 12, dedupes and survives garbage', () => {
    const many = JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ title: `T${i}`, message: 'm' })))
    expect(parseCampReviewFindings(many, facts)).toHaveLength(12)
    expect(parseCampReviewFindings('[{"title":"a","message":"b"},{"title":"a","message":"b"}]', facts)).toHaveLength(1)
    expect(parseCampReviewFindings('nope', facts)).toEqual([])
  })
})
