import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/tauriAi', () => ({ aiComplete: vi.fn() }))
vi.mock('../../storage/settings', () => ({ getAppSettings: async () => ({ ai: { enabled: true, model: 'claude-sonnet-5-5' } }) }))
vi.mock('../../storage/db', () => ({ getDb: () => ({ aiLog: { add: async () => 1 } }) }))

import type { ActivityFact, CampFacts, DocumentRecord, FeedbackItem } from '../../types'
import { extractJsonArray, parseSafetyFindings, rephraseFeedback, reviewActivitySafety, summariseDocument } from '../features'

const activity = {
  iri: '/api/activities/a1',
  title: 'Seilbrücke mit Anna',
  location: 'Waldplatz',
  responsibleIris: [],
  content: { storyboardText: 'Bauen', safetyText: 'Ruf 079 123 45 67' },
} as unknown as ActivityFact

const facts = {
  camp: { iri: '/api/camps/1' },
  collaborators: [{ iri: 'c1', displayName: 'Anna', nickname: 'Anna', firstname: 'Anna', surname: 'Meier' }],
  activities: [activity],
} as unknown as CampFacts

describe('parseSafetyFindings', () => {
  it('parses fenced json, never yields must, tags as KI', () => {
    const text = 'Hier:\n```json\n[{"title":"Sicherung","message":"Nicht klar","severity":"must"},{"title":"Wetter","message":"Plan B?","severity":"should"}]\n```'
    const f = parseSafetyFindings(text, activity)
    expect(f).toHaveLength(2)
    expect(f.every((x) => x.severity !== 'must' && x.origin === 'ai' && x.tags.includes('KI-Einschätzung'))).toBe(true)
    expect(f[0].severity).toBe('hint')
    expect(f[1].severity).toBe('should')
    expect(f[0].targets).toEqual([activity.iri])
  })

  it('is defensive on garbage', () => {
    expect(parseSafetyFindings('kein json', activity)).toEqual([])
    expect(parseSafetyFindings('[1, null, "x", {}]', activity)).toEqual([])
    expect(parseSafetyFindings('[{"title": ', activity)).toEqual([])
    expect(extractJsonArray('{"a":1}')).toEqual([])
  })

  it('limits to 5 and dedupes', () => {
    const many = JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, message: 'm', severity: 'hint' })))
    expect(parseSafetyFindings(many, activity)).toHaveLength(5)
    const dup = JSON.stringify([{ title: 'a', message: 'b' }, { title: 'A', message: 'B' }])
    expect(parseSafetyFindings(dup, activity)).toHaveLength(1)
  })
})

describe('previews', () => {
  it('safety review preview contains redacted text only', () => {
    const p = reviewActivitySafety(activity, facts)
    expect(p.previewText).toContain('Leiter A')
    expect(p.previewText).not.toMatch(/Anna|079/)
    expect(p.request.confirmed).toBe(false)
    expect(p.request.parts.filter((x) => x.zone === 'yellow').every((x) => x.redacted)).toBe(true)
    expect(p.redactionCount).toBeGreaterThan(0)
  })

  it('rephrase preview redacts the item text', () => {
    const item = { id: '1', campIri: '/api/camps/1', scope: 'camp', kind: 'must', text: 'Anna soll mail@x.ch melden', status: 'draft' } as unknown as FeedbackItem
    const p = rephraseFeedback(item, facts)
    expect(p.previewText).toContain('Leiter A soll [E-Mail] melden')
  })

  it('rephrase refuses NDS-derived feedback (red zone)', () => {
    const item = { id: 'f', campIri: '/api/camps/1', scope: 'camp', kind: 'must', text: 'AWK offen (Quelle: NDS, Stand 01.06.2026)', status: 'draft' } as unknown as FeedbackItem
    expect(() => rephraseFeedback(item, facts)).toThrow(/NDS/)
    expect(() => rephraseFeedback({ ...item, text: 'x', redDerived: true }, facts)).toThrow(/NDS/)
  })

  it('rephrase refuses MiData-derived feedback (red zone)', () => {
    const item = { id: 'f', campIri: '/api/camps/1', scope: 'camp', kind: 'must', text: 'Niemand hat SLRG (Quelle: MiData, Stand 01.06.2026)', redDerived: true, status: 'draft' } as unknown as FeedbackItem
    expect(() => rephraseFeedback(item, facts)).toThrow(/MiData/)
    expect(() => rephraseFeedback({ ...item, redDerived: undefined }, facts)).toThrow(/MiData/)
  })
  it('summary requires aiAllowed', () => {
    const doc = { campIri: '/api/camps/1', text: 'Notfall 144', zone: 'yellow', aiAllowed: false } as unknown as DocumentRecord
    expect(() => summariseDocument(doc, facts)).toThrow()
    expect(summariseDocument({ ...doc, aiAllowed: true }, facts).request.feature).toBe('summarise')
  })
})
