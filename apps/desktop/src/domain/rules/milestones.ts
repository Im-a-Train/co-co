/**
 * Deadline radar: PBS milestones (Grobprogramm, Lagerdossier, Lagerbewilligung …) as a bundled,
 * versioned list (`milestones/pbs.yaml`, loaded via import.meta.glob ?raw like the rule packs). Pure.
 *
 * Hering (hering.scout.ch) has no API; the list mirrors its guidance with a source link per entry and
 * confidence 'unverified' until a PBS owner confirms it. Offsets are days relative to camp start
 * (anchor 'start', negative = before) or camp end (anchor 'end').
 */
import { parse } from 'yaml'
import type { CoachInputs, Confidence, Deadline, IsoDate, Source } from '../types'
import { addDays, daysBetween, type DeadlineCamp } from './deadlines'

export interface Milestone {
  id: string
  title: string
  description: string
  anchor: 'start' | 'end'
  offsetDays: number
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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** Parses + validates the bundled YAML (throws with readable German errors). */
export function parseMilestonesYaml(text: string): MilestoneList {
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
    if (m.anchor !== 'start' && m.anchor !== 'end') errors.push(`${label}: «anchor» muss «start» oder «end» sein`)
    if (typeof m.offsetDays !== 'number' || !Number.isInteger(m.offsetDays)) errors.push(`${label}: «offsetDays» muss eine ganze Zahl sein`)
    if (!CONFIDENCES.includes(m.confidence as Confidence)) errors.push(`${label}: «confidence» ungültig`)
    const src = isRecord(m.source) ? m.source : {}
    if (!nonEmpty(src.title) || !nonEmpty(src.url)) errors.push(`${label}: «source» braucht «title» und «url»`)
    else if (!/^https?:\/\//.test(src.url)) errors.push(`${label}: «source.url» muss mit http(s):// beginnen`)
    milestones.push({
      id: String(m.id ?? ''),
      title: String(m.title ?? ''),
      description: String(m.description ?? ''),
      anchor: m.anchor as 'start' | 'end',
      offsetDays: m.offsetDays as number,
      source: { title: String(src.title ?? ''), url: String(src.url ?? '') },
      confidence: m.confidence as Confidence,
    })
  }
  if (errors.length) throw new Error(`Meilenstein-Liste ungültig: ${errors.join('; ')}`)
  return { id: String(raw.id), name: String(raw.name), version: String(raw.version), milestones }
}

const milestoneFiles = import.meta.glob('./milestones/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export function loadBundledMilestones(): MilestoneList {
  const text = milestoneFiles['./milestones/pbs.yaml']
  if (!text) throw new Error('Gebündelte Meilenstein-Liste «pbs.yaml» nicht gefunden')
  return parseMilestonesYaml(text)
}

/** Deadlines of kind 'pbs-milestone' for one camp; done = inputs.milestonesDone has the id. */
export function computeMilestoneDeadlines(camp: DeadlineCamp, inputs: CoachInputs | null, list: MilestoneList): Deadline[] {
  if (!camp.start) return []
  const done = inputs?.milestonesDone ?? {}
  return list.milestones.map((m) => ({
    campIri: camp.iri,
    campTitle: camp.title,
    kind: 'pbs-milestone' as const,
    due: addDays(m.anchor === 'start' ? camp.start! : (camp.end ?? camp.start!), m.offsetDays),
    done: Object.prototype.hasOwnProperty.call(done, m.id),
    ruleId: null,
    source: m.source,
    milestoneId: m.id,
    title: m.title,
    confidence: m.confidence,
  }))
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
