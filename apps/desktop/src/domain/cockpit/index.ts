/**
 * Cockpit helpers (pure, no Vue): week grid layout, finding grouping/filtering, KPI helpers.
 * eCamp times are camp-local wall clock, so we slice the ISO strings
 * instead of using Date getters (see domain/types.ts).
 */
import { jsDayInvalidReasons, type JsDayReason, type JsDayReport } from '../rules/lib/jsDays'
import type {
  CampFacts,
  CategoryClass,
  Diff,
  Finding,
  Iri,
  IsoDate,
  IsoDateTime,
  RuleGroup,
  ScheduleEntryFact,
  Severity,
} from '../types'
import { JS_UNIT_CLASSES } from '../types'

export const GRID_START_HOUR = 7
export const GRID_END_HOUR = 23
/** A J+S day needs at least this many J+S minutes. */
export const JS_DAY_MIN_MINUTES = 240
export const SEVERITIES: readonly Severity[] = ['must', 'should', 'hint'] as const

// ---------------------------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------------------------

/** Minutes since midnight of an eCamp wall-clock ISO string (`2031-01-24T08:30:00+00:00`). */
export function minutesOfDay(iso: IsoDateTime): number {
  const m = /T(\d{2}):(\d{2})/.exec(iso)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}

export function dateOf(iso: IsoDateTime): IsoDate {
  return iso.slice(0, 10)
}

/** `2031-01-24` -> `24.01.2031` */
export function formatDate(d: IsoDate | null | undefined): string {
  return d ? d.split('-').reverse().join('.') : ''
}

/** `2031-01-24` -> `24.01.` */
export function formatDateShort(d: IsoDate): string {
  return d.split('-').reverse().slice(0, 2).join('.') + '.'
}

export function formatClock(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 210 -> `3 h 30`, 45 -> `45 min`, 120 -> `2 h` */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------------------------
// Week grid (Lagertag-Rechner)
// ---------------------------------------------------------------------------------------------

export interface GridBlock {
  entryIri: Iri
  activityIri: Iri
  title: string
  number: string | null
  startMin: number
  endMin: number
  /** Position in percent of the grid height. */
  topPct: number
  heightPct: number
  /** Overlapping blocks share the column width: lane / lanes. */
  lane: number
  lanes: number
  color: string
  categoryClass: CategoryClass
  isJs: boolean
  /** Open findings targeting the activity or one of its schedule entries (day findings excluded). */
  findings: Record<Severity, number>
  /** The activity's category is excluded from the rule checks (no findings, day maths unchanged). */
  excluded: boolean
}

export interface GridGap {
  startMin: number
  endMin: number
  minutes: number
  topPct: number
  heightPct: number
}

export interface GridDay {
  date: IsoDate
  number: number
  dayIri: Iri | null
  blocks: GridBlock[]
  /** Sozialzeit gaps below 30 min (to hatch). */
  badGaps: GridGap[]
  jsMinutes: number
  jsUnits: number
  /** null while the J+S calculator is not available. */
  valid: boolean | null
  /**
   * Why the day does not count on its own (empty while it counts or without a J+S report). With a model report
   * an end day that only counts through the arrival/departure pair is `valid` and lists its failures + `combinedOnly`.
   */
  invalidReasons: JsDayReason[]
  /** JS-DAY-01/04 finding whose targets include this day: an open one first, else an ignored one (null if none). */
  findingId: string | null
  /** Entries that lie completely outside the visible hours. */
  hiddenEntries: number
}

export interface GridModel {
  startHour: number
  endHour: number
  hours: number[]
  days: GridDay[]
  /** The J+S figures are an unconfirmed guess (display only, no findings). */
  preview: boolean
  /** «{valid} von {total} J+S-Tagen»; null while no J+S report exists. */
  summary: { valid: number; total: number } | null
}

export interface GridOptions {
  startHour?: number
  endHour?: number
  /** `jsDays` is the unconfirmed preview report. */
  preview?: boolean
  /** Findings to attach to days (JS-DAY-01/04) and blocks. */
  findings?: readonly Finding[]
  /** True when the category is excluded from the rule checks. */
  isExcluded?: (activityIri: Iri, categoryIri: Iri | null) => boolean
}

const DAY_FINDING_RULES: readonly string[] = ['JS-DAY-01', 'JS-DAY-04']

/** Assigns side-by-side lanes to overlapping blocks (greedy, by start time). */
export function assignLanes(blocks: GridBlock[]): void {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)
  let cluster: GridBlock[] = []
  let clusterEnd = -1
  const flush = () => {
    const lanesEnd: number[] = []
    for (const b of cluster) {
      let lane = lanesEnd.findIndex((end) => end <= b.startMin)
      if (lane === -1) {
        lane = lanesEnd.length
        lanesEnd.push(b.endMin)
      } else lanesEnd[lane] = b.endMin
      b.lane = lane
    }
    for (const b of cluster) b.lanes = lanesEnd.length
    cluster = []
  }
  for (const b of sorted) {
    if (cluster.length && b.startMin >= clusterEnd) {
      flush()
      clusterEnd = -1
    }
    cluster.push(b)
    clusterEnd = Math.max(clusterEnd, b.endMin)
  }
  if (cluster.length) flush()
}

