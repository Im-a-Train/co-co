import { describe, expect, it } from 'vitest'
import { parseGpxText, gpxNames } from '../extract'
import {
  buildSearchIndex,
  checkSafetyConcept,
  compareGpxToSlot,
  detectKind,
  documentFactsFrom,
  extractDates,
  gpxStatsFromPoints,
  gpxWithPace,
  resolveLinks,
  suggestActivityLinks,
} from '../index'
import { ingestDocument } from '../ingest'
import type { ActivityFact, CampFacts, DocumentRecord } from '../../types'

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="t"><trk><name>Gipfeltour &amp; Pass</name><trkseg>
<trkpt lat="46.0000" lon="7.0000"><ele>1000</ele></trkpt>
<trkpt lat="46.0100" lon="7.0000"><ele>1200</ele></trkpt>
<trkpt lat="46.0200" lon="7.0000"><ele>1500</ele></trkpt>
<trkpt lat="46.0300" lon="7.0000"><ele>1300</ele></trkpt>
</trkseg></trk></gpx>`

function activity(iri: string, title: string, extra: Partial<ActivityFact> = {}): ActivityFact {
  return {
    iri,
    title,
    location: null,
    categoryIri: null,
    progressLabelIri: null,
    rootContentNodeIri: null,
    responsibleIris: [],
    scheduleEntryIris: [],
    content: {
      storyboardText: '',
      safetyText: '',
      notesText: '',
      learningObjectivesText: '',
      materialText: '',
      laThematicAreas: [],
      learningTopics: [],
      ysCharacteristics: [],
      ysPhysicalActivityDurationMinutes: null,
      contentTypes: [],
      hasStoryboard: false,
      hasSafetyConsiderations: false,
      contentNodeCount: 0,
    },
    ...extra,
  } as ActivityFact
}

function facts(): CampFacts {
  return {
    schemaVersion: 1,
    loadedAt: '2026-01-01T00:00:00Z',
    instanceBaseUrl: null,
    userIri: null,
    camp: {
      iri: '/api/camps/c1',
      id: 'c1',
      title: 'Lager',
      address: { name: 'Pfadiheim Eiche', street: 'Waldweg 5', zipcode: '3000', city: 'Bern' },
    },
    periods: [],
    days: [
      { iri: '/api/days/d1', periodIri: 'p', number: 1, dayOffset: 0, date: '2026-07-20', start: '', end: '' },
      { iri: '/api/days/d2', periodIri: 'p', number: 2, dayOffset: 1, date: '2026-07-21', start: '', end: '' },
    ],
    scheduleEntries: [
      {
        iri: '/api/schedule_entries/s1',
        activityIri: '/api/activities/a1',
        periodIri: 'p',
        dayIri: '/api/days/d2',
        start: '2026-07-21T08:00:00+00:00',
        end: '2026-07-21T12:00:00+00:00',
        durationMinutes: 240,
      },
    ],
    activities: [
      activity('/api/activities/a1', 'Gipfeltour Wanderung', {
        scheduleEntryIris: ['/api/schedule_entries/s1'],
        content: { ...activity('x', 'x').content, storyboardText: 'Aufstieg zum Gipfel mit Zvieri', safetyText: 'Seilsicherung' },
      }),
      activity('/api/activities/a2', 'Postenlauf Nacht'),
    ],
    categories: [],
    collaborators: [],
    dayResponsibles: [],
    activityResponsibles: [],
    progressLabels: [],
    comments: [],
  } as unknown as CampFacts
}

describe('detectKind', () => {
  it('maps extensions', () => {
    expect(detectKind('a.PDF')).toBe('pdf')
    expect(detectKind('a.docx')).toBe('docx')
    expect(detectKind('route.gpx')).toBe('gpx')
    expect(detectKind('n.md')).toBe('md')
    expect(detectKind('n.txt')).toBe('txt')
    expect(detectKind('n.png')).toBe('other')
    expect(detectKind('noext')).toBe('other')
  })
})

describe('GPX', () => {
  it('parses text and names', () => {
    const p = parseGpxText(GPX)
    expect(p.points).toHaveLength(4)
    expect(p.points[1]).toEqual({ lat: 46.01, lon: 7, ele: 1200 })
    expect(p.name).toBe('Gipfeltour & Pass')
    expect(gpxNames(GPX)).toEqual(['Gipfeltour & Pass'])
  })
  it('computes stats', () => {
    const p = parseGpxText(GPX)
    const s = gpxStatsFromPoints(p.points, { paceLkmPerHour: 4, includeDescent: false }, p.name)
    expect(s.distanceKm).toBeCloseTo(3.33, 1)
    expect(s.ascentM).toBe(500)
    expect(s.descentM).toBe(200)
    expect(s.highestPointM).toBe(1500)
    expect(s.lowestPointM).toBe(1000)
    expect(s.lkm).toBeCloseTo(8.3, 1)
    expect(s.lkmWithDescent).toBeCloseTo(9.7, 1)
    expect(s.estimatedMinutes).toBe(Math.round((s.lkm / 4) * 60))
  })
  it('ignores elevation noise and handles missing ele', () => {
    const s = gpxStatsFromPoints(
      [
        { lat: 46, lon: 7, ele: 100 },
        { lat: 46.001, lon: 7, ele: 101 },
        { lat: 46.002, lon: 7, ele: 100 },
        { lat: 46.003, lon: 7, ele: null },
      ],
      { paceLkmPerHour: 4, includeDescent: false },
    )
    expect(s.ascentM).toBe(0)
    expect(s.highestPointM).toBe(101)
    const empty = gpxStatsFromPoints([{ lat: 1, lon: 1, ele: null }], { paceLkmPerHour: 4, includeDescent: false })
    expect(empty.highestPointM).toBeNull()
    expect(empty.distanceKm).toBe(0)
  })
  it('recomputes pace and compares with slot', () => {
    const p = parseGpxText(GPX)
    const s = gpxStatsFromPoints(p.points, { paceLkmPerHour: 4, includeDescent: false })
    const slow = gpxWithPace(s, 3.5, false)
    expect(slow.estimatedMinutes).toBeGreaterThan(s.estimatedMinutes)
    expect(gpxWithPace(s, 4, true).estimatedMinutes).toBeGreaterThan(s.estimatedMinutes)
    const f = facts()
    expect(compareGpxToSlot(s, f, ['/api/activities/a1'])).toMatchObject({ slotMinutes: 240, fits: true })
    expect(compareGpxToSlot({ ...s, estimatedMinutes: 300 }, f, ['/api/activities/a1']).fits).toBe(false)
    expect(compareGpxToSlot(s, f, ['/api/activities/a2']).fits).toBeNull()
  })
})

describe('checkSafetyConcept', () => {
  const full = `Sicherheitskonzept
