/**
 * Bundled rule packs. OWNER: rules builder. See ./basis/README.md for the YAML + TS format.
 *
 * YAML is loaded at build time via import.meta.glob (works in vite and vitest alike) and parsed
 * with the 'yaml' package. Predicates are registered per pack directory in PREDICATES below.
 */
import { parse } from 'yaml'
import type { RuleMeta, RulePack, RulePredicate } from '../../types'
import { validateRuleMeta } from '../engine'
import { predicates as basisPredicates } from './basis/predicates'

/** Pack directory name -> predicate registry. Add new packs here. */
const PREDICATES: Record<string, Record<string, RulePredicate>> = {
  basis: basisPredicates,
}

const ruleFiles = import.meta.glob('./*/rules/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const packFiles = import.meta.glob('./*/pack.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

function dateString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

/** Parses one rule YAML document into RuleMeta (validated). Throws with all validation errors. */
export function parseRuleYaml(text: string): RuleMeta {
  const raw = parse(text) as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object') throw new Error('Regel-YAML ist leer oder ungültig')
  const source = (raw.source ?? {}) as { title?: string; url?: string }
  const meta = {
    ...raw,
    version: String(raw.version ?? ''),
    validFrom: dateString(raw.validFrom),
    validTo: dateString(raw.validTo),
    source: { title: String(source.title ?? ''), url: String(source.url ?? '') },
  } as unknown as RuleMeta
  if (meta.validFrom === undefined) delete meta.validFrom
  if (meta.validTo === undefined) delete meta.validTo
  const errors = validateRuleMeta(meta)
  if (errors.length) throw new Error(errors.join('; '))
  return meta
}

/** Combines YAML metas with predicates by rule id; throws if either side is missing. */
export function assemblePack(
  packMeta: Omit<RulePack, 'rules'>,
  metas: RuleMeta[],
  predicates: Record<string, RulePredicate>,
): RulePack {
  const ids = new Set<string>()
  for (const m of metas) {
    if (ids.has(m.id)) throw new Error(`Doppelte Regel-ID: ${m.id}`)
    ids.add(m.id)
    if (!predicates[m.id]) throw new Error(`Regel ${m.id} hat kein Prädikat`)
  }
  for (const id of Object.keys(predicates)) {
    if (!ids.has(id)) throw new Error(`Prädikat ${id} hat keine YAML-Metadaten`)
  }
  const rules = metas
    .map((meta) => ({ meta, check: predicates[meta.id] }))
    .sort((a, b) => (a.meta.id < b.meta.id ? -1 : a.meta.id > b.meta.id ? 1 : 0))
  return { ...packMeta, rules }
}

let cache: RulePack[] | null = null

/** All bundled packs (currently "co-co Basis 2026.1"). Throws on invalid YAML or a missing predicate. */
export function loadBundledPacks(): RulePack[] {
  if (cache) return cache
  const packs: RulePack[] = []
  for (const [path, text] of Object.entries(packFiles).sort(([a], [b]) => a.localeCompare(b))) {
    const dir = /^\.\/([^/]+)\//.exec(path)?.[1]
    if (!dir) continue
    const registry = PREDICATES[dir]
    if (!registry) throw new Error(`Kein Prädikat-Register für Pack «${dir}»`)
    const raw = parse(text) as Record<string, unknown>
    const metas = Object.entries(ruleFiles)
      .filter(([p]) => p.startsWith(`./${dir}/rules/`))
      .map(([, t]) => parseRuleYaml(t))
    packs.push(
      assemblePack(
        {
          id: String(raw.id),
          name: String(raw.name),
          version: String(raw.version),
          description: String(raw.description ?? ''),
          validFrom: dateString(raw.validFrom),
          validTo: dateString(raw.validTo),
        },
        metas,
        registry,
      ),
    )
  }
  cache = packs
  return packs
}