export function buildGrid(
  facts: CampFacts,
  classOf: (categoryIri: Iri | null) => CategoryClass,
  jsDays: JsDayReport | null,
  opts: GridOptions = {},
): GridModel {
  const entriesByDate = new Map<IsoDate, ScheduleEntryFact[]>()
  for (const e of facts.scheduleEntries) {
    const d = dateOf(e.start)
    const list = entriesByDate.get(d) ?? []
    list.push(e)
    entriesByDate.set(d, list)
  }
  /** Start/end minute of an entry on its start day; crossing midnight ends at 24:00. */
  const rangeOf = (e: ScheduleEntryFact): [number, number] => {
    const s = minutesOfDay(e.start)
    let en = dateOf(e.end) > dateOf(e.start) ? 24 * 60 : minutesOfDay(e.end)
    if (en <= s) en = s + e.durationMinutes
    return [s, en]
  }

  // Hours are dynamic unless fixed by the caller: the default 07-23 window grows to show early/late entries.
  let autoStart = GRID_START_HOUR
  let autoEnd = GRID_END_HOUR
  for (const e of facts.scheduleEntries) {
    const [s, en] = rangeOf(e)
    autoStart = Math.min(autoStart, Math.floor(s / 60))
    autoEnd = Math.max(autoEnd, Math.ceil(Math.min(en, 24 * 60) / 60))
  }
  const startHour = opts.startHour ?? Math.max(0, autoStart)
  const endHour = opts.endHour ?? Math.min(24, autoEnd)
  const from = startHour * 60
  const span = (endHour - startHour) * 60
  const pct = (min: number) => ((min - from) / span) * 100
  const catColor = new Map(facts.categories.map((c) => [c.iri, c.color]))
  const actById = new Map(facts.activities.map((a) => [a.iri, a]))
  // Day header link: an open JS-DAY-01/04 finding wins over an ignored one (the day still fails either way).
  const findingByDay = new Map<Iri, Finding>()
  const findingsByTarget = new Map<Iri, Finding[]>()
  for (const f of opts.findings ?? []) {
    if (DAY_FINDING_RULES.includes(f.ruleId)) {
      for (const t of f.targets) {
        const cur = findingByDay.get(t)
        if (!cur || (cur.override && !f.override)) findingByDay.set(t, f)
      }
      continue
    }
    // Block badges: open findings only; day findings belong to the day header.
    if (f.override || f.scope === 'day' || f.origin === 'manual') continue
    for (const t of new Set(f.targets)) findingsByTarget.set(t, [...(findingsByTarget.get(t) ?? []), f])
  }
  const blockFindings = (activityIri: Iri, entryIri: Iri): Record<Severity, number> => {
    const seen = new Set<string>()
    const counts: Record<Severity, number> = { must: 0, should: 0, hint: 0 }
    for (const f of [...(findingsByTarget.get(activityIri) ?? []), ...(findingsByTarget.get(entryIri) ?? [])]) {
      if (seen.has(f.id)) continue
      seen.add(f.id)
      counts[f.severity]++
    }
    return counts
  }

  const days: GridDay[] = [...facts.days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day, idx) => {
      const blocks: GridBlock[] = []
      let hidden = 0
      for (const e of entriesByDate.get(day.date) ?? []) {
        const [s, en] = rangeOf(e)
        const cs = Math.max(s, from)
        const ce = Math.min(en, from + span)
        if (ce <= cs) {
          hidden++
          continue
        }
        const act = actById.get(e.activityIri)
        const cls = classOf(act?.categoryIri ?? null)
        blocks.push({
          entryIri: e.iri,
          activityIri: e.activityIri,
          title: act?.title ?? '?',
          number: e.number,
          startMin: s,
          endMin: en,
          topPct: pct(cs),
          heightPct: ((ce - cs) / span) * 100,
          lane: 0,
          lanes: 1,
          color: (act?.categoryIri && catColor.get(act.categoryIri)) || '#9e9e9e',
          categoryClass: cls,
          isJs: JS_UNIT_CLASSES.includes(cls),
          findings: blockFindings(e.activityIri, e.iri),
          excluded: opts.isExcluded?.(e.activityIri, act?.categoryIri ?? null) ?? false,
        })
      }
      assignLanes(blocks)

      const rep = jsDays?.days.find((d) => d.dayIri === day.iri || d.date === day.date) ?? null
      const jsBlocks = blocks.filter((b) => b.isJs)
      const jsMinutes = rep ? rep.jsMinutes : jsBlocks.reduce((sum, b) => sum + (b.endMin - b.startMin), 0)
      const badGaps: GridGap[] = (rep?.gaps ?? [])
        .filter((g) => !g.ok)
        .map((g) => {
          const gs = minutesOfDay(g.start)
          const ge = minutesOfDay(g.end)
          return {
            startMin: gs,
            endMin: ge,
            minutes: g.minutes,
            topPct: pct(Math.max(gs, from)),
            heightPct: ((Math.min(ge, from + span) - Math.max(gs, from)) / span) * 100,
          }
        })
        .filter((g) => g.heightPct > 0)
      return {
        date: day.date,
        number: idx + 1,
        dayIri: day.iri,
        blocks,
        badGaps,
        jsMinutes,
        jsUnits: rep ? rep.unitCount : jsBlocks.length,
        valid: rep ? rep.valid || rep.validCombined : null,
        invalidReasons: !rep ? [] : (rep.reasons ?? (rep.valid || rep.validCombined ? [] : jsDayInvalidReasons(rep))),
        findingId: findingByDay.get(day.iri)?.id ?? null,
        hiddenEntries: hidden,
      }
    })

  const hours: number[] = []
  for (let h = startHour; h <= endHour; h++) hours.push(h)
  return {
    startHour,
    endHour,
    hours,
    days,
    preview: opts.preview ?? false,
    summary: jsDays ? { valid: jsDays.validDayCount, total: jsDays.totalDayCount } : null,
  }
}

