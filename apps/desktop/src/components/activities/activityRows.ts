/**
 * Pure row model of the activity list: building, filtering, sorting, URL query (de)serialisation.
 * Times are camp-local wall clock: sliced from the ISO strings, never converted (see domain/types.ts).
 */
import { activityIriOfFinding } from '../../domain/triage'
import { dateOf, minutesOfDay, SEVERITIES } from '../../domain/cockpit'
import type { CampFacts, CategoryClass, DocumentRecord, Finding, Iri, IsoDate, Severity } from '../../domain/types'

export interface RowEntry {
  iri: Iri
  date: IsoDate
  dayNumber: number | null
  startMin: number
  endMin: number
  number: string | null
}

export interface ActivityRow {
  iri: Iri
  title: string
  /** Number of the first schedule entry, e.g. "4.1". */
  number: string | null
  entries: RowEntry[]
  /** Sortable start of the first entry (`YYYY-MM-DDTHH:MM`), '' without entries. */
  firstStart: string
  durationMinutes: number
  location: string
  categoryIri: Iri | null
  categoryShort: string
  categoryColor: string | null
  categoryClass: CategoryClass
  responsibles: string[]
  progress: string
  progressPosition: number
  findings: Record<Severity, number>
  findingCount: number
  /** Coach findings (origin 'manual') of the activity; not part of `findings` / `findingCount`. */
  manualCount: number
  documentCount: number
}

export interface RowFilter {
  q: string
  categoryClass: CategoryClass | null
  /** Camp-local date (ISO) of a schedule entry. */
  date: IsoDate | null
  onlyFindings: boolean
  noResponsible: boolean
}

export const DEFAULT_ROW_FILTER: RowFilter = { q: '', categoryClass: null, date: null, onlyFindings: false, noResponsible: false }

export type SortKey =
  | 'number'
  | 'title'
  | 'category'
  | 'time'
  | 'duration'
  | 'location'
  | 'responsibles'
  | 'progress'
  | 'findings'
  | 'documents'

