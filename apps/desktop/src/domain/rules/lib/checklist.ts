/**
 * Coach checklist (catalog v2 §8): `packs/<pack>/checklist.yaml`, shown per camp in the card
 * «Coach-Checkliste»; done-state lives in `campRuleConfig.checklist`. Pure.
 *
 * Item: `{ id, module, text, sources: [{key, page}], kind, showWhen? }`.
 * `kind`: B (binding), E (recommendation), 2014 (outdated source); «2014 / B» = both.
 * `showWhen`: list of conditions (any); inside one condition all keys must hold:
 *   campConfig { field: [values] }, coachInput { field: value }, coachInputSet field,
 *   activityTag [tags] (some activity carries one of them), campInWinter true.
 * Items are shown only for modules whose effective state is `on`.
 */
import { parse } from 'yaml'
import type {
  ActivityTag,
  CampRuleConfig,
  CoachInputs,
  IsoDate,
  ModuleId,
  ModuleResolution,
  ParamValue,
  SourceRef,
} from '../../types'
import { ACTIVITY_TAGS, MODULE_IDS } from '../../types'
import { getSourceRegistry } from '../packs/registry'
import { parseSourceRefs, type SourceRegistry } from './sources'

export type ChecklistKind = 'B' | 'E' | '2014'
const KINDS: readonly ChecklistKind[] = ['B', 'E', '2014']

export interface ChecklistCondition {
  campConfig?: Record<string, ParamValue[]>
  coachInput?: Record<string, ParamValue>
  coachInputSet?: string
  activityTag?: ActivityTag[]
  campInWinter?: boolean
}

export interface ChecklistItem {
  id: string
  module: ModuleId
  text: string
  sources: SourceRef[]
  /** One kind, or two for a combined cell such as «2014 / B». */
  kinds: ChecklistKind[]
  /** Absent = always shown (when the module is on). */
  showWhen?: ChecklistCondition[]
}

const CONDITION_KEYS = ['campConfig', 'coachInput', 'coachInputSet', 'activityTag', 'campInWinter'] as const
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function parseKinds(raw: unknown): ChecklistKind[] {
  return String(raw ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean) as ChecklistKind[]
}

/** Parses one checklist.yaml document (already `yaml.parse`d). Throws with all structural errors. */
export function parseChecklist(raw: unknown, where: string): ChecklistItem[] {
  if (!Array.isArray(raw)) throw new Error(`${where}: Liste erwartet`)
  const errors: string[] = []
  const out: ChecklistItem[] = []
  for (const r of raw) {
    if (!isRecord(r)) {
      errors.push(`${where}: Eintrag ist kein Objekt`)
      continue
    }
    const id = String(r.id ?? '')
    const err = (m: string) => errors.push(`${where} ${id || '?'}: ${m}`)
    if (!/^CL-[A-Z]+-\d{2}$/.test(id)) err('id ungültig (CL-<MODUL>-NN)')
    const module = r.module as ModuleId
    if (!MODULE_IDS.includes(module)) err(`Modul ungültig (${String(r.module)})`)
    if (typeof r.text !== 'string' || !r.text.trim()) err('text fehlt')
    const kinds = parseKinds(r.kind)
    if (kinds.length === 0 || kinds.some((k) => !KINDS.includes(k))) err(`kind ungültig (${String(r.kind)})`)
    let sources: SourceRef[] = []
    try {
      sources = parseSourceRefs(r.sources, `${where} ${id}`)
    } catch (e) {
      err(e instanceof Error ? e.message : String(e))
    }
    if (sources.length === 0) err('mindestens eine Quelle nötig')
    let showWhen: ChecklistCondition[] | undefined
    if (r.showWhen !== undefined) {
      if (!Array.isArray(r.showWhen) || r.showWhen.length === 0) err('showWhen muss eine nicht leere Liste sein')
      else {
        showWhen = []
        for (const c of r.showWhen) {
          if (!isRecord(c) || Object.keys(c).length === 0 || Object.keys(c).some((k) => !(CONDITION_KEYS as readonly string[]).includes(k))) {
            err(`showWhen-Bedingung ungültig (${JSON.stringify(c)})`)
            continue
          }
          if (Array.isArray(c.activityTag) && c.activityTag.some((t) => !ACTIVITY_TAGS.includes(t as ActivityTag))) err('showWhen: unbekannter activityTag')
          showWhen.push(c as ChecklistCondition)
        }
      }
    }
    out.push({ id, module, text: String(r.text ?? ''), sources, kinds, ...(showWhen ? { showWhen } : {}) })
  }
  if (errors.length) throw new Error(errors.join('; '))
  return out
}