/** Fill percent of a J+S meter / bar (full width = `max` minutes). */
export function meterPercent(minutes: number, max = JS_DAY_MIN_MINUTES * 1.5): number {
  return Math.min(100, Math.max(0, (minutes / max) * 100))
}

/** Position of the 4h threshold line in the meter. */
export function meterThresholdPercent(max = JS_DAY_MIN_MINUTES * 1.5): number {
  return (JS_DAY_MIN_MINUTES / max) * 100
}

// ---------------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------------

export interface FindingFilter {
  severities: Severity[]
  groups: RuleGroup[]
  search: string
  showOverridden: boolean
  /** Only findings that point at this activity. */
  activityIri?: Iri | null
}

export const DEFAULT_FINDING_FILTER: FindingFilter = {
  severities: [...SEVERITIES],
  groups: [],
  search: '',
  showOverridden: false,
  activityIri: null,
}

/** Module of a finding's rule (rules v2: from the finding / rule meta, no longer guessed from the id prefix). */
export function ruleGroupOf(finding: Pick<Finding, 'ruleId' | 'module'>): RuleGroup | null {
  return finding.module ?? null
}

export function filterFindings(findings: Finding[], f: FindingFilter): Finding[] {
  const q = f.search.trim().toLowerCase()
  return findings.filter((x) => {
    if (!f.severities.includes(x.severity)) return false
    if (!f.showOverridden && x.override) return false
    // Coach findings have no module; the module filter only narrows rule/AI findings.
    if (f.groups.length && x.origin !== 'manual' && !f.groups.includes(ruleGroupOf(x) as RuleGroup)) return false
    if (f.activityIri && !x.targets.includes(f.activityIri) && !x.evidence.some((e) => e.iri === f.activityIri)) {
      return false
    }
    if (q) {
      const hay = `${x.ruleId} ${x.title} ${x.message} ${x.evidence.map((e) => e.label).join(' ')}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export interface FindingGroup {
  /** 'coach' = manual coach findings (always first), otherwise the severity. */
  key: 'coach' | Severity
  /** Set for severity groups only. */
  severity?: Severity
  findings: Finding[]
}

const isCoach = (f: Pick<Finding, 'origin'>) => f.origin === 'manual'

/** Groups: coach findings first, then by severity (must, should, hint); empty groups are dropped; stable by rule id inside a group. */
export function groupBySeverity(findings: Finding[]): FindingGroup[] {
  const byRule = (a: Finding, b: Finding) => a.ruleId.localeCompare(b.ruleId)
  const coach: FindingGroup = { key: 'coach', findings: findings.filter(isCoach).sort(byRule) }
  const rest = SEVERITIES.map(
    (severity): FindingGroup => ({
      key: severity,
      severity,
      findings: findings.filter((f) => !isCoach(f) && f.severity === severity).sort(byRule),
    }),
  )
  return [coach, ...rest].filter((g) => g.findings.length > 0)
}

/** Top N open findings: coach findings first, then severity; overridden ones excluded. */
export function topFindings(findings: Finding[], n = 5): Finding[] {
  const rank = (s: Severity) => SEVERITIES.indexOf(s)
  return findings
    .filter((f) => !f.override)
    .sort(
      (a, b) =>
        Number(isCoach(b)) - Number(isCoach(a)) || rank(a.severity) - rank(b.severity) || a.ruleId.localeCompare(b.ruleId),
    )
    .slice(0, n)
}

export function findingsForActivity(findings: Finding[], activityIri: Iri): Finding[] {
  return findings.filter((f) => f.targets.includes(activityIri) || f.evidence.some((e) => e.iri === activityIri))
}

/** Only http(s) URLs are rendered as links. */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

/** Vuetify colour of a severity chip: must=error, should=warning, hint=info. */
export function severityColor(s: Severity): string {
  return s === 'must' ? 'error' : s === 'should' ? 'warning' : 'info'
}

/**
 * Colour of an open-finding count (GP block badge, DP chips): colour = state, so Muss red, Soll orange and
 * Hinweis neutral (null = no colour; informational counts get none).
 */
export function severityStateColor(s: Severity): 'error' | 'warning' | null {
  return s === 'must' ? 'error' : s === 'should' ? 'warning' : null
}

// ---------------------------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------------------------

export interface JsDayBar {
  date: IsoDate
  number: number
  minutes: number
  valid: boolean
  percent: number
  /** Why the day does not count (empty for legacy reports without model reasons). */
  reasons: JsDayReason[]
}

export function jsDayBars(report: JsDayReport | null): JsDayBar[] {
  if (!report) return []
  const max = Math.max(JS_DAY_MIN_MINUTES * 1.5, ...report.days.map((d) => d.jsMinutes))
  return report.days.map((d) => ({
    date: d.date,
    number: d.number,
    minutes: d.jsMinutes,
    valid: d.valid || d.validCombined,
    percent: meterPercent(d.jsMinutes, max),
    reasons: d.reasons ?? (d.valid || d.validCombined ? [] : jsDayInvalidReasons(d)),
  }))
}

export function diffTotal(diff: Diff | null): number | null {
  return diff ? diff.counts.added + diff.counts.changed + diff.counts.removed : null
}

/** Params of "Seit Runde n: +a ~c −r": the live diff against the latest round's snapshot. */
export function roundDeltaParams(
  rounds: { number: number }[],
  diff: Diff | null,
): { n: number; added: number; changed: number; removed: number } | null {
  if (!diff || rounds.length === 0) return null
  const n = Math.max(...rounds.map((r) => r.number))
  return { n, added: diff.counts.added, changed: diff.counts.changed, removed: diff.counts.removed }
}

/** Display label of an activity: "1.2 Postenlauf". */
export function activityLabel(facts: CampFacts, iri: Iri): string {
  const a = facts.activities.find((x) => x.iri === iri)
  if (!a) return '?'
  const nr = facts.scheduleEntries.find((e) => e.activityIri === iri)?.number
  return nr ? `${nr} ${a.title}` : a.title
}

/** Display names of the responsibles of an activity. */
export function responsibleNames(facts: CampFacts, activityIri: Iri): string[] {
  const act = facts.activities.find((a) => a.iri === activityIri)
  if (!act) return []
  return act.responsibleIris.map((i) => facts.collaborators.find((c) => c.iri === i)?.displayName ?? '?')
}