Notfallnummern: Sanität 144, Rega 1414, Polizei 117, Feuerwehr 118, Tox 145.
Nächstes Spital: Inselspital Bern. Krisenkontakt: Pfadi-Helpline.
Evakuation: Sammelplatz beim Heim, Notunterkunft Turnhalle.
Bei Schlechtwetter gilt das Regenprogramm. 3x3 Lagebeurteilung vor jeder Aktivität.
Erste Hilfe: Apotheke im Zelt, verantwortlich Anna. Lageradresse: Waldweg 5, Bern.`
  it('finds all items in a complete concept', () => {
    const r = checkSafetyConcept(full, facts())
    expect(r.complete).toBe(true)
    expect(r.items).toHaveLength(8)
    expect(r.items.find((i) => i.key === 'hospital')!.snippets[0]).toContain('Spital')
  })
  it('reports missing items', () => {
    const r = checkSafetyConcept('Notfall: 144 und 117. Bei Gewitter gehen wir rein.')
    expect(r.complete).toBe(false)
    const get = (k: string) => r.items.find((i) => i.key === k)!
    expect(get('emergencyNumbers').found).toBe(false)
    expect(get('badWeather').found).toBe(true)
    expect(get('hospital').found).toBe(false)
    expect(get('campAddress').found).toBe(false)
  })
  it('does not match 144 inside other numbers', () => {
    const r = checkSafetyConcept('Tel 031 1144 55, Preis 1445')
    expect(r.items.find((i) => i.key === 'emergencyNumbers')!.snippets).toHaveLength(0)
  })
  it('detects camp address from facts and coordinates', () => {
    expect(checkSafetyConcept('Treffpunkt Pfadiheim Eiche', facts()).items.find((i) => i.key === 'campAddress')!.found).toBe(true)
    expect(checkSafetyConcept('Position 46.9481, 7.4474').items.find((i) => i.key === 'campAddress')!.found).toBe(true)
  })
})

describe('linking', () => {
  it('extracts dates', () => {
    expect(extractDates('Plan_21.07.2026.pdf')).toContainEqual([2026, 7, 21])
    expect(extractDates('Plan 2026-07-21')).toContainEqual([2026, 7, 21])
    expect(extractDates('Tag 21.7. Plan')).toContainEqual([null, 7, 21])
  })
  it('links by title in filename (auto)', () => {
    const s = suggestActivityLinks({ name: 'Gipfeltour Wanderung Route.gpx', text: '' }, facts())
    expect(s[0]!.activityIri).toBe('/api/activities/a1')
    expect(s[0]!.score).toBeGreaterThanOrEqual(0.8)
    expect(resolveLinks(s).linked).toEqual(['/api/activities/a1'])
  })
  it('partial match stays a suggestion', () => {
    const s = suggestActivityLinks({ name: 'gipfel.pdf', text: '' }, facts())
    const r = resolveLinks(s)
    expect(r.linked).toEqual([])
    expect(r.open[0]?.activityIri).toBe('/api/activities/a1')
  })
  it('date bonus', () => {
    const s = suggestActivityLinks({ name: 'Gipfeltour 21.07.2026.pdf', text: '' }, facts())
    expect(s[0]!.reason).toContain('Datum')
    const onlyDate = suggestActivityLinks({ name: 'Notizen 21.07.2026.txt', text: '' }, facts())
    expect(onlyDate[0]).toMatchObject({ activityIri: '/api/activities/a1', score: 0.3 })
  })
  it('no match gives nothing', () => {
    expect(suggestActivityLinks({ name: 'Budget.xlsx', text: '' }, facts())).toEqual([])
  })
})

function doc(partial: Partial<DocumentRecord>): DocumentRecord {
  return {
    id: 'd1',
    campIri: '/api/camps/c1',
    path: 'C:/x.pdf',
    name: 'x.pdf',
    kind: 'pdf',
    size: 1,
    modifiedMs: 0,
    importedAt: '',
    source: 'picker',
    folder: null,
    contentHash: 'h',
    text: '',
    extractError: null,
    activityIris: [],
    linkSuggestions: [],
    docCheck: null,
    gpx: null,
    zone: 'yellow',
    aiAllowed: false,
    aiSummary: null,
    ...partial,
  }
}

describe('search', () => {
  it('finds documents and activities', () => {
    const idx = buildSearchIndex(
      [doc({ id: 'd1', name: 'Sicherheitskonzept.pdf', text: 'Bei Gewitter gehen alle in die Notunterkunft Turnhalle.' })],
      facts(),
    )
    const hits = idx.search('Notunterkunft')
    expect(hits[0]).toMatchObject({ kind: 'document', documentId: 'd1' })
    expect(hits[0]!.snippet).toContain('Notunterkunft')
    const a = idx.search('seilsicherung')
    expect(a.some((h) => h.kind === 'activity' && h.activityIri === '/api/activities/a1')).toBe(true)
    expect(idx.search('gipf').some((h) => h.title === 'Gipfeltour Wanderung')).toBe(true)
    expect(idx.search('   ')).toEqual([])
    expect(idx.search('Zürich')).toEqual([])
  })
  it('works without facts', () => {
    expect(buildSearchIndex([], null).search('a')).toEqual([])
  })
})

describe('documentFactsFrom', () => {
  it('derives rule facts', () => {
    const check = checkSafetyConcept('144 1414 117 Spital Krisenkontakt Evakuation Schlechtwetter 3x3 Apotheke Adresse')
    const s = gpxStatsFromPoints(parseGpxText(GPX).points, { paceLkmPerHour: 4, includeDescent: false })
    const f = documentFactsFrom([
      doc({ id: 'safety', name: 'Sicherheitskonzept.pdf', docCheck: check }),
      doc({ id: 'g', name: 'r.gpx', kind: 'gpx', gpx: s, activityIris: ['/api/activities/a1'] }),
    ])
    expect(f.safetyConceptComplete).toBe(true)
    expect(f.gpxByActivity['/api/activities/a1']).toHaveLength(1)
    expect(f.activitiesWithDocument).toEqual(['/api/activities/a1'])
    const none = documentFactsFrom([])
    expect(none.safetyConceptComplete).toBe(false)
    expect(none.missingChecks).toHaveLength(8)
  })
})

describe('ingestDocument', () => {
  const ctx = { facts: facts(), gpx: { paceLkmPerHour: 4, includeDescent: false }, newId: () => 'id1' }
  const input = (name: string, content: string) => {
    const bytes = new TextEncoder().encode(content)
    return {
      campIri: '/api/camps/c1',
      path: 'C:/' + name,
      name,
      size: bytes.length,
      modifiedMs: 1,
      bytes,
      source: 'drop' as const,
      folder: null,
    }
  }
  it('ingests txt with defaults, then keeps state on change and skips unchanged', async () => {
    const { record, changed } = await ingestDocument(input('Sicherheit.txt', 'Notfall 144 1414 117, Spital'), null, ctx)
    expect(changed).toBe(true)
    expect(record).toMatchObject({ zone: 'yellow', aiAllowed: false, kind: 'txt', id: 'id1' })
    expect(record.docCheck!.items.find((i) => i.key === 'hospital')!.found).toBe(true)
    const same = await ingestDocument(input('Sicherheit.txt', 'Notfall 144 1414 117, Spital'), record, ctx)
    expect(same.changed).toBe(false)
    const edited = { ...record, aiAllowed: true, activityIris: ['/api/activities/a2'] }
    const re = await ingestDocument(input('Sicherheit.txt', 'neuer Inhalt'), edited, ctx)
    expect(re.changed).toBe(true)
    expect(re.record).toMatchObject({ id: 'id1', aiAllowed: true, activityIris: ['/api/activities/a2'] })
  })
  it('ingests gpx and links it', async () => {
    const { record } = await ingestDocument(input('Gipfeltour Wanderung.gpx', GPX), null, ctx)
    expect(record.gpx!.ascentM).toBe(500)
    expect(record.activityIris).toEqual(['/api/activities/a1'])
  })
  it('records errors for unsupported files', async () => {
    const { record } = await ingestDocument(input('bild.png', 'x'), null, ctx)
    expect(record.extractError).toBeTruthy()
    expect(record.zone).toBe('yellow')
  })
})