function clock(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function buildRows(
  facts: CampFacts,
  findings: Finding[],
  documents: Pick<DocumentRecord, 'activityIris'>[],
  classOf: (categoryIri: Iri | null) => CategoryClass,
): ActivityRow[] {
  const cats = new Map(facts.categories.map((c) => [c.iri, c]))
  const progress = new Map(facts.progressLabels.map((p) => [p.iri, p]))
  const people = new Map(facts.collaborators.map((c) => [c.iri, c.displayName]))

  const entriesOf = new Map<Iri, RowEntry[]>()
  for (const e of facts.scheduleEntries) {
    const list = entriesOf.get(e.activityIri) ?? []
    list.push({
      iri: e.iri,
      date: dateOf(e.start),
      dayNumber: e.dayNumber,
      startMin: minutesOfDay(e.start),
      endMin: minutesOfDay(e.end),
      number: e.number,
    })
    entriesOf.set(e.activityIri, list)
  }
  const findingCounts = new Map<Iri, Record<Severity, number>>()
  const manualCounts = new Map<Iri, number>()
  for (const f of findings) {
    const iri = activityIriOfFinding(f, facts)
    if (!iri) continue
    if (f.origin === 'manual') {
      manualCounts.set(iri, (manualCounts.get(iri) ?? 0) + 1)
      continue
    }
    const c = findingCounts.get(iri) ?? { must: 0, should: 0, hint: 0 }
    c[f.severity] += 1
    findingCounts.set(iri, c)
  }
  const docCounts = new Map<Iri, number>()
  for (const d of documents) for (const iri of d.activityIris) docCounts.set(iri, (docCounts.get(iri) ?? 0) + 1)

  const rows = facts.activities.map((a): ActivityRow => {
    const entries = (entriesOf.get(a.iri) ?? []).sort((x, y) => x.date.localeCompare(y.date) || x.startMin - y.startMin)
    const cat = a.categoryIri ? cats.get(a.categoryIri) : undefined
    const pl = a.progressLabelIri ? progress.get(a.progressLabelIri) : undefined
    const fc = findingCounts.get(a.iri) ?? { must: 0, should: 0, hint: 0 }
    const first = entries[0]
    return {
      iri: a.iri,
      title: a.title,
      number: first?.number ?? null,
      entries,
      firstStart: first ? `${first.date}T${clock(first.startMin)}` : '',
      durationMinutes: entries.reduce((sum, e) => sum + Math.max(0, e.endMin - e.startMin), 0),
      location: a.location ?? '',
      categoryIri: a.categoryIri,
      categoryShort: cat?.short ?? '',
      categoryColor: cat?.color ?? null,
      categoryClass: classOf(a.categoryIri),
      responsibles: a.responsibleIris.map((i) => people.get(i) ?? '?'),
      progress: pl?.title ?? '',
      progressPosition: pl?.position ?? -1,
      findings: fc,
      findingCount: fc.must + fc.should + fc.hint,
      manualCount: manualCounts.get(a.iri) ?? 0,
      documentCount: docCounts.get(a.iri) ?? 0,
    }
  })
  return sortRows(rows, 'time', 'asc')
}

export function filterRows(rows: ActivityRow[], f: RowFilter): ActivityRow[] {
  const q = f.q.trim().toLowerCase()
  return rows.filter((r) => {
    if (q && ![r.title, r.location, ...r.responsibles].some((s) => s.toLowerCase().includes(q))) return false
    if (f.categoryClass && r.categoryClass !== f.categoryClass) return false
    if (f.date && !r.entries.some((e) => e.date === f.date)) return false
    if (f.onlyFindings && r.findingCount === 0 && r.manualCount === 0) return false
    if (f.noResponsible && r.responsibles.length > 0) return false
    return true
  })
}

/** Dotted numbers compare numerically (2.10 after 2.9); rows without number go last. */
export function compareNumbers(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return a.localeCompare(b)
}

function compareStr(a: string, b: string): number {
  return a.localeCompare(b, 'de', { sensitivity: 'base' })
}

/** Empty values always sort last, independent of direction. */
function isEmpty(r: ActivityRow, key: SortKey): boolean {
  switch (key) {
    case 'number':
      return r.number === null
    case 'time':
      return r.firstStart === ''
    case 'category':
      return r.categoryShort === ''
    case 'location':
      return r.location === ''
    case 'responsibles':
      return r.responsibles.length === 0
    case 'progress':
      return r.progressPosition < 0
    default:
      return false
  }
}

export function compareRows(key: SortKey): (a: ActivityRow, b: ActivityRow) => number {
  switch (key) {
    case 'number':
      return (a, b) => compareNumbers(a.number, b.number)
    case 'title':
      return (a, b) => compareStr(a.title, b.title)
    case 'category':
      return (a, b) => compareStr(a.categoryShort, b.categoryShort)
    case 'time':
      return (a, b) => a.firstStart.localeCompare(b.firstStart)
    case 'duration':
      return (a, b) => a.durationMinutes - b.durationMinutes
    case 'location':
      return (a, b) => compareStr(a.location, b.location)
    case 'responsibles':
      return (a, b) => compareStr(a.responsibles.join(', '), b.responsibles.join(', '))
    case 'progress':
      return (a, b) => a.progressPosition - b.progressPosition
    case 'findings':
      return (a, b) => SEVERITIES.reduce((d, s) => d || a.findings[s] - b.findings[s], 0)
    case 'documents':
      return (a, b) => a.documentCount - b.documentCount
  }
}

/** Stable sort; ties fall back to start time, then number. */
export function sortRows(rows: ActivityRow[], key: SortKey, dir: 'asc' | 'desc'): ActivityRow[] {
  const cmp = compareRows(key)
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const ea = isEmpty(a, key)
    const eb = isEmpty(b, key)
    if (ea !== eb) return ea ? 1 : -1
    return sign * cmp(a, b) || a.firstStart.localeCompare(b.firstStart) || compareNumbers(a.number, b.number)
  })
}

// ---- URL query ---------------------------------------------------------------------------------

const CLASSES: readonly CategoryClass[] = ['LS', 'LA', 'LP', 'ES']
const SORT_KEYS: readonly SortKey[] = [
  'number',
  'title',
  'category',
  'time',
  'duration',
  'location',
  'responsibles',
  'progress',
  'findings',
  'documents',
]
const QUERY_KEYS = ['q', 'klasse', 'tag', 'befunde', 'ohneVerantw', 'sort', 'dir']

export interface ListState extends RowFilter {
  sort: SortKey
  dir: 'asc' | 'desc'
}

type Query = Record<string, string | null | (string | null)[] | undefined>

export function stateFromQuery(query: Query): ListState {
  const str = (k: string) => (typeof query[k] === 'string' ? (query[k] as string) : '')
  return {
    q: str('q'),
    categoryClass: CLASSES.find((c) => c === str('klasse')) ?? null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(str('tag')) ? str('tag') : null,
    onlyFindings: str('befunde') === '1',
    noResponsible: str('ohneVerantw') === '1',
    sort: SORT_KEYS.find((k) => k === str('sort')) ?? 'time',
    dir: str('dir') === 'desc' ? 'desc' : 'asc',
  }
}

/** Only non-default values appear in the URL; other query keys in `base` are kept. */
export function stateToQuery(s: ListState, base: Query = {}): Query {
  const out: Query = { ...base }
  for (const k of QUERY_KEYS) delete out[k]
  if (s.q.trim()) out.q = s.q.trim()
  if (s.categoryClass) out.klasse = s.categoryClass
  if (s.date) out.tag = s.date
  if (s.onlyFindings) out.befunde = '1'
  if (s.noResponsible) out.ohneVerantw = '1'
  if (s.sort !== 'time') out.sort = s.sort
  if (s.dir !== 'asc') out.dir = s.dir
  return out
}
