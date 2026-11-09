/** Bundled source registry (packs/sources.yaml), loaded once at build time. */
import { parse } from 'yaml'
import { createSourceRegistry, parseSourcesYaml, type SourceRegistry } from '../lib/sources'

const files = import.meta.glob('./sources.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

let cache: SourceRegistry | null = null

export function getSourceRegistry(): SourceRegistry {
  if (cache) return cache
  const text = files['./sources.yaml']
  if (!text) throw new Error('packs/sources.yaml fehlt')
  cache = createSourceRegistry(parseSourcesYaml(parse(text)))
  return cache
}
