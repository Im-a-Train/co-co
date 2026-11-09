import { describe, expect, it } from 'vitest'
import { GENERAL_POINTS, usedGeneralPointIds } from '../defaults'
import { itemFromFinding, renderFeedback } from '../index'
import { dayLabel, groupFeedback } from '../structure'
import { messages, type MessageTree } from '../../../locales/messages'
import type { CampFacts, FeedbackItem, Finding } from '../../types'

function item(p: Partial<FeedbackItem> & { id: string }): FeedbackItem {
  return {
    campIri: '/api/camps/c1',
    scope: 'camp',
    kind: 'suggestion',
    text: 'Text',
    status: 'draft',
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:00:00.000Z',
    ...p,
  }
}

const A1 = '/api/activities/a1'
const A2 = '/api/activities/a2'
const A3 = '/api/activities/a3'
const A4 = '/api/activities/a4'

// 2026-07-13 is a Monday.
const facts = {
  days: [
    { iri: '/api/days/d2', periodIri: 'p', number: 2, dayOffset: 1, date: '2026-07-14', start: '', end: '' },
    { iri: '/api/days/d1', periodIri: 'p', number: 1, dayOffset: 0, date: '2026-07-13', start: '', end: '' },
  ],
  scheduleEntries: [
    { iri: '/api/se/1', activityIri: A1, dayIri: '/api/days/d2', start: '2026-07-14T14:00:00+00:00', number: '2.2' },
    { iri: '/api/se/2', activityIri: A2, dayIri: '/api/days/d2', start: '2026-07-14T09:00:00+00:00', number: '2.1' },
    // A3: first entry is on day 1, second on day 2 -> appears under day 1
    { iri: '/api/se/3', activityIri: A3, dayIri: '/api/days/d2', start: '2026-07-14T20:00:00+00:00', number: '2.3' },
    { iri: '/api/se/4', activityIri: A3, dayIri: '/api/days/d1', start: '2026-07-13T20:00:00+00:00', number: '1.1' },
  ],
  activities: [
    { iri: A1, title: 'Postenlauf' },
    { iri: A2, title: 'Morgenturnen' },
    { iri: A3, title: 'Lagerfeuer' },
    { iri: A4, title: 'Ohne Termin' },
  ],
} as unknown as CampFacts

describe('dayLabel', () => {
  it('uses camp-local date parts', () => {
    expect(dayLabel(2, '2026-07-14')).toBe('Tag 2 · Di 14.07.')
    expect(dayLabel(1, '2026-07-13')).toBe('Tag 1 · Mo 13.07.')
    expect(dayLabel(null, null)).toBe('Ohne Termin')
  })
})

describe('groupFeedback', () => {
  const items = [
    item({ id: 'g1', kind: 'question' }),
    item({ id: 'a1', scope: 'activity', activityIri: A1, kind: 'suggestion' }),
    item({ id: 'a1k', scope: 'activity', activityIri: A1, kind: 'kudos' }),
    item({ id: 'a2', scope: 'activity', activityIri: A2 }),
    item({ id: 'a3', scope: 'activity', activityIri: A3 }),
    item({ id: 'a4', scope: 'activity', activityIri: A4 }),
    item({ id: 'doc1', scope: 'camp', documentId: 'doc-a', createdAt: '2026-01-02T00:00:00.000Z' }),
    item({ id: 'doc2', scope: 'camp', documentId: 'doc-unlinked' }),
  ]
  const docs = [
    { id: 'doc-a', name: 'Budget.xlsx', activityIris: [A2, A1] },
    { id: 'doc-unlinked', name: 'Konzept.pdf', activityIris: [] },
  ]

  it('puts camp items and unlinked documents into general', () => {
    const s = groupFeedback(items, facts, docs)
    expect(s.general.map((i) => i.id)).toEqual(['doc2', 'g1'])
  })

  it('orders days by date and activities by first schedule entry; activity sits under its FIRST entry day', () => {
    const s = groupFeedback(items, facts, docs)
    expect(s.days.map((d) => d.label)).toEqual(['Tag 1 · Mo 13.07.', 'Tag 2 · Di 14.07.', 'Ohne Termin'])
    expect(s.days[0]!.activities.map((a) => a.activityIri)).toEqual([A3])
    expect(s.days[1]!.activities.map((a) => a.activityIri)).toEqual([A2, A1])
    expect(s.days[1]!.activities[0]).toMatchObject({ title: 'Morgenturnen', number: '2.1' })
    expect(s.days[2]).toMatchObject({ dayIri: null, dayNumber: null, date: null })
    expect(s.days[2]!.activities.map((a) => a.activityIri)).toEqual([A4])
  })

  it('places document items under the first linked activity, kind order kept', () => {
    const s = groupFeedback(items, facts, docs)
    const morning = s.days[1]!.activities.find((a) => a.activityIri === A2)!
    expect(morning.items.map((i) => i.id)).toEqual(['doc1', 'a2'])
    const post = s.days[1]!.activities.find((a) => a.activityIri === A1)!
    expect(post.items.map((i) => i.id)).toEqual(['a1k', 'a1'])
  })

  it('without facts all activity items land in the trailing group', () => {
    const s = groupFeedback(items, null, docs)
    expect(s.days).toHaveLength(1)
    expect(s.days[0]!.dayIri).toBeNull()
  })

  it('omits empty days', () => {
    expect(groupFeedback([], facts).days).toEqual([])
  })
})

