/**
 * Documents domain (M3).
 *
 * Pure helpers (testable in Node). Extraction with pdfjs-dist / mammoth lives in ./extract.ts.
 * Every new DocumentRecord: zone 'yellow', aiAllowed false (see ./ingest.ts).
 */
import MiniSearch from 'minisearch'
import type {
  ActivityLinkSuggestion,
  CampFacts,
  DocCheckItem,
  DocCheckResult,
  DocumentKind,
  DocumentRecord,
  GpxStats,
  Iri,
  SafetyCheckKey,
} from '../types'
import { DOC_CHECK } from '../rules/lib/docCheck'

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024

export interface GpxPoint {
  lat: number
  lon: number
  /** metres, null if missing */
  ele: number | null
  /** First point of a new track segment (distance is not bridged). */
  newSegment?: boolean
}

export interface GpxOptions {
  paceLkmPerHour: number
  includeDescent: boolean
}

export interface SearchHit {
  /** 'doc:<id>' | 'activity:<iri>' */
  ref: string
  kind: 'document' | 'activity'
  title: string
  snippet: string
  score: number
  documentId?: string
  activityIri?: Iri
}

/** Score threshold above which a suggestion is linked automatically. */
export const AUTO_LINK_SCORE = 0.8

// ---------------------------------------------------------------------------------------------
// Kind detection
// ---------------------------------------------------------------------------------------------

export function detectKind(fileName: string): DocumentKind {
  const m = /\.([A-Za-z0-9]+)$/.exec(fileName.trim())
  const ext = m ? m[1]!.toLowerCase() : ''
  switch (ext) {
    case 'pdf':
      return 'pdf'
    case 'docx':
      return 'docx'
    case 'xlsx':
      return 'xlsx'
    case 'gpx':
      return 'gpx'
    case 'txt':
      return 'txt'
    case 'md':
    case 'markdown':
      return 'md'
    default:
      return 'other'
  }
}

// ---------------------------------------------------------------------------------------------
// GPX statistics
// ---------------------------------------------------------------------------------------------

const EARTH_RADIUS_M = 6371008.8
/** Elevation changes below this threshold (metres) are treated as noise. */
const ELE_NOISE_M = 3

export function haversineM(a: GpxPoint, b: GpxPoint): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

export function gpxStatsFromPoints(points: GpxPoint[], options: GpxOptions, name?: string | null): GpxStats {
  let distanceM = 0
  for (let i = 1; i < points.length; i++) if (!points[i]!.newSegment) distanceM += haversineM(points[i - 1]!, points[i]!)

  // Ascent/descent with a noise threshold (hysteresis on a reference elevation).
  let ascent = 0
  let descent = 0
  let ref: number | null = null
  let highest: number | null = null
  let lowest: number | null = null
  for (const p of points) {
    if (p.newSegment) ref = null
    if (p.ele === null || !Number.isFinite(p.ele)) continue
    highest = highest === null ? p.ele : Math.max(highest, p.ele)
    lowest = lowest === null ? p.ele : Math.min(lowest, p.ele)
    if (ref === null) {
      ref = p.ele
      continue
    }
    const d = p.ele - ref
    if (d >= ELE_NOISE_M) {
      ascent += d
      ref = p.ele
    } else if (d <= -ELE_NOISE_M) {
      descent += -d
      ref = p.ele
    }
  }

  const distanceKm = distanceM / 1000
  const lkm = distanceKm + ascent / 100
  const lkmWithDescent = lkm + descent / 150
  const used = options.includeDescent ? lkmWithDescent : lkm
  const pace = options.paceLkmPerHour > 0 ? options.paceLkmPerHour : 4
  return {
    name: name ?? null,
    pointCount: points.length,
    distanceKm: round2(distanceKm),
    ascentM: Math.round(ascent),
    descentM: Math.round(descent),
    lkm: round1(lkm),
    lkmWithDescent: round1(lkmWithDescent),
    paceLkmPerHour: pace,
    estimatedMinutes: Math.round((used / pace) * 60),
    highestPointM: highest === null ? null : Math.round(highest),
    lowestPointM: lowest === null ? null : Math.round(lowest),
  }
}

/** Recomputes the time estimate of stored stats with another pace / descent flag. */
export function gpxWithPace(stats: GpxStats, paceLkmPerHour: number, includeDescent: boolean): GpxStats {
  const pace = paceLkmPerHour > 0 ? paceLkmPerHour : 4
  const used = includeDescent ? stats.lkmWithDescent : stats.lkm
  return { ...stats, paceLkmPerHour: pace, estimatedMinutes: Math.round((used / pace) * 60) }
}

