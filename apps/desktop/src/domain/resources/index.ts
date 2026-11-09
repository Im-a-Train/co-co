/**
 * Hilfsmittel (ADR 0013): pure helpers. Framework-free, no Dexie.
 * CONTRACT (main session): keep the exported signatures; implementation by the resources agent.
 */
import type { EditOrigin, ResourceRecord, SourceRecord } from '../types'

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

/** Bundled defaults: every sources.yaml entry as a ResourceRecord (origin 'bundled', modified false). */
export function bundledResources(_now?: string): ResourceRecord[] {
  throw new Error('not implemented')
}

/** Applies a patch, pushes the previous metadata to `history` (max 10), sets modified/updatedAt/updatedBy. */
export function applyResourcePatch(_rec: ResourceRecord, _patch: ResourcePatch, _origin: EditOrigin, _now: string): ResourceRecord {
  throw new Error('not implemented')
}

/** Validation errors (German) for a patch / new resource; [] = ok. URL must be http(s), key /^[A-Z0-9][A-Z0-9-]*$/. */
export function validateResource(_rec: Partial<ResourceRecord>): string[] {
  throw new Error('not implemented')
}

/** Effective registry records: bundled sources overlaid by stored resources (stored wins; custom added). */
export function mergeRegistry(_bundled: readonly SourceRecord[], _stored: readonly ResourceRecord[]): SourceRecord[] {
  throw new Error('not implemented')
}

/** Full-text search over title, summary, notes, edition and content. Words AND-ed, umlaut/case-insensitive. */
export function searchResources(_records: readonly ResourceRecord[], _query: string, _opts?: { limit?: number }): ResourceHit[] {
  throw new Error('not implemented')
}
