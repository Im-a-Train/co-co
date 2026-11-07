/** Turns file bytes into a DocumentRecord (extraction, checklist, GPX, links). OWNER: documents builder. */
import { extractText, parseGpx } from './extract'
import {
  checkSafetyConcept,
  detectKind,
  gpxStatsFromPoints,
  MAX_DOCUMENT_BYTES,
  resolveLinks,
  suggestActivityLinks,
  type GpxOptions,
} from './index'
import type { ActivityLinkSuggestion, CampFacts, DocumentRecord, DocumentSource, Iri } from '../types'

export interface IngestInput {
  campIri: Iri
  path: string
  name: string
  size: number
  modifiedMs: number
  bytes: Uint8Array
  source: DocumentSource
  folder: string | null
}

export interface IngestContext {
  facts: CampFacts | null
  gpx: GpxOptions
  now?: Date
  newId: () => string
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Builds the record. With `existing` and an unchanged hash the existing record is returned (path and
 * mtime refreshed). A changed hash re-extracts but keeps id, confirmed links, zone and aiAllowed.
 */
export async function ingestDocument(
  input: IngestInput,
  existing: DocumentRecord | null,
  ctx: IngestContext,
): Promise<{ record: DocumentRecord; changed: boolean }> {
  const hash = await sha256Hex(input.bytes)
  if (existing && existing.contentHash === hash) {
    return { record: { ...existing, path: input.path, modifiedMs: input.modifiedMs, size: input.size }, changed: false }
  }
  const kind = detectKind(input.name)
  let text = ''
  let extractError: string | null = null
  let gpx: DocumentRecord['gpx'] = null
  try {
    if (input.size > MAX_DOCUMENT_BYTES) throw new Error('Datei ist grösser als 25 MB')
    text = await extractText(kind, input.bytes)
    if (kind === 'gpx') {
      const parsed = parseGpx(new TextDecoder().decode(input.bytes))
      if (!parsed.points.length) throw new Error('GPX enthält keine Punkte')
      gpx = gpxStatsFromPoints(parsed.points, ctx.gpx, parsed.name)
    } else if (!text.trim()) {
      extractError = 'Kein Text gefunden (evtl. gescanntes Dokument)'
    }
  } catch (e) {
    extractError = e instanceof Error ? e.message : String(e)
  }

  const docCheck = text && kind !== 'gpx' ? checkSafetyConcept(text, ctx.facts, ctx.now) : null
  const suggestions = ctx.facts ? suggestActivityLinks({ name: input.name, text }, ctx.facts) : []
  let activityIris: Iri[]
  let linkSuggestions: ActivityLinkSuggestion[]
  if (existing && existing.activityIris.length) {
    activityIris = existing.activityIris
    linkSuggestions = suggestions.filter((s) => !activityIris.includes(s.activityIri))
  } else {
    const r = resolveLinks(suggestions)
    activityIris = r.linked
    linkSuggestions = r.open
  }

  const record: DocumentRecord = {
    id: existing?.id ?? ctx.newId(),
    campIri: input.campIri,
    path: input.path,
    name: input.name,
    kind,
    size: input.size,
    modifiedMs: input.modifiedMs,
    importedAt: existing?.importedAt ?? (ctx.now ?? new Date()).toISOString(),
    source: existing?.source ?? input.source,
    folder: input.folder,
    contentHash: hash,
    text,
    extractError,
    activityIris,
    linkSuggestions,
    docCheck,
    gpx,
    zone: existing?.zone ?? 'yellow',
    aiAllowed: existing?.aiAllowed ?? false,
    aiSummary: null,
  }
  return { record, changed: true }
}