export interface GpxSlotComparison {
  estimatedMinutes: number
  /** Longest schedule slot (minutes) of the linked activities; null if none. */
  slotMinutes: number | null
  /** null when no slot is known. */
  fits: boolean | null
  /** estimated - slot (positive = too long) */
  deltaMinutes: number | null
}

/** Compares the GPX time estimate with the longest scheduled slot of the given activities. */
export function compareGpxToSlot(
  gpx: GpxStats,
  facts: CampFacts | null,
  activityIris: Iri[],
): GpxSlotComparison {
  let slot: number | null = null
  if (facts) {
    for (const e of facts.scheduleEntries) {
      if (activityIris.includes(e.activityIri) && (slot === null || e.durationMinutes > slot)) slot = e.durationMinutes
    }
  }
  return {
    estimatedMinutes: gpx.estimatedMinutes,
    slotMinutes: slot,
    fits: slot === null ? null : gpx.estimatedMinutes <= slot,
    deltaMinutes: slot === null ? null : gpx.estimatedMinutes - slot,
  }
}

// ---------------------------------------------------------------------------------------------
// Safety concept checklist
// ---------------------------------------------------------------------------------------------

export const SAFETY_CHECK_KEYS: SafetyCheckKey[] = [
  'emergencyNumbers',
  'hospital',
  'crisisContact',
  'evacuation',
  'badWeather',
  'threeByThree',
  'firstAid',
  'campAddress',
]

// Numbers, labels and patterns live in rules/packs/jslst/keywords/docCheck.yaml (rules v2 §3.12).
const EMERGENCY_NUMBERS = DOC_CHECK.emergencyNumbers.numbers
const PATTERNS = DOC_CHECK.patterns
const COORD_RE = DOC_CHECK.coordinates

function snippetAround(text: string, index: number, length: number, radius = 70): string {
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + length + radius)
  let s = text.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) s = '… ' + s
  if (end < text.length) s += ' …'
  return s
}

function collectSnippets(text: string, re: RegExp, max = 3): string[] {
  const out: string[] = []
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  let m: RegExpExecArray | null
  let lastEnd = -1
  while ((m = rx.exec(text)) && out.length < max) {
    if (m[0].length === 0) {
      rx.lastIndex++
      continue
    }
    if (m.index < lastEnd) continue
    out.push(snippetAround(text, m.index, m[0].length))
    lastEnd = m.index + m[0].length + 70
  }
  return out
}

/** Safety-concept checklist (emergency numbers, hospital, crisis contact, ...) with snippets. */
export function checkSafetyConcept(text: string, facts?: CampFacts | null, now: Date = new Date()): DocCheckResult {
  const items: DocCheckItem[] = []
  for (const key of SAFETY_CHECK_KEYS) {
    if (key === 'emergencyNumbers') {
      const present: string[] = []
      const snippets: string[] = []
      for (const n of EMERGENCY_NUMBERS) {
        const m = new RegExp(`(?<![\\d.])${n}(?!\\d)`).exec(text)
        if (!m) continue
        present.push(n)
        if (snippets.length < 3) snippets.push(snippetAround(text, m.index, n.length))
      }
      // Required numbers (144) plus enough further numbers (minCount in total).
      const { required, minCount } = DOC_CHECK.emergencyNumbers
      items.push({ key, found: required.every((n) => present.includes(n)) && present.length >= minCount, snippets })
    } else if (key === 'campAddress') {
      const snippets: string[] = []
      const a = facts?.camp.address
      for (const part of [a?.street, a?.name, a?.city]) {
        if (!part || part.trim().length < 3) continue
        const i = text.toLowerCase().indexOf(part.trim().toLowerCase())
        if (i >= 0 && snippets.length < 3) snippets.push(snippetAround(text, i, part.length))
      }
      snippets.push(...collectSnippets(text, COORD_RE, 2))
      items.push({ key, found: snippets.length > 0, snippets: snippets.slice(0, 3) })
    } else {
      const snippets = collectSnippets(text, PATTERNS[key]!)
      items.push({ key, found: snippets.length > 0, snippets })
    }
  }
  return { items, complete: items.every((i) => i.found), checkedAt: now.toISOString() }
}

// ---------------------------------------------------------------------------------------------
// Linking documents to activities
// ---------------------------------------------------------------------------------------------

const STOPWORDS = new Set([
  'der', 'die', 'das', 'und', 'mit', 'für', 'fur', 'von', 'vom', 'zum', 'zur', 'ein', 'eine', 'auf', 'bei',
  'lager', 'camp', 'final', 'version', 'entwurf', 'neu', 'kopie', 'pdf', 'docx', 'gpx', 'txt',
])

