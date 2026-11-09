/**
 * Bundled rule packs (catalog v2 §3). Format: docs/plans/rules-v2/infra-api.md.
 *
 * YAML is loaded at build time via import.meta.glob (works in vite and vitest alike) and parsed with the
 * 'yaml' package: `sources.yaml` (registry), per pack folder `pack.yaml`, `params.yaml`, `keywords/*.yaml`
 * and `rules/*.yaml`. Predicates are registered per pack folder in PREDICATES below.
 *
 * Loader validations: rule schema (engine.validateRuleMeta, incl. must ⇒ verified), module exists in the
 * pack, rule ids and formerIds globally unique (a formerId never equals a live id), every source key /
 * param / keyword set resolves, param rows contiguous, keyword set ids and param keys globally unique,
 * pack.yaml trigger keys known.
 */
import { parse } from 'yaml'
import type {
  KeywordSetDef,
  ModuleAppliesWhen,
  ModuleDef,
  ModuleId,
  ModuleTrigger,
  ParamDef,
  RuleMeta,
  RulePack,
  RulePredicate,
  SourceRef,
} from '../../types'
import { MODULE_IDS } from '../../types'
import { validateRuleMeta } from '../engine'
import { compileKeywordSets } from '../lib/keywords'
import { TRIGGER_AND_KEYS, TRIGGER_KEYS, TRIGGER_MODIFIERS } from '../lib/moduleState'
import { dateString, parseParamDefs } from '../lib/params'
import { parseSourceRefs, primarySource, type SourceRegistry } from '../lib/sources'
import { predicates as jslstPredicates } from './jslst/predicates'
import { predicates as pbsPredicates } from './pbs/predicates'
import { getSourceRegistry } from './registry'

/** Pack directory name -> predicate registry. Add new packs here. */
const PREDICATES: Record<string, Record<string, RulePredicate>> = {
  jslst: jslstPredicates,
  pbs: pbsPredicates,
}