/** Cross checks: unique ids, sources resolve in the registry, modules exist. Returns error messages. */
export function validateChecklist(
  items: readonly ChecklistItem[],
  opts: { registry?: SourceRegistry; moduleIds?: readonly string[] } = {},
): string[] {
  const registry = opts.registry ?? getSourceRegistry()
  const modules = new Set<string>(opts.moduleIds ?? MODULE_IDS)
  const errors: string[] = []
  const seen = new Set<string>()
  for (const it of items) {
    if (seen.has(it.id)) errors.push(`${it.id}: doppelte id`)
    seen.add(it.id)
    if (!modules.has(it.module)) errors.push(`${it.id}: Modul ${it.module} existiert nicht`)
    for (const s of it.sources) if (!registry.get(s.key)) errors.push(`${it.id}: Quelle ${s.key} nicht in sources.yaml`)
  }
  return errors
}

const files = import.meta.glob('../packs/*/checklist.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

let cache: ChecklistItem[] | null = null

/** All bundled checklist items (jslst, pbs), validated against the source registry. */
export function loadBundledChecklist(moduleIds?: readonly string[]): ChecklistItem[] {
  if (cache && !moduleIds) return cache
  const items = Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([path, text]) => parseChecklist(parse(text), path.replace('../packs/', '')))
  const errors = validateChecklist(items, { moduleIds })
  if (errors.length) throw new Error(`Checkliste ungültig: ${errors.join('; ')}`)
  if (!moduleIds) cache = items
  return items
}

/** True when at least one camp day lies in one of `months` (1..12). */
export function campOverlapsMonths(dates: readonly IsoDate[], months: readonly number[]): boolean {
  return dates.some((d) => months.includes(Number(d.slice(5, 7))))
}

export interface ChecklistContext {
  moduleStates: Partial<Record<ModuleId, ModuleResolution>>
  config: Pick<CampRuleConfig, 'camp' | 'angebot' | 'activityTags'>
  coachInputs: CoachInputs | null
  /** Camp overlaps `lst.winterMonths`. */
  campInWinter: boolean
}

function conditionHolds(c: ChecklistCondition, ctx: ChecklistContext): boolean {
  if (c.campConfig) {
    const flat: Record<string, unknown> = { ...ctx.config.camp, ...ctx.config.angebot }
    if (!Object.entries(c.campConfig).every(([f, allowed]) => allowed.some((v) => v === flat[f]))) return false
  }
  if (c.coachInput) {
    const ci = (ctx.coachInputs ?? {}) as unknown as Record<string, unknown>
    if (!Object.entries(c.coachInput).every(([f, v]) => ci[f] === v)) return false
  }
  if (c.coachInputSet) {
    const v = ((ctx.coachInputs ?? {}) as unknown as Record<string, unknown>)[c.coachInputSet]
    if (v === null || v === undefined || v === '' || v === false) return false
  }
  if (c.activityTag) {
    const wanted = c.activityTag
    if (!Object.values(ctx.config.activityTags).some((tags) => tags.some((t) => wanted.includes(t)))) return false
  }
  if (c.campInWinter !== undefined && ctx.campInWinter !== c.campInWinter) return false
  return true
}

/** Items to show for this camp: module effectively on and (no showWhen or one condition holds). */
export function visibleChecklist(items: readonly ChecklistItem[], ctx: ChecklistContext): ChecklistItem[] {
  return items.filter(
    (it) => ctx.moduleStates[it.module]?.state === 'on' && (!it.showWhen || it.showWhen.some((c) => conditionHolds(c, ctx))),
  )
}

export interface ChecklistGroup {
  module: ModuleId
  items: ChecklistItem[]
}

/** Groups by module in MODULE_IDS order. */
export function groupChecklist(items: readonly ChecklistItem[]): ChecklistGroup[] {
  return MODULE_IDS.map((module) => ({ module, items: items.filter((i) => i.module === module) })).filter((g) => g.items.length > 0)
}

export function checklistProgress(items: readonly ChecklistItem[], state: CampRuleConfig['checklist']): { done: number; total: number } {
  return { done: items.filter((i) => state[i.id]?.done).length, total: items.length }
}
