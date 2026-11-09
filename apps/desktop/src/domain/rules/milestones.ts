/**
 * Deadline radar: milestones (Grobprogramm, Lagerdossier, NDS, Leihmaterial …) as bundled, versioned
 * lists in the rule packs (`packs/<pack>/milestones.yaml`, loaded via import.meta.glob ?raw like the rule
 * packs). Pure. Catalog v2 §9.
 *
 * Offsets are days relative to an anchor (negative = before): camp `start` / `end`, the planned
 * `leihmaterialDelivery` / `landeskartenDelivery` date (falls back to the camp start), the
 * `lastActivity` date of the Angebot (falls back to the camp end), the `firstSb` activity date and the
 * order deadline of the Leihmaterial delivery outage (`outageOrderBy`). A milestone listing a time range
 * has `offsetDays` = the latest date and `offsetEarliestDays` = the earliest.
 *
 * Confidence: `unverified` entries are labelled «unbestätigt» in the UI until an owner confirmed them.
 */
import { parse } from 'yaml'
import type { Audience, CampRuleConfig, CoachInputs, Confidence, Deadline, IsoDate, ModuleId, Source } from '../types'
import { MODULE_IDS } from '../types'
import { addDays, daysBetween, type DeadlineCamp } from './lib/deadlines'
import { getSourceRegistry } from './packs/registry'
import type { SourceRegistry } from './lib/sources'

export type MilestoneAnchor = 'start' | 'end' | 'leihmaterialDelivery' | 'landeskartenDelivery' | 'lastActivity' | 'firstSb' | 'outageOrderBy'

export interface Milestone {
  id: string
  title: string
  description: string
  anchor: MilestoneAnchor
  /** Days relative to the anchor (latest date of a range). */
  offsetDays: number
  /** Start of a range (earlier than `offsetDays`), informational. */
  offsetEarliestDays?: number
  /** Different offset when the camp starts in one of `summerMonths` (Landeskarten). */
  summerOffsetDays?: number
  summerMonths?: number[]
  /** Who acts on it: the coach (receives/reviews/approves) or the camp leaders. */
  audience: Audience
  /** Module the milestone belongs to (pack module); absent = always shown. */
  module?: ModuleId
  source: Source
  confidence: Confidence
}

export interface MilestoneList {
  id: string
  name: string
  version: string
  milestones: Milestone[]
}

