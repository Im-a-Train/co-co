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
  /** Where the match is: metadata (title/summary/notes) or attached content. */
  in: 'meta' | 'content'
}

export const RESOURCE_WEIGHTS: SourceWeight[] = ['binding', 'binding-quote', 'didactic', 'outdated', 'pbs', 'info']
export const HISTORY_MAX = 10
const KEY_RE = /^[A-Z0-9][A-Z0-9-]*$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CONVENTIONS = ['printed', 'section', 'slide']

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
export function searchResources(records: readonly ResourceRecord[], query: string, opts?: { limit?: number }): ResourceHit[] {
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
    if (!inAll) continue
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
      const src = words.some((w) => summary.includes(w)) ? r.summary! : words.some((w) => notes.includes(w)) ? r.notes! : r.title
      snippet = snippetAround(src, normalizeText(src), words)
    } else {
      where = 'content'
      snippet = snippetAround(r.content ?? '', content, words)
    }
    hits.push({ key: r.key, title: r.title, url: r.url, snippet, score, in: where })
  }
  hits.sort((a, b) => (a.in === b.in ? b.score - a.score : a.in === 'meta' ? -1 : 1) || a.key.localeCompare(b.key))
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