/** Lowercase, umlauts folded, ß -> ss, non-alphanumerics -> space. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokens(s: string): string[] {
  return normalizeText(s)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
}

/** Extracts dates (YYYY-MM-DD, DD.MM.YYYY, DD.MM.) from a name. Returns [year|null, month, day]. */
export function extractDates(name: string): Array<[number | null, number, number]> {
  const out: Array<[number | null, number, number]> = []
  for (const m of name.matchAll(/(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})/g)) out.push([+m[1]!, +m[2]!, +m[3]!])
  for (const m of name.matchAll(/(?<!\d)(\d{1,2})[._-](\d{1,2})[._-](\d{4})(?!\d)/g)) out.push([+m[3]!, +m[2]!, +m[1]!])
  for (const m of name.matchAll(/(?<![\d.])(\d{1,2})\.(\d{1,2})\.(?!\d)/g)) out.push([null, +m[2]!, +m[1]!])
  return out.filter(([, mo, d]) => mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
}

function dayNumbersFromName(name: string): number[] {
  return [...normalizeText(name).matchAll(/\btag (\d{1,2})\b/g)].map((m) => +m[1]!)
}

/** Link candidates by filename/title/date similarity, best first. */
export function suggestActivityLinks(
  doc: Pick<DocumentRecord, 'name' | 'text'>,
  facts: CampFacts,
): ActivityLinkSuggestion[] {
  const baseName = doc.name.replace(/\.[A-Za-z0-9]+$/, '')
  const nameNorm = ' ' + normalizeText(baseName) + ' '
  const nameTokens = new Set(tokens(baseName))
  const headNorm = ' ' + normalizeText(doc.text.slice(0, 300)) + ' '
  const headTokens = new Set(tokens(doc.text.slice(0, 300)))

  const dates = extractDates(doc.name)
  const dayNums = dayNumbersFromName(doc.name)
  const dayIrisByDate = new Set<Iri>()
  for (const d of facts.days) {
    const [y, mo, da] = d.date.split('-').map(Number) as [number, number, number]
    if (dates.some(([dy, dm, dd]) => dm === mo && dd === da && (dy === null || dy === y))) dayIrisByDate.add(d.iri)
    if (dayNums.includes(d.number)) dayIrisByDate.add(d.iri)
  }
  const entryByIri = new Map(facts.scheduleEntries.map((e) => [e.iri, e]))

  const out: ActivityLinkSuggestion[] = []
  for (const a of facts.activities) {
    const titleNorm = normalizeText(a.title)
    const titleTokens = tokens(a.title)
    if (!titleTokens.length) continue

    let score = 0
    let reason = ''
    if (titleNorm.length >= 4 && nameNorm.includes(' ' + titleNorm + ' ')) {
      score = 0.9
      reason = 'Titel im Dateinamen'
    } else {
      const hit = titleTokens.filter(
        (t) =>
          nameTokens.has(t) ||
          [...nameTokens].some((n) => n.length >= 5 && t.length >= 5 && (n.startsWith(t) || t.startsWith(n))),
      )
      if (hit.length > 0) {
        score = Math.min(0.75, 0.25 + 0.5 * (hit.length / titleTokens.length))
        reason = `Wörter im Dateinamen: ${hit.join(', ')}`
      }
      if (score < 0.6) {
        if (titleNorm.length >= 6 && headNorm.includes(' ' + titleNorm + ' ')) {
          score = Math.max(score, 0.6)
          reason = 'Titel im Dokumentanfang'
        } else {
          const hh = titleTokens.filter((t) => headTokens.has(t))
          const s = hh.length ? Math.min(0.5, 0.15 + 0.35 * (hh.length / titleTokens.length)) : 0
          if (s > score) {
            score = s
            reason = `Wörter im Dokumentanfang: ${hh.join(', ')}`
          }
        }
      }
    }

    // Date bonus: activity scheduled on a day mentioned in the filename.
    if (dayIrisByDate.size) {
      const onDay = a.scheduleEntryIris.some((ei) => {
        const e = entryByIri.get(ei)
        return !!e?.dayIri && dayIrisByDate.has(e.dayIri)
      })
      if (onDay) {
        if (score > 0) {
          score = Math.min(1, score + 0.2)
          reason += ' + Datum'
        } else {
          score = 0.3
          reason = 'Datum im Dateinamen'
        }
      }
    }

    if (score >= 0.3) out.push({ activityIri: a.iri, score: round2(score), reason })
  }
  return out.sort((x, y) => y.score - x.score).slice(0, 5)
}

/** Splits suggestions into automatic links and open "bestätigen?" candidates. */
export function resolveLinks(suggestions: ActivityLinkSuggestion[]): { linked: Iri[]; open: ActivityLinkSuggestion[] } {
  const top = suggestions[0]
  if (!top) return { linked: [], open: [] }
  const second = suggestions[1]
  if (top.score >= AUTO_LINK_SCORE && (!second || top.score - second.score >= 0.15)) {
    return { linked: [top.activityIri], open: suggestions.slice(1) }
  }
  return { linked: [], open: suggestions }
}

