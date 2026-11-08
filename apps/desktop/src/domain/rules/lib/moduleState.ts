/**
 * Per-camp module state resolution (catalog v2 §2.3). Pure.
 *
 *   coachState = campConfig.modules[id] ?? 'auto'
 *   !appliesWhen          → off   (exception: an `organizer` mismatch can be overridden by coach 'on')
 *   coachState on / off   → on / off
 *   default on            → on
 *   an onWhen trigger     → on        (coach tags are confirmation)
 *   a suggestWhen trigger → suggested (reasons collected for the UI)
 *   else                  → off
 *
 * Reasons are i18n keys under `rules.module.reason.*` with params; no German text here.
 * Unknown organizer (camp.organizer and hitobitoProvider empty) counts as PBS, so PBS rules keep running
 * for camps without organizer data (behaviour before rules v2).
 */
import type {
  ActivityTag,
  CampFacts,
  CampRuleConfig,
  CoachInputs,
  DocumentRecord,
  KeywordMatcher,
  ModuleDef,
  ModuleId,
  ModuleReason,
  ModuleResolution,
  ModuleTrigger,
  ParamReader,
  ParamValue,
} from '../../types'
import { ALL_ACTIVITY_FIELDS } from './keywords'

export const TRIGGER_KEYS = ['keywordSet', 'gpxHighestPointAbove', 'campStartMonths', 'campConfig', 'activityTag', 'coachInput'] as const
export type TriggerKey = (typeof TRIGGER_KEYS)[number]
/** Extra keys allowed next to a trigger key. */
export const TRIGGER_MODIFIERS = ['minActivities'] as const

export interface ModuleStateInput {
  modules: readonly ModuleDef[]
  facts: CampFacts
  coachInputs: CoachInputs | null
  documents: readonly DocumentRecord[]
  /** Stored config with defaults applied (sport resolved). */
  config: Omit<CampRuleConfig, 'sport'> & { sport: 'lst' | 'other' }
  keywords: KeywordMatcher
  params: ParamReader
}

/** PBS camp: organizer / hitobito provider mention PBS / scout / db.scout.ch; unknown (both empty) → true. */
export function isPbsOrganizer(facts: CampFacts): boolean {
  const org = (facts.camp.organizer ?? '').trim()
  const provider = (facts.camp.hitobitoProvider ?? '').trim()
  if (!org && !provider) return true
  return /\bpbs\b|pfadi|scout/i.test(org) || /scout/i.test(provider)
}

const reason = (key: string, params: Record<string, string | number> = {}): ModuleReason => ({ key: `rules.module.reason.${key}`, params })

function numberOrParam(v: number | { param: string } | undefined, params: ParamReader): number | null {
  if (v === undefined) return null
  if (typeof v === 'number') return v
  return params.get<number>(v.param)
}

function monthsOrParam(v: number[] | { param: string } | undefined, params: ParamReader): number[] {
  if (!v) return []
  if (Array.isArray(v)) return v
  return params.get<number[]>(v.param)
}

function configField(config: ModuleStateInput['config'], field: string): ParamValue | undefined {
  if (field === 'sport') return config.sport
  if (field in config.camp) return config.camp[field as keyof typeof config.camp]
  if (field in config.angebot) return config.angebot[field as keyof typeof config.angebot]
  return undefined
}

