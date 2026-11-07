/**
 * Deadline radar: PBS milestones (Grobprogramm, Lagerdossier, Lagerbewilligung …) as a bundled,
 * versioned list (`milestones/pbs.yaml`, loaded via import.meta.glob ?raw like the rule packs). Pure.
 *
 * Hering (hering.scout.ch) has no API; the list mirrors its guidance with a source link per entry and
 * confidence 'unverified' until a PBS owner confirms it. Offsets are days relative to camp start
 * (anchor 'start', negative = before) or camp end (anchor 'end').
 */
import type { CoachInputs, Confidence, Deadline, IsoDate, Source } from '../types'
import type { DeadlineCamp } from './deadlines'

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

/** Parses + validates the bundled YAML (throws with readable German errors). */
export function parseMilestonesYaml(text: string): MilestoneList {
  void text
  throw new Error('not implemented')
}

export function loadBundledMilestones(): MilestoneList {
  throw new Error('not implemented')
}

/** Deadlines of kind 'pbs-milestone' for one camp; done = inputs.milestonesDone has the id. */
export function computeMilestoneDeadlines(camp: DeadlineCamp, inputs: CoachInputs | null, list: MilestoneList): Deadline[] {
  void [camp, inputs, list]
  throw new Error('not implemented')
}

/** Radar buckets relative to today: overdue, this week (0-7), next 4 weeks (8-28), later (>28), done. */
export type RadarBucket = 'overdue' | 'week' | 'month' | 'later' | 'done'

export function radarBucket(deadline: Pick<Deadline, 'due' | 'done'>, today: IsoDate): RadarBucket {
  void [deadline, today]
  throw new Error('not implemented')
}
