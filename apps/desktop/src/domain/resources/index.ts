/**
 * Hilfsmittel (ADR 0013): pure helpers. Framework-free, no Dexie.
 */
import type { EditOrigin, ResourceHistoryEntry, ResourceRecord, SourceRecord, SourceWeight } from '../types'
import { bundledSourceRecords } from '../rules/packs/registry'

/** Fields of a resource the coach (or MCP/AI) may change. `key` and `origin` are fixed. */
export type ResourcePatch = Partial<
  Pick<
    ResourceRecord,
    'title' | 'publisher' | 'edition' | 'date' | 'url' | 'weight' | 'notes' | 'summary' | 'checkedOn' | 'content' | 'fileName' | 'contentHash' | 'pageConvention'
  >
>

/** Input for a new custom resource. */
export interface NewResourceInput extends ResourcePatch {
  key: string
  title: string
}

/** One search hit (list + MCP `search_resources`). `snippet` is plain text, max ~300 chars. */
export interface ResourceHit {
  key: string
  title: string
  url: string | null
  snippet: string
  /** Higher = better. */
  score: number
  /** Where the match is: metadata (title/summary/notes), attached content, or a rule that cites the resource. */
  in: 'meta' | 'content' | 'citation'
}

/** A rule that cites a resource (UI only; MCP search does not pass these). `page` is the cited page/section. */
export interface ResourceCitation {
  id: string
  title: string
  description?: string
  page?: string
}

export interface SearchOptions {
  limit?: number
  /** Citing rules per resource key: resources without a direct hit still match through them. */
  citations?: ReadonlyMap<string, readonly ResourceCitation[]>
  /** Snippet text of a citation hit (German text comes from the UI). Default: «{id} {title}». */
  citationSnippet?: (c: ResourceCitation) => string
}

export const RESOURCE_WEIGHTS: SourceWeight[] = ['binding', 'binding-quote', 'didactic', 'outdated', 'pbs', 'info']
export const HISTORY_MAX = 10
const KEY_RE = /^[A-Z0-9][A-Z0-9-]*$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CONVENTIONS = ['printed', 'section', 'slide']

/** List order of the Hilfsmittel view: binding first, outdated last. */
const WEIGHT_ORDER: Record<SourceWeight, number> = { binding: 0, 'binding-quote': 1, pbs: 2, didactic: 3, info: 4, outdated: 5 }

/** Sorts resources by weight (binding, binding-quote, pbs, didactic, info, outdated), then by title. */
export function sortResourcesByWeight<T extends Pick<ResourceRecord, 'weight' | 'title'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => WEIGHT_ORDER[a.weight] - WEIGHT_ORDER[b.weight] || a.title.localeCompare(b.title, 'de'))
}

/** Bundled defaults: every sources.yaml entry as a ResourceRecord (origin 'bundled', modified false). */
export function bundledResources(now: string = new Date().toISOString()): ResourceRecord[] {
  return bundledSourceRecords().map((s) => ({ ...s, origin: 'bundled' as const, modified: false, updatedAt: now, updatedBy: 'manual' as const }))
}

const METADATA_KEYS = ['title', 'publisher', 'docId', 'edition', 'date', 'url', 'shortUrl', 'file', 'weight', 'pageConvention', 'partlyRead', 'notes', 'formerKeys', 'checkedOn'] as const

/** Only the SourceRecord fields of a resource (no content/history/flags). */
export function toSourceRecord(r: SourceRecord): SourceRecord {
  const out: Record<string, unknown> = { key: r.key }
  for (const k of METADATA_KEYS) {
    const v = (r as unknown as Record<string, unknown>)[k]
    if (v !== undefined) out[k] = v
  }
  return out as unknown as SourceRecord
}

const OPTIONAL_TEXT: string[] = ['publisher', 'date', 'summary', 'notes', 'checkedOn', 'content', 'fileName', 'contentHash']