/** Evaluates one trigger; returns a reason when it fires, else null. */
export function evaluateTrigger(t: ModuleTrigger, input: ModuleStateInput): ModuleReason | null {
  const { facts, config, keywords, params } = input
  if (t.keywordSet) {
    const min = t.minActivities ?? 1
    const count = facts.activities.filter((a) => keywords.matchActivity(t.keywordSet!, a, ALL_ACTIVITY_FIELDS).length > 0).length
    return count >= min ? reason('keywordSet', { set: t.keywordSet, count }) : null
  }
  if (t.gpxHighestPointAbove !== undefined) {
    const threshold = numberOrParam(t.gpxHighestPointAbove, params)
    const highest = Math.max(-Infinity, ...input.documents.map((d) => d.gpx?.highestPointM ?? -Infinity))
    return threshold !== null && highest > threshold ? reason('gpxHighestPointAbove', { meters: Math.round(highest), threshold }) : null
  }
  if (t.campStartMonths !== undefined) {
    const start = facts.camp.start
    if (!start) return null
    const month = Number(start.slice(5, 7))
    return monthsOrParam(t.campStartMonths, params).includes(month) ? reason('campStartMonths', { month }) : null
  }
  if (t.campConfig) {
    const entries = Object.entries(t.campConfig)
    const ok = entries.every(([field, allowed]) => allowed.some((v) => v === configField(config, field)))
    if (!ok || entries.length === 0) return null
    const [field] = entries[0]
    return reason('campConfig', { field, value: String(configField(config, field)) })
  }
  if (t.activityTag) {
    const wanted: ActivityTag[] = Array.isArray(t.activityTag) ? t.activityTag : [t.activityTag]
    const count = Object.values(config.activityTags).filter((tags) => tags.some((x) => wanted.includes(x))).length
    return count > 0 ? reason('activityTag', { tag: wanted.join(', '), count }) : null
  }
  if (t.coachInput) {
    const ci = (input.coachInputs ?? {}) as unknown as Record<string, unknown>
    const entries = Object.entries(t.coachInput)
    if (entries.length === 0 || !entries.every(([f, v]) => ci[f] === v)) return null
    return reason('coachInput', { field: entries[0][0], value: String(entries[0][1]) })
  }
  return null
}

/** Effective state of every module (dependencies via appliesWhen.module are resolved first). */
export function resolveModuleStates(input: ModuleStateInput): Partial<Record<ModuleId, ModuleResolution>> {
  const byId = new Map(input.modules.map((m) => [m.id, m]))
  const out: Partial<Record<ModuleId, ModuleResolution>> = {}
  const visiting = new Set<ModuleId>()

  const resolve = (id: ModuleId): ModuleResolution => {
    const done = out[id]
    if (done) return done
    const m = byId.get(id)
    const coachState = input.config.modules[id] ?? 'auto'
    if (!m) return { state: 'off', coachState, reasons: [reason('notApplicable', { module: id })] }
    if (visiting.has(id)) throw new Error(`Modul ${id}: zyklisches appliesWhen.module`)
    visiting.add(id)
    const res = compute(m, coachState)
    visiting.delete(id)
    out[id] = res
    return res
  }

  const compute = (m: ModuleDef, coachState: ModuleResolution['coachState']): ModuleResolution => {
    const off = (r: ModuleReason): ModuleResolution => ({ state: 'off', coachState, reasons: [r] })
    const w = m.appliesWhen
    if (w.jsCamp !== undefined && (input.coachInputs?.isJsCamp !== false) !== w.jsCamp) {
      return off(reason('notJsCamp'))
    }
    if (w.sport && !w.sport.includes(input.config.sport)) return off(reason('sport', { sport: input.config.sport }))
    if (w.module && resolve(w.module).state === 'off') return off(reason('moduleOff', { module: w.module }))
    if (w.organizer === 'pbs' && !isPbsOrganizer(input.facts) && coachState !== 'on') return off(reason('organizer'))
    if (coachState === 'on') return { state: 'on', coachState, reasons: [reason('coachOn')] }
    if (coachState === 'off') return { state: 'off', coachState, reasons: [reason('coachOff')] }
    if (m.default === 'on') return { state: 'on', coachState, reasons: [reason('default')] }
    const onReasons = m.onWhen.map((t) => evaluateTrigger(t, input)).filter((r): r is ModuleReason => r !== null)
    if (onReasons.length) return { state: 'on', coachState, reasons: onReasons }
    const suggest = m.suggestWhen.map((t) => evaluateTrigger(t, input)).filter((r): r is ModuleReason => r !== null)
    if (suggest.length) return { state: 'suggested', coachState, reasons: suggest }
    return { state: 'off', coachState, reasons: [reason('noTrigger')] }
  }

  for (const m of input.modules) resolve(m.id)
  return out
}