const CONFIDENCES: Confidence[] = ['verified', 'conflict', 'unverified', 'best-practice', 'heuristic']
const AUDIENCES: Audience[] = ['coach', 'leaders']
const ANCHORS: MilestoneAnchor[] = ['start', 'end', 'leihmaterialDelivery', 'landeskartenDelivery', 'lastActivity', 'firstSb', 'outageOrderBy']

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** Source of a milestone: legacy `source: {title, url}` or `sources: [{key, page}]` resolved through the registry. */
function sourceOf(m: Record<string, unknown>, label: string, registry: SourceRegistry, errors: string[]): Source {
  if (Array.isArray(m.sources) && m.sources.length > 0) {
    const resolved: Source[] = []
    for (const ref of m.sources) {
      const key = isRecord(ref) ? ref.key : undefined
      const rec = typeof key === 'string' ? registry.get(key) : undefined
      if (!rec) {
        errors.push(`${label}: Quelle «${String(key)}» ist nicht in sources.yaml`)
        continue
      }
      const page = isRecord(ref) && nonEmpty(ref.page) ? `, ${ref.page}` : ''
      resolved.push({ title: `${rec.title}${page}`, url: rec.url ?? rec.shortUrl ?? '' })
    }
    return resolved.find((s) => s.url) ?? resolved[0] ?? { title: '', url: '' }
  }
  const src = isRecord(m.source) ? m.source : {}
  if (!nonEmpty(src.title) || !nonEmpty(src.url)) errors.push(`${label}: «source» braucht «title» und «url»`)
  else if (!/^https?:\/\//.test(src.url)) errors.push(`${label}: «source.url» muss mit http(s):// beginnen`)
  return { title: String(src.title ?? ''), url: String(src.url ?? '') }
}

/** Parses + validates a milestone YAML (throws with readable German errors). */
export function parseMilestonesYaml(text: string, registry: SourceRegistry = getSourceRegistry()): MilestoneList {
  let raw: unknown
  try {
    raw = parse(text)
  } catch (e) {
    throw new Error(`Meilenstein-YAML ist ungültig: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!isRecord(raw)) throw new Error('Meilenstein-YAML ist leer oder ungültig')
  const errors: string[] = []
  if (!nonEmpty(raw.id)) errors.push('«id» fehlt')
  if (!nonEmpty(raw.name)) errors.push('«name» fehlt')
  if (raw.version === undefined || raw.version === null || String(raw.version).trim() === '') errors.push('«version» fehlt')
  if (!Array.isArray(raw.milestones) || raw.milestones.length === 0) errors.push('«milestones» fehlt oder ist leer')

  const milestones: Milestone[] = []
  const seen = new Set<string>()
  for (const [i, m] of (Array.isArray(raw.milestones) ? raw.milestones : []).entries()) {
    if (!isRecord(m)) {
      errors.push(`Meilenstein ${i + 1}: kein Objekt`)
      continue
    }
    const label = `Meilenstein ${nonEmpty(m.id) ? m.id : i + 1}`
    if (!nonEmpty(m.id)) errors.push(`${label}: «id» fehlt`)
    else if (seen.has(m.id)) errors.push(`${label}: «id» doppelt`)
    else seen.add(m.id)
    if (!nonEmpty(m.title)) errors.push(`${label}: «title» fehlt`)
    if (!ANCHORS.includes(m.anchor as MilestoneAnchor)) errors.push(`${label}: «anchor» muss einer von ${ANCHORS.join(', ')} sein`)
    if (!isInt(m.offsetDays)) errors.push(`${label}: «offsetDays» muss eine ganze Zahl sein`)
    if (m.offsetEarliestDays !== undefined && !isInt(m.offsetEarliestDays)) errors.push(`${label}: «offsetEarliestDays» muss eine ganze Zahl sein`)
    if (m.summerOffsetDays !== undefined && !isInt(m.summerOffsetDays)) errors.push(`${label}: «summerOffsetDays» muss eine ganze Zahl sein`)
    if (m.module !== undefined && !MODULE_IDS.includes(m.module as ModuleId)) errors.push(`${label}: «module» unbekannt`)
    if (!CONFIDENCES.includes(m.confidence as Confidence)) errors.push(`${label}: «confidence» ungültig`)
    if (!AUDIENCES.includes(m.audience as Audience)) errors.push(`${label}: «audience» muss coach oder leaders sein`)
    const source = sourceOf(m, label, registry, errors)
    milestones.push({
      id: String(m.id ?? ''),
      title: String(m.title ?? ''),
      description: String(m.description ?? ''),
      anchor: m.anchor as MilestoneAnchor,
      audience: m.audience as Audience,
      offsetDays: m.offsetDays as number,
      ...(isInt(m.offsetEarliestDays) ? { offsetEarliestDays: m.offsetEarliestDays } : {}),
      ...(isInt(m.summerOffsetDays) ? { summerOffsetDays: m.summerOffsetDays } : {}),
      ...(Array.isArray(m.summerMonths) ? { summerMonths: m.summerMonths.map(Number) } : {}),
      ...(m.module !== undefined ? { module: m.module as ModuleId } : {}),
      source,
      confidence: m.confidence as Confidence,
    })
  }
  if (errors.length) throw new Error(`Meilenstein-Liste ungültig: ${errors.join('; ')}`)
  return { id: String(raw.id), name: String(raw.name), version: String(raw.version), milestones }
}

const milestoneFiles = import.meta.glob('./packs/*/milestones.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** One list per pack that ships a `milestones.yaml` (jslst, pbs). */
export function loadBundledMilestoneLists(): MilestoneList[] {
  const entries = Object.entries(milestoneFiles).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) throw new Error('Gebündelte Meilenstein-Listen «packs/*/milestones.yaml» nicht gefunden')
  return entries.map(([, text]) => parseMilestonesYaml(text))
}

/** All bundled milestones (all packs) as one list; ids are unique across packs. */
export function loadBundledMilestones(): MilestoneList {
  const lists = loadBundledMilestoneLists()
  const all = lists.flatMap((l) => l.milestones)
  const dup = all.find((m, i) => all.findIndex((o) => o.id === m.id) !== i)
  if (dup) throw new Error(`Meilenstein-ID «${dup.id}» kommt in mehreren Packs vor`)
  return { id: 'bundled', name: lists.map((l) => l.name).join(' + '), version: lists.map((l) => l.version).join('+'), milestones: all }
}

/** Modules that are on by default; milestones of `auto` modules need `isModuleActive` to show up. */
const DEFAULT_ON_MODULES: readonly ModuleId[] = ['js', 'lst', 'lst-lager', 'lst-trekking', 'pbs']

export interface MilestoneContext {
  /** Effective module state of the camp (default: only modules that are on by default). */
  isModuleActive?: (module: ModuleId) => boolean
  /** Angebot.lastActivityDate (campRuleConfig); anchor `lastActivity` falls back to the camp end. */
  lastActivityDate?: IsoDate | null
  /** Date of the first activity tagged sb-* (anchor `firstSb`; milestone is skipped without it). */
  firstSbDate?: IsoDate | null
  /** js.leihmaterialOutage value (anchor `outageOrderBy`; skipped when null or the material window does not overlap). */
  outage?: { outageStart: IsoDate; outageEnd: IsoDate; orderBy: IsoDate } | null
}

function anchorDate(m: Milestone, camp: DeadlineCamp & { start: IsoDate }, inputs: CoachInputs | null, ctx: MilestoneContext): IsoDate | null {
  switch (m.anchor) {
    case 'start':
      return camp.start
    case 'end':
      return camp.end ?? camp.start
    case 'leihmaterialDelivery':
      return inputs?.leihmaterialDeliveryDate ?? camp.start
    case 'landeskartenDelivery':
      return inputs?.landeskartenDeliveryDate ?? camp.start
    case 'lastActivity':
      return ctx.lastActivityDate ?? camp.end ?? camp.start
    case 'firstSb':
      return ctx.firstSbDate ?? null
    case 'outageOrderBy': {
      const o = ctx.outage
      if (!o) return null
      // Same window as JS-DL-06: [delivery ?? start - 7, end + 7] overlaps the outage.
      const from = addDays(inputs?.leihmaterialDeliveryDate ?? camp.start, inputs?.leihmaterialDeliveryDate ? 0 : -7)
      const to = addDays(camp.end ?? camp.start, 7)
      return from <= o.outageEnd && to >= o.outageStart ? o.orderBy : null
    }
  }
}

/** Deadlines of kind 'pbs-milestone' for one camp; done = inputs.milestonesDone has the id. */
export function computeMilestoneDeadlines(
  camp: DeadlineCamp,
  inputs: CoachInputs | null,
  list: MilestoneList,
  ctx: MilestoneContext = {},
): Deadline[] {
  if (!camp.start) return []
  const start: IsoDate = camp.start
  const done = inputs?.milestonesDone ?? {}
  const active = ctx.isModuleActive ?? ((m: ModuleId) => DEFAULT_ON_MODULES.includes(m))
  const out: Deadline[] = []
  for (const m of list.milestones) {
    if (m.module && !active(m.module)) continue
    // J+S milestones make no sense for a camp the coach marked as non-J+S.
    if (inputs?.isJsCamp === false && (m.module === 'js' || m.module?.startsWith('lst'))) continue
    const base = anchorDate(m, { ...camp, start }, inputs, ctx)
    if (!base) continue
    const summer = m.summerMonths?.includes(Number(start.slice(5, 7))) && m.summerOffsetDays !== undefined
    out.push({
      campIri: camp.iri,
      campTitle: camp.title,
      kind: 'pbs-milestone' as const,
      due: addDays(base, summer ? (m.summerOffsetDays as number) : m.offsetDays),
      done: Object.prototype.hasOwnProperty.call(done, m.id),
      ruleId: null,
      source: m.source,
      milestoneId: m.id,
      title: m.title,
      confidence: m.confidence,
      audience: m.audience,
    })
  }
  return out
}

/** Radar buckets relative to today: overdue, this week (0-7), next 4 weeks (8-28), later (>28), done. */
export type RadarBucket = 'overdue' | 'week' | 'month' | 'later' | 'done'

export function radarBucket(deadline: Pick<Deadline, 'due' | 'done'>, today: IsoDate): RadarBucket {
  if (deadline.done) return 'done'
  const left = daysBetween(today, deadline.due)
  if (left < 0) return 'overdue'
  if (left <= 7) return 'week'
  return left <= 28 ? 'month' : 'later'
}

/**
 * Milestone context from a stored CampRuleConfig. The deadline radar has no CampFacts, so `auto`
 * modules count as inactive there; the coach sets a module to «an» to see its milestones.
 */
export function milestoneContextFromConfig(config: CampRuleConfig | null | undefined): MilestoneContext {
  const modules = config?.modules ?? {}
  return {
    isModuleActive: (m: ModuleId) => {
      const state = modules[m]
      if (state === 'on') return true
      if (state === 'off') return false
      return DEFAULT_ON_MODULES.includes(m)
    },
    lastActivityDate: config?.angebot?.lastActivityDate ?? null,
  }
}
