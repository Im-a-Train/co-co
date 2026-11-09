/**
 * Source registry (packs/sources.yaml, catalog v2 §1). Pure.
 * Rules, params and keyword sets cite sources as `{ key, page, quote?, binding? }`; the key must exist in
 * the registry (old keys L / C / LT resolve through `formerKeys`).
 */
import type { ResolvedSource, Source, SourceRecord, SourceRef, SourceWeight } from '../../types'

const WEIGHTS: SourceWeight[] = ['binding', 'binding-quote', 'didactic', 'outdated', 'pbs', 'info']
const CONVENTIONS = ['printed', 'section', 'slide'] as const

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : v instanceof Date ? v.toISOString().slice(0, 10) : String(v))

export function parseSourcesYaml(raw: unknown): SourceRecord[] {
  if (!Array.isArray(raw)) throw new Error('sources.yaml: Liste erwartet')
  const errors: string[] = []
  const out: SourceRecord[] = []
  const keys = new Set<string>()
  for (const r of raw) {
    if (!isRecord(r)) {
      errors.push('sources.yaml: Eintrag ist kein Objekt')
      continue
    }
    const key = String(r.key ?? '')
    const err = (m: string) => errors.push(`sources.yaml ${key || '?'}: ${m}`)
    if (!key) err('key fehlt')
    if (keys.has(key)) err('doppelter key')
    keys.add(key)
    if (typeof r.title !== 'string' || !r.title.trim()) err('title fehlt')
    const weight = r.weight as SourceWeight
    if (!WEIGHTS.includes(weight)) err(`weight ungültig (${String(r.weight)})`)
    const pageConvention = (r.pageConvention ?? 'section') as SourceRecord['pageConvention']
    if (!CONVENTIONS.includes(pageConvention)) err('pageConvention ungültig')
    const url = str(r.url) ?? null
    if (url !== null && !/^https?:\/\//.test(url)) err('url ist keine http(s)-Adresse')
    out.push({
      key,
      title: String(r.title ?? ''),
      ...(str(r.publisher) ? { publisher: str(r.publisher) } : {}),
      ...(str(r.docId) ? { docId: str(r.docId) } : {}),
      edition: str(r.edition) ?? '',
      ...(str(r.date) ? { date: str(r.date) } : {}),
      url,
      ...(str(r.shortUrl) ? { shortUrl: str(r.shortUrl) } : {}),
      ...(str(r.file) ? { file: str(r.file) } : {}),
      weight,
      pageConvention,
      partlyRead: Array.isArray(r.partlyRead) ? r.partlyRead.map(String) : [],
      ...(str(r.notes) ? { notes: str(r.notes) } : {}),
      ...(Array.isArray(r.formerKeys) ? { formerKeys: r.formerKeys.map(String) } : {}),
      ...(str(r.checkedOn) ? { checkedOn: str(r.checkedOn) } : {}),
    })
  }
  for (const s of out) for (const fk of s.formerKeys ?? []) if (keys.has(fk)) errors.push(`sources.yaml ${s.key}: formerKey ${fk} ist ein aktiver key`)
  if (errors.length) throw new Error(errors.join('; '))
  return out
}

/** Parses a `sources:` list ({key, page?, quote?, binding?}); undefined/null → []. */
export function parseSourceRefs(raw: unknown, where: string): SourceRef[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new Error(`${where}: sources muss eine Liste sein`)
  return raw.map((r) => {
    if (!isRecord(r) || typeof r.key !== 'string' || !r.key) throw new Error(`${where}: Quelle ohne key`)
    return {
      key: r.key,
      page: str(r.page) ?? '',
      ...(typeof r.quote === 'string' ? { quote: r.quote } : {}),
      ...(typeof r.binding === 'boolean' ? { binding: r.binding } : {}),
    }
  })
}

export interface SourceRegistry {
  records: SourceRecord[]
  /** Record by key or former key. */
  get(key: string): SourceRecord | undefined
  /** Record whose url (or shortUrl) equals `url` (legacy `source: {title,url}`). */
  byUrl(url: string): SourceRecord | undefined
  resolve(ref: SourceRef): ResolvedSource | null
}

export function createSourceRegistry(records: SourceRecord[]): SourceRegistry {
  const byKey = new Map<string, SourceRecord>()
  for (const r of records) {
    byKey.set(r.key, r)
    for (const fk of r.formerKeys ?? []) byKey.set(fk, r)
  }
  const norm = (u: string) => u.replace(/\/+$/, '')
  return {
    records,
    get: (key) => byKey.get(key),
    byUrl: (url) => records.find((r) => (r.url && norm(r.url) === norm(url)) || (r.shortUrl && norm(r.shortUrl) === norm(url))),
    resolve(ref) {
      const r = byKey.get(ref.key)
      if (!r) return null
      return {
        ...ref,
        key: r.key,
        binding: ref.binding ?? (r.weight === 'binding' || r.weight === 'binding-quote'),
        title: r.title,
        url: r.url,
        edition: r.edition,
        weight: r.weight,
      }
    },
  }
}

/** Legacy {title,url} of the first resolved source with a URL (Finding.source / RuleMeta.source). */
export function primarySource(resolved: readonly (ResolvedSource | null)[]): Source {
  const withUrl = resolved.find((r): r is ResolvedSource => !!r && !!r.url)
  if (withUrl) return { title: withUrl.title, url: withUrl.url! }
  const any = resolved.find((r): r is ResolvedSource => !!r)
  return { title: any?.title ?? '', url: '' }
}