// ---------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------

/** Full-text search (MiniSearch) over documents + eCamp content. */
export interface CampSearchIndex {
  search(query: string): SearchHit[]
}

interface IndexEntry {
  id: string
  title: string
  text: string
  kind: 'document' | 'activity'
  documentId?: string
  activityIri?: Iri
}

function makeSnippet(text: string, terms: string[], radius = 70): string {
  const flat = text.replace(/\s+/g, ' ')
  const lower = flat.toLowerCase()
  let best = -1
  for (const t of terms) {
    if (!t) continue
    const i = lower.indexOf(t.toLowerCase())
    if (i >= 0 && (best < 0 || i < best)) best = i
  }
  if (best < 0) return flat.slice(0, radius * 2) + (flat.length > radius * 2 ? ' …' : '')
  const start = Math.max(0, best - radius)
  const end = Math.min(flat.length, best + radius)
  return (start > 0 ? '… ' : '') + flat.slice(start, end).trim() + (end < flat.length ? ' …' : '')
}

export function buildSearchIndex(documents: DocumentRecord[], facts: CampFacts | null): CampSearchIndex {
  const entries: IndexEntry[] = []
  for (const d of documents) {
    entries.push({ id: `doc:${d.id}`, title: d.name, text: d.text, kind: 'document', documentId: d.id })
  }
  if (facts) {
    for (const a of facts.activities) {
      const c = a.content
      const text = [a.location ?? '', c.storyboardText, c.safetyText, c.notesText, c.learningObjectivesText, c.materialText]
        .filter(Boolean)
        .join('\n')
      entries.push({ id: `activity:${a.iri}`, title: a.title, text, kind: 'activity', activityIri: a.iri })
    }
  }
  const byId = new Map(entries.map((e) => [e.id, e]))
  const mini = new MiniSearch<IndexEntry>({
    fields: ['title', 'text'],
    processTerm: (t) => normalizeText(t) || null,
    searchOptions: { boost: { title: 2 }, prefix: true, fuzzy: 0.15, combineWith: 'AND' },
  })
  mini.addAll(entries)
  return {
    search(query: string): SearchHit[] {
      const q = query.trim()
      if (!q) return []
      let results = mini.search(q)
      if (!results.length) results = mini.search(q, { combineWith: 'OR' })
      return results.slice(0, 50).map((r) => {
        const e = byId.get(r.id as string)!
        const rawTerms = [...q.split(/\s+/), ...Object.keys(r.match)]
        return {
          ref: e.id,
          kind: e.kind,
          title: e.title,
          snippet: makeSnippet(e.text, rawTerms),
          score: round2(r.score),
          documentId: e.documentId,
          activityIri: e.activityIri,
        }
      })
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Facts for rules
// ---------------------------------------------------------------------------------------------

export interface DocumentFacts {
  /** True when at least one safety-concept document has a complete checklist. */
  safetyConceptComplete: boolean
  safetyConceptDocumentIds: string[]
  /** Checklist keys missing in the best document (all keys when no document was checked). */
  missingChecks: SafetyCheckKey[]
  /** Activity IRIs that have a linked document (any kind). */
  activitiesWithDocument: Iri[]
  /** GPX stats per linked activity. */
  gpxByActivity: Record<Iri, GpxStats[]>
}

/** Safety concept documents are recognised by a name hint or by having at least 4 checklist items found. */
export function isSafetyConceptCandidate(doc: Pick<DocumentRecord, 'name' | 'docCheck'>): boolean {
  if (!doc.docCheck) return false
  if (/sicherheit|safety|notfall|krisen/i.test(doc.name)) return true
  return doc.docCheck.items.filter((i) => i.found).length >= 4
}

export function documentFactsFrom(docs: DocumentRecord[]): DocumentFacts {
  const candidates = docs.filter(isSafetyConceptCandidate)
  const found = (c: DocCheckResult) => c.items.filter((i) => i.found).length
  let best: DocCheckResult | null = null
  for (const d of candidates) if (!best || found(d.docCheck!) > found(best)) best = d.docCheck
  const gpxByActivity: Record<Iri, GpxStats[]> = {}
  const withDoc = new Set<Iri>()
  for (const d of docs) {
    for (const iri of d.activityIris) {
      withDoc.add(iri)
      if (d.gpx) (gpxByActivity[iri] ??= []).push(d.gpx)
    }
  }
  return {
    safetyConceptComplete: !!best?.complete,
    safetyConceptDocumentIds: candidates.map((d) => d.id),
    missingChecks: best ? best.items.filter((i) => !i.found).map((i) => i.key) : [...SAFETY_CHECK_KEYS],
    activitiesWithDocument: [...withDoc],
    gpxByActivity,
  }
}