describe('rendering with structure', () => {
  const items = [
    item({ id: 'g', kind: 'kudos', text: 'Super Konzept' }),
    item({ id: 'a', scope: 'activity', activityIri: A1, kind: 'must', text: 'Bitte Sicherheit ergänzen.' }),
    item({ id: 'd', scope: 'camp', documentId: 'doc-a', documentAnchor: { page: 3 }, text: 'Seite prüfen' }),
  ]
  const docs = [{ id: 'doc-a', name: 'Budget.xlsx', activityIris: [] as string[] }]
  const ctx = {
    campTitle: 'Camp',
    activityTitles: { [A1]: 'Postenlauf' },
    activityNumbers: { [A1]: '2.2' },
    facts,
    documents: docs,
    template: 'Betreff: S\n\nHi\n{{items}}\n\nGruss',
  }
  it('plain: Allgemein first, then day heading, activity heading and kind-prefixed lines', () => {
    const r = renderFeedback(items, 'plain', ctx)
    expect(r.body).toContain('Allgemein:\n- Kudos: Super Konzept\n- Vorschlag: (Dokument «Budget.xlsx», S. 3) Seite prüfen')
    expect(r.body).toContain('Tag 2 · Di 14.07.:\n2.2 Postenlauf\n- Auflage: Bitte Sicherheit ergänzen.')
    expect(r.body.indexOf('Allgemein')).toBeLessThan(r.body.indexOf('Tag 2'))
    expect(r.body).toContain('Hi\nAllgemein:')
  })
  it('whatsapp: bold headings, italic activity, emoji lines', () => {
    const r = renderFeedback(items, 'whatsapp', ctx)
    expect(r.body).toContain('*Tag 2 · Di 14.07.*\n_2.2 Postenlauf_\n⚠️ Bitte Sicherheit ergänzen.')
    expect(r.body).toContain('🌟 Super Konzept')
  })
  it('html: linked activity heading and bold section headings', () => {
    const r = renderFeedback(items, 'email', { ...ctx, activityUrls: { [A1]: 'https://x.ch/a' } })
    expect(r.html).toContain('<b>Tag 2 · Di 14.07.:</b><br><a href="https://x.ch/a">2.2 Postenlauf</a><br>- Auflage: Bitte Sicherheit ergänzen.')
  })
})

describe('itemFromFinding for manual findings and documents', () => {
  const manual = {
    id: 'manual:1',
    ruleId: 'MANUAL',
    severity: 'should',
    title: 'Positiv',
    message: 'Tolle Etappe.  ',
    scope: 'document',
    targets: ['doc-a'],
    evidence: [{ kind: 'document', documentId: 'doc-a', label: 'x', anchor: { km: 4.2 } }],
    origin: 'manual',
    tags: ['Coach', 'kategorie:positive'],
  } as unknown as Finding
  it('uses the comment as text and derives the kind from the category', () => {
    const it2 = itemFromFinding(manual, '/api/camps/c1')
    expect(it2).toMatchObject({
      scope: 'camp',
      kind: 'kudos',
      text: 'Tolle Etappe.',
      manualFindingId: 'manual:1',
      findingId: 'manual:1',
      documentId: 'doc-a',
      documentAnchor: { km: 4.2 },
    })
  })
  it('activity manual finding becomes an activity item', () => {
    const f = { ...manual, scope: 'activity', targets: [A1], tags: ['kategorie:question'] } as Finding
    expect(itemFromFinding(f, '/api/camps/c1')).toMatchObject({ scope: 'activity', activityIri: A1, kind: 'question' })
  })
})

describe('GENERAL_POINTS', () => {
  function lookup(key: string): string | undefined {
    let node: string | MessageTree | undefined = messages.de as MessageTree
    for (const part of key.split('.')) {
      if (node === undefined || typeof node === 'string') return undefined
      node = node[part]
    }
    return typeof node === 'string' ? node : undefined
  }
  it('has the required ids', () => {
    const ids = GENERAL_POINTS.map((p) => p.id)
    for (const id of ['siko', 'psa', 'notfall', 'rega', 'krise', 'wetter', 'hygiene', 'nachtruhe', 'stufengerecht', 'js-admin']) {
      expect(ids).toContain(id)
    }
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('every key resolves to a German text', () => {
    for (const p of GENERAL_POINTS) {
      expect(lookup(p.titleKey), p.titleKey).toBeTruthy()
      expect(lookup(p.promptKey), p.promptKey).toBeTruthy()
      expect(p.checks.length).toBeGreaterThanOrEqual(3)
      expect(p.checks.length).toBeLessThanOrEqual(6)
      for (const c of p.checks) expect(lookup(c), c).toBeTruthy()
    }
  })
  it('usedGeneralPointIds collects generalPointId', () => {
    expect([...usedGeneralPointIds([{ generalPointId: 'siko' }, {}, { generalPointId: 'rega' }])].sort()).toEqual(['rega', 'siko'])
  })
})