const ruleFiles = import.meta.glob('./*/rules/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const packFiles = import.meta.glob('./*/pack.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const paramFiles = import.meta.glob('./*/params.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const keywordFiles = import.meta.glob(['./*/keywords/*.yaml', '!./*/keywords/docCheck.yaml'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const strList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : undefined)

/**
 * Parses one rule YAML document into RuleMeta (validated). Throws with all validation errors.
 * The legacy `source: {title, url}` is converted to `sources: [{key, page: ''}]` by URL.
 */
export function parseRuleYaml(text: string, registry: SourceRegistry = getSourceRegistry()): RuleMeta {
  const raw = parse(text) as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object') throw new Error('Regel-YAML ist leer oder ungültig')
  const id = String(raw.id ?? '?')
  let sources: SourceRef[] = parseSourceRefs(raw.sources, id)
  if (sources.length === 0 && isRecord(raw.source)) {
    const url = String(raw.source.url ?? '')
    const rec = registry.byUrl(url)
    if (!rec) throw new Error(`${id}: source ${url} ist nicht in sources.yaml`)
    sources = [{ key: rec.key, page: '' }]
  }
  const module = String(raw.module ?? '') as ModuleId
  const meta = {
    ...raw,
    id,
    version: String(raw.version ?? ''),
    module,
    group: module,
    status: raw.status ?? 'active',
    kind: raw.kind ?? 'hard',
    validFrom: dateString(raw.validFrom),
    validTo: dateString(raw.validTo),
    sources,
    source: primarySource(sources.map((s) => registry.resolve(s))),
    ...(strList(raw.params) ? { params: strList(raw.params) } : {}),
    ...(strList(raw.keywords) ? { keywords: strList(raw.keywords) } : {}),
    ...(strList(raw.formerIds) ? { formerIds: strList(raw.formerIds) } : {}),
  } as unknown as RuleMeta & { group?: unknown }
  if (meta.validFrom === undefined) delete meta.validFrom
  if (meta.validTo === undefined) delete meta.validTo
  const errors = validateRuleMeta(meta)
  for (const s of sources) if (!registry.get(s.key)) errors.push(`${id}: Quelle ${s.key} ist nicht in sources.yaml`)
  if (errors.length) throw new Error(errors.join('; '))
  return meta
}

function parseTrigger(raw: unknown, where: string): ModuleTrigger {
  if (!isRecord(raw)) throw new Error(`${where}: Auslöser muss ein Objekt sein`)
  const keys = Object.keys(raw)
  const main = keys.filter((k) => (TRIGGER_KEYS as readonly string[]).includes(k))
  const unknown = keys.filter((k) => !(TRIGGER_KEYS as readonly string[]).includes(k) && !(TRIGGER_MODIFIERS as readonly string[]).includes(k))
  if (unknown.length) throw new Error(`${where}: unbekannter Auslöser ${unknown.join(', ')}`)
  const andOk = main.length === 2 && main.every((k) => TRIGGER_AND_KEYS.includes(k))
  if (main.length !== 1 && !andOk) {
    throw new Error(`${where}: genau ein Auslöser pro Eintrag erwartet (${keys.join(', ')}); nur ${TRIGGER_AND_KEYS.join(' + ')} sind kombinierbar`)
  }
  return raw as ModuleTrigger
}

const APPLIES_KEYS = ['jsCamp', 'sport', 'organizer', 'module']

/** Parses pack.yaml (metadata + modules). */
export function parsePackYaml(text: string, where = 'pack.yaml'): Omit<RulePack, 'rules'> {
  const raw = parse(text) as Record<string, unknown> | null
  if (!raw || !isRecord(raw)) throw new Error(`${where}: leer oder ungültig`)
  const modules: ModuleDef[] = []
  for (const m of Array.isArray(raw.modules) ? raw.modules : []) {
    if (!isRecord(m)) throw new Error(`${where}: Modul ist kein Objekt`)
    const id = String(m.id ?? '') as ModuleId
    const w = `${where} Modul ${id}`
    if (!(MODULE_IDS as readonly string[]).includes(id)) throw new Error(`${w}: id ungültig`)
    const applies = (m.appliesWhen ?? {}) as Record<string, unknown>
    if (!isRecord(applies)) throw new Error(`${w}: appliesWhen muss ein Objekt sein`)
    const badApplies = Object.keys(applies).filter((k) => !APPLIES_KEYS.includes(k))
    if (badApplies.length) throw new Error(`${w}: unbekannter appliesWhen-Schlüssel ${badApplies.join(', ')}`)
    const def = String(m.default ?? 'on')
    if (def !== 'on' && def !== 'auto') throw new Error(`${w}: default muss on oder auto sein`)
    modules.push({
      id,
      title: String(m.title ?? ''),
      description: String(m.description ?? ''),
      appliesWhen: applies as ModuleAppliesWhen,
      default: def,
      toggleable: m.toggleable !== false,
      suggestWhen: (Array.isArray(m.suggestWhen) ? m.suggestWhen : []).map((t, i) => parseTrigger(t, `${w} suggestWhen[${i}]`)),
      onWhen: (Array.isArray(m.onWhen) ? m.onWhen : []).map((t, i) => parseTrigger(t, `${w} onWhen[${i}]`)),
    })
    if (!modules[modules.length - 1].title) throw new Error(`${w}: title fehlt`)
  }
  return {
    id: String(raw.id),
    name: String(raw.name),
    version: String(raw.version),
    description: String(raw.description ?? ''),
    validFrom: dateString(raw.validFrom),
    validTo: dateString(raw.validTo),
    ...(strList(raw.aliases) ? { aliases: strList(raw.aliases) } : {}),
    modules,
  }
}

/** Parses one keywords/*.yaml document (a list of sets). */
export function parseKeywordYaml(text: string, where: string): KeywordSetDef[] {
  const raw = parse(text) as unknown
  if (!Array.isArray(raw)) throw new Error(`${where}: Liste von Stichwortlisten erwartet`)
  return raw.map((r) => {
    if (!isRecord(r) || typeof r.id !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(r.id)) throw new Error(`${where}: Stichwortliste ohne gültige id`)
    if (!Array.isArray(r.include)) throw new Error(`${where} ${r.id}: include fehlt`)
    return {
      id: r.id,
      ...(typeof r.module === 'string' ? { module: r.module } : {}),
      ...(typeof r.description === 'string' ? { description: r.description } : {}),
      ...(strList(r.extends) ? { extends: strList(r.extends) } : {}),
      include: r.include as KeywordSetDef['include'],
      exclude: (Array.isArray(r.exclude) ? r.exclude : []) as KeywordSetDef['include'],
      sources: parseSourceRefs(r.sources, `${where} ${r.id}`),
    }
  })
}

/** Combines YAML metas with predicates by rule id; throws if either side is missing. */
export function assemblePack(
  packMeta: Omit<RulePack, 'rules'>,
  metas: RuleMeta[],
  predicates: Record<string, RulePredicate>,
): RulePack {
  const ids = new Set<string>()
  const moduleIds = packMeta.modules ? new Set(packMeta.modules.map((m) => m.id)) : null
  for (const m of metas) {
    if (ids.has(m.id)) throw new Error(`Doppelte Regel-ID: ${m.id}`)
    ids.add(m.id)
    if (!predicates[m.id]) throw new Error(`Regel ${m.id} hat kein Prädikat`)
    if (moduleIds && !moduleIds.has(m.module)) throw new Error(`Regel ${m.id}: Modul ${m.module} gibt es im Pack ${packMeta.id} nicht`)
  }
  for (const id of Object.keys(predicates)) {
    if (!ids.has(id)) throw new Error(`Prädikat ${id} hat keine YAML-Metadaten`)
  }
  const rules = metas
    .map((meta) => ({ meta, check: predicates[meta.id] }))
    .sort((a, b) => (a.meta.id < b.meta.id ? -1 : a.meta.id > b.meta.id ? 1 : 0))
  return { ...packMeta, rules }
}

/** Cross-pack checks (§3.3). Returns all errors (empty = valid). */
export function validateBundle(packs: readonly RulePack[], registry: SourceRegistry = getSourceRegistry()): string[] {
  const errors: string[] = []
  const ruleIds = new Map<string, string>()
  for (const p of packs)
    for (const r of p.rules) {
      if (ruleIds.has(r.meta.id)) errors.push(`Regel-ID ${r.meta.id} doppelt (${ruleIds.get(r.meta.id)}, ${p.id})`)
      ruleIds.set(r.meta.id, p.id)
    }
  const former = new Set<string>()
  for (const p of packs)
    for (const r of p.rules)
      for (const f of r.meta.formerIds ?? []) {
        if (ruleIds.has(f)) errors.push(`${r.meta.id}: formerId ${f} ist eine aktive Regel-ID`)
        if (former.has(f)) errors.push(`${r.meta.id}: formerId ${f} doppelt`)
        former.add(f)
      }
  const paramKeys = new Set<string>()
  for (const d of packs.flatMap((p) => p.params ?? [])) {
    if (paramKeys.has(d.key)) errors.push(`Parameter ${d.key} doppelt`)
    paramKeys.add(d.key)
    for (const s of d.sources) if (!registry.get(s.key)) errors.push(`Parameter ${d.key}: Quelle ${s.key} unbekannt`)
  }
  const setDefs = packs.flatMap((p) => p.keywordSets ?? [])
  try {
    compileKeywordSets(setDefs)
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }
  const setIds = new Set(setDefs.map((d) => d.id))
  for (const d of setDefs) for (const s of d.sources ?? []) if (!registry.get(s.key)) errors.push(`Stichwortliste ${d.id}: Quelle ${s.key} unbekannt`)
  const moduleIds = new Set<string>()
  for (const p of packs)
    for (const m of p.modules ?? []) {
      if (moduleIds.has(m.id)) errors.push(`Modul ${m.id} doppelt`)
      moduleIds.add(m.id)
    }
  for (const p of packs)
    for (const m of p.modules ?? []) {
      if (m.appliesWhen.module && !moduleIds.has(m.appliesWhen.module)) errors.push(`Modul ${m.id}: appliesWhen.module ${m.appliesWhen.module} unbekannt`)
      for (const t of [...m.suggestWhen, ...m.onWhen]) {
        if (t.keywordSet && !setIds.has(t.keywordSet)) errors.push(`Modul ${m.id}: Stichwortliste ${t.keywordSet} unbekannt`)
        for (const v of [t.gpxHighestPointAbove, t.campStartMonths])
          if (v && typeof v === 'object' && !Array.isArray(v) && !paramKeys.has(v.param)) errors.push(`Modul ${m.id}: Parameter ${v.param} unbekannt`)
      }
    }
  for (const p of packs)
    for (const { meta } of p.rules) {
      for (const k of meta.params ?? []) if (!paramKeys.has(k)) errors.push(`${meta.id}: Parameter ${k} unbekannt`)
      for (const k of meta.keywords ?? []) if (!setIds.has(k)) errors.push(`${meta.id}: Stichwortliste ${k} unbekannt`)
      for (const s of meta.sources) if (!registry.get(s.key)) errors.push(`${meta.id}: Quelle ${s.key} unbekannt`)
    }
  return errors
}

let cache: RulePack[] | null = null

/** All bundled packs, sorted by folder. Throws on invalid YAML, a missing predicate or a failed cross-check. */
export function loadBundledPacks(): RulePack[] {
  if (cache) return cache
  const registry = getSourceRegistry()
  const packs: RulePack[] = []
  for (const [path, text] of Object.entries(packFiles).sort(([a], [b]) => a.localeCompare(b))) {
    const dir = /^\.\/([^/]+)\//.exec(path)?.[1]
    if (!dir) continue
    const registryOfDir = PREDICATES[dir]
    if (!registryOfDir) throw new Error(`Kein Prädikat-Register für Pack «${dir}»`)
    const packMeta = parsePackYaml(text, `${dir}/pack.yaml`)
    const metas = Object.entries(ruleFiles)
      .filter(([p]) => p.startsWith(`./${dir}/rules/`))
      .map(([, t]) => parseRuleYaml(t, registry))
    const paramText = paramFiles[`./${dir}/params.yaml`]
    const params: ParamDef[] = paramText ? parseParamDefs(parse(paramText), `${dir}/params.yaml`) : []
    const keywordSets = Object.entries(keywordFiles)
      .filter(([p]) => p.startsWith(`./${dir}/keywords/`))
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([p, t]) => parseKeywordYaml(t, p.slice(2)))
    packs.push(assemblePack({ ...packMeta, params, keywordSets }, metas, registryOfDir))
  }
  const errors = validateBundle(packs, registry)
  if (errors.length) throw new Error(`Regelpakete ungültig: ${errors.join('; ')}`)
  cache = packs
  return packs
}

/** Packs enabled by settings.rulePacks (empty = all); old ids are matched through pack `aliases`. */
export function selectPacks(all: RulePack[], enabledIds: readonly string[]): RulePack[] {
  if (enabledIds.length === 0) return all
  return all.filter((p) => enabledIds.includes(p.id) || (p.aliases ?? []).some((a) => enabledIds.includes(a)))
}

/** All modules of the given packs, in pack order. */
export function modulesOf(packs: readonly RulePack[]): ModuleDef[] {
  return packs.flatMap((p) => p.modules ?? [])
}
