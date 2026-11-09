/**
 * Source registry. Bundled = packs/sources.yaml (loaded once at build time); the effective registry
 * overlays the coach's Hilfsmittel (domain/resources, ADR 0013) via setRegistryOverlay().
 */
import { parse } from 'yaml'
import { createSourceRegistry, parseSourcesYaml, type SourceRegistry } from '../lib/sources'
import type { SourceRecord } from '../../types'

const files = import.meta.glob('./sources.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

let bundled: SourceRecord[] | null = null
let bundledRegistry: SourceRegistry | null = null
let overlayRegistry: SourceRegistry | null = null

/** The records of the bundled sources.yaml (fresh copies, safe to modify). */
export function bundledSourceRecords(): SourceRecord[] {
  if (!bundled) {
    const text = files['./sources.yaml']
    if (!text) throw new Error('packs/sources.yaml fehlt')
    bundled = parseSourcesYaml(parse(text))
  }
  return bundled.map((r) => ({ ...r, partlyRead: [...r.partlyRead], ...(r.formerKeys ? { formerKeys: [...r.formerKeys] } : {}) }))
}

/** Replaces the effective registry (stored Hilfsmittel merged over the bundled ones); null = bundled only. */
export function setRegistryOverlay(records: SourceRecord[] | null): void {
  overlayRegistry = records ? createSourceRegistry(records) : null
}

/** Effective registry (sync): overlay if set, else the bundled one. */
export function getSourceRegistry(): SourceRegistry {
  if (overlayRegistry) return overlayRegistry
  if (!bundledRegistry) bundledRegistry = createSourceRegistry(bundledSourceRecords())
  return bundledRegistry
}