/** Applies a patch, pushes the previous metadata to `history` (max 10), sets modified/updatedAt/updatedBy. */
export function applyResourcePatch(rec: ResourceRecord, patch: ResourcePatch, origin: EditOrigin, now: string): ResourceRecord {
  const { history: _h, content: _c, ...meta } = rec
  const entry: ResourceHistoryEntry = { ...meta, replacedAt: now }
  const next: ResourceRecord = { ...rec }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    const o = next as unknown as Record<string, unknown>
    // '' clears an optional field; url '' means «no link».
    if (v === '' && k === 'url') o[k] = null
    else if (v === '' && OPTIONAL_TEXT.includes(k)) delete o[k]
    else o[k] = v
  }
  next.modified = true
  next.updatedAt = now
  next.updatedBy = origin
  next.history = [entry, ...(rec.history ?? [])].slice(0, HISTORY_MAX)
  return next
}

/** Validation errors (German) for a patch / new resource; [] = ok. URL must be http(s), key /^[A-Z0-9][A-Z0-9-]*$/. */
export function validateResource(rec: Partial<ResourceRecord>): string[] {
  const errors: string[] = []
  if (rec.key !== undefined && !KEY_RE.test(rec.key)) errors.push('Schlüssel: nur Grossbuchstaben, Ziffern und Bindestriche (z. B. MEIN-DOK).')
  if (rec.title !== undefined && !rec.title.trim()) errors.push('Titel darf nicht leer sein.')
  if (rec.url !== undefined && rec.url !== null && rec.url !== '' && !/^https?:\/\/\S+$/i.test(rec.url)) errors.push('Link muss mit http:// oder https:// beginnen.')
  if (rec.weight !== undefined && !RESOURCE_WEIGHTS.includes(rec.weight)) errors.push('Gewichtung ungültig.')
  if (rec.pageConvention !== undefined && !CONVENTIONS.includes(rec.pageConvention)) errors.push('Seitenkonvention ungültig.')
  for (const f of ['date', 'checkedOn'] as const) {
    const v = rec[f]
    if (v !== undefined && v !== '' && !ISO_DATE_RE.test(v)) errors.push(`${f === 'date' ? 'Datum' : 'Zuletzt geprüft'} muss das Format JJJJ-MM-TT haben.`)
  }
  return errors
}

/** Effective registry records: bundled sources overlaid by stored resources (stored wins; custom added). */
export function mergeRegistry(bundled: readonly SourceRecord[], stored: readonly ResourceRecord[]): SourceRecord[] {
  const storedByKey = new Map(stored.map((r) => [r.key, r]))
  const out: SourceRecord[] = []
  const seen = new Set<string>()
  for (const b of bundled) {
    const s = storedByKey.get(b.key)
    seen.add(b.key)
    if (!s) {
      out.push(b)
      continue
    }
    const rec = toSourceRecord(s)
    if (!rec.formerKeys && b.formerKeys) rec.formerKeys = b.formerKeys
    out.push(rec)
  }
  for (const s of stored) if (!seen.has(s.key)) out.push(toSourceRecord(s))
  return out
}

// ---- search ----------------------------------------------------------------------------------

/** Lower-case + strip diacritics, one output char per input char (indexes stay aligned with the original). */
export function normalizeText(s: string): string {
  let out = ''
  for (const ch of s) {
    const base = ch.normalize('NFD')[0] ?? ch
    const lower = base.toLowerCase()
    out += lower.length === ch.length ? lower : ch
  }
  return out
}

const SNIPPET_LEN = 300

function snippetAround(text: string, norm: string, words: string[]): string {
  let at = -1
  for (const w of words) {
    const i = norm.indexOf(w)
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  if (at < 0) return text.slice(0, SNIPPET_LEN).replace(/\s+/g, ' ').trim()
  const start = Math.max(0, at - 80)
  const end = Math.min(text.length, start + SNIPPET_LEN)
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '… ' : ''}${body}${end < text.length ? ' …' : ''}`
}

/** Full-text search over title, summary, notes, edition and content. Words AND-ed, umlaut/case-insensitive. */
export function searchResources(records: readonly ResourceRecord[], query: string, opts?: SearchOptions): ResourceHit[] {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const hits: ResourceHit[] = []
  for (const r of records) {
    const title = normalizeText(r.title)
    const key = normalizeText(r.key)
    const summary = normalizeText(r.summary ?? '')
    const notes = normalizeText(r.notes ?? '')
    const rest = normalizeText(`${r.edition} ${r.publisher ?? ''}`)
    const content = normalizeText(r.content ?? '')
    const meta = `${key}\n${title}\n${summary}\n${notes}\n${rest}`
    const inMeta = words.every((w) => meta.includes(w))
    const inAll = inMeta || words.every((w) => `${meta}\n${content}`.includes(w))
    if (!inAll) {
      const cite = opts?.citations?.get(r.key)?.find((c) => {
        const hay = normalizeText(`${c.id} ${c.title} ${c.description ?? ''} ${c.page ?? ''}`)
        return words.every((w) => hay.includes(w))
      })
      if (cite) {
        const snippet = opts?.citationSnippet ? opts.citationSnippet(cite) : `${cite.id} ${cite.title}`
        hits.push({ key: r.key, title: r.title, url: r.url, snippet, score: 0, in: 'citation' })
      }
      continue
    }
    let score = 0
    for (const w of words) {
      if (title.includes(w)) score += 100
      if (key === w) score += 50
      if (summary.includes(w)) score += 40
      if (notes.includes(w) || rest.includes(w)) score += 20
      if (content.includes(w)) {
        let n = 0
        for (let i = content.indexOf(w); i >= 0 && n < 20; i = content.indexOf(w, i + w.length)) n++
        score += Math.min(n, 20)
      }
    }
    let snippet: string
    let where: 'meta' | 'content'
    if (inMeta) {
      where = 'meta'
      // Title first when it carries every word; the notes (maintainer remarks) only as a last resort.
      const src = words.every((w) => title.includes(w))
        ? r.title
        : words.some((w) => summary.includes(w))
          ? r.summary!
          : words.some((w) => notes.includes(w))
            ? r.notes!
            : r.title
      snippet = snippetAround(src, normalizeText(src), words)
    } else {
      where = 'content'
      snippet = snippetAround(r.content ?? '', content, words)
    }
    hits.push({ key: r.key, title: r.title, url: r.url, snippet, score, in: where })
  }
  const tier = { meta: 0, content: 1, citation: 2 } as const
  hits.sort((a, b) => (a.in === b.in ? b.score - a.score : tier[a.in] - tier[b.in]) || a.key.localeCompare(b.key))
  return opts?.limit ? hits.slice(0, opts.limit) : hits
}

/** Splits `text` into plain / highlighted segments for the search words (umlaut/case-insensitive, no HTML). */
export function highlightSegments(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  if (!words.length || !text) return [{ text, hit: false }]
  const norm = normalizeText(text)
  const marks = new Array<boolean>(text.length).fill(false)
  for (const w of words) for (let i = norm.indexOf(w); i >= 0; i = norm.indexOf(w, i + w.length)) for (let j = i; j < i + w.length; j++) marks[j] = true
  const out: Array<{ text: string; hit: boolean }> = []
  let start = 0
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || marks[i] !== marks[start]) {
      out.push({ text: text.slice(start, i), hit: marks[start]! })
      start = i
    }
  }
  return out.filter((s) => s.text)
}

/** Word count of an extracted text. */
export function wordCount(text: string | undefined): number {
  return text ? text.split(/\s+/).filter(Boolean).length : 0
}

/** Parses TT.MM.JJJJ or JJJJ-MM-TT to ISO (JJJJ-MM-TT); '' for empty input; null when invalid. */
export function parseDateInput(text: string): string | null {
  const v = text.trim()
  if (!v) return ''
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v)
  const iso = de ? `${de[3]}-${de[2]!.padStart(2, '0')}-${de[1]!.padStart(2, '0')}` : v
  if (!ISO_DATE_RE.test(iso)) return null
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso
}

/** ISO date (JJJJ-MM-TT, time part ignored) as TT.MM.JJJJ; '' for empty, unchanged when not ISO. */
export function formatDateDe(iso: string | undefined | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}
