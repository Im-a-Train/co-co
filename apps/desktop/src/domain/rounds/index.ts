/**
 * Review status, rounds, snapshots and diffs (M4). OWNER: rounds builder. Pure (store in ./store.ts).
 * Entity hash: SHA-256 (crypto.subtle) over stable JSON (sorted keys). Per-field hashes use a fast
 * non-crypto 106-bit hash so a diff can name the changed fields without keeping full facts around.
 */
import type {
  ActivityFact,
  CampFacts,
  Diff,
  DiffChange,
  DiffEntry,
  Iri,
  ReviewState,
  ReviewStatus,
  Round,
  Snapshot,
  SnapshotEntity,
  SnapshotEntityType,
} from '../types'

/** Allowed transitions: neu -> in_review -> aenderungen_angefragt <-> in_review -> bewilligt | bewilligt_mit_auflagen. */
export const REVIEW_TRANSITIONS: Record<ReviewStatus, readonly ReviewStatus[]> = {
  neu: ['in_review'],
  in_review: ['aenderungen_angefragt', 'bewilligt', 'bewilligt_mit_auflagen'],
  aenderungen_angefragt: ['in_review'],
  bewilligt: ['in_review'],
  bewilligt_mit_auflagen: ['in_review'],
}

export const REVIEW_STATUSES: readonly ReviewStatus[] = [
  'neu',
  'in_review',
  'aenderungen_angefragt',
  'bewilligt',
  'bewilligt_mit_auflagen',
]

export function canTransition(from: ReviewStatus, to: ReviewStatus): boolean {
  return REVIEW_TRANSITIONS[from].includes(to)
}

/** Statuses reachable from `from` (empty for unknown input). */
export function allowedTransitions(from: ReviewStatus): readonly ReviewStatus[] {
  return REVIEW_TRANSITIONS[from] ?? []
}

/** Vuetify color name for a review status chip. */
export function reviewStatusColor(s: ReviewStatus): string {
  if (s === 'bewilligt') return 'success'
  if (s === 'bewilligt_mit_auflagen' || s === 'aenderungen_angefragt') return 'warning'
  if (s === 'in_review') return 'primary'
  return 'grey'
}

/** Error with a machine code; the UI maps `code` to a German text (`rounds.errors.<code>`). */
export class RoundsError extends Error {
  constructor(
    public readonly code: 'invalidTransition' | 'noFacts' | 'noRound',
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'RoundsError'
  }
}

// ---------------------------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------------------------

/** JSON with sorted object keys; `undefined` values and functions are skipped. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value)
    return s === undefined ? 'null' : s
  }
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`
  const obj = value as Record<string, unknown>
  const parts: string[] = []
  for (const k of Object.keys(obj).sort()) {
    if (obj[k] === undefined || typeof obj[k] === 'function') continue
    parts.push(`${JSON.stringify(k)}:${stableStringify(obj[k])}`)
  }
  return `{${parts.join(',')}}`
}

function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/** Fast non-crypto hash (hex, 28 chars). Deterministic across runs. */
export function fastHash(s: string): string {
  return cyrb53(s, 0).toString(16).padStart(14, '0') + cyrb53(s, 7).toString(16).padStart(14, '0')
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------------------------

/** Snapshot entity with the extras this module stores (still assignable to SnapshotEntity). */
export interface SnapshotEntityEx extends SnapshotEntity {
  /** field name -> fast hash; lets a diff name changed fields. */
  fields?: Record<string, string>
  activityIri?: Iri
}

export interface EntityDraft {
  key: string
  type: SnapshotEntityType
  label: string
  activityIri?: Iri
  data: Record<string, unknown>
}

const sorted = (a: readonly string[]): string[] => [...a].sort()

function clockOf(iso: string): string {
  // eCamp times are camp-local wall-clock; slice instead of using Date.
  return iso.slice(11, 16)
}

/** Normalised, hash-relevant data of every entity (volatile fields like loadedAt are excluded). */
export function describeEntities(facts: CampFacts): EntityDraft[] {
  const out: EntityDraft[] = []
  const c = facts.camp
  out.push({
    key: c.iri,
    type: 'camp',
    label: c.title,
    data: {
      title: c.title,
      shortTitle: c.shortTitle,
      motto: c.motto,
      kind: c.kind,
      organizer: c.organizer,
      coachName: c.coachName,
      courseKind: c.courseKind,
      courseNumber: c.courseNumber,
      trainingAdvisorName: c.trainingAdvisorName,
      addressName: c.address.name,
      addressStreet: c.address.street,
      addressZipcode: c.address.zipcode,
      addressCity: c.address.city,
      start: c.start,
      end: c.end,
    },
  })
  for (const p of facts.periods) {
    out.push({
      key: p.iri,
      type: 'period',
      label: p.description || `${p.start} – ${p.end}`,
      data: { description: p.description, start: p.start, end: p.end },
    })
  }
  for (const d of facts.days) {
    out.push({ key: d.iri, type: 'day', label: d.date, data: { date: d.date, start: d.start, end: d.end } })
  }
  for (const cat of facts.categories) {
    out.push({
      key: cat.iri,
      type: 'category',
      label: cat.short ? `${cat.short} ${cat.name}` : cat.name,
      data: { short: cat.short, name: cat.name, color: cat.color, numberingStyle: cat.numberingStyle },
    })
  }
  const actTitle = new Map<Iri, string>(facts.activities.map((a: ActivityFact) => [a.iri, a.title]))
  for (const a of facts.activities) {
    out.push({
      key: a.iri,
      type: 'activity',
      label: a.title,
      activityIri: a.iri,
      data: {
        title: a.title,
        location: a.location,
        categoryIri: a.categoryIri,
        progressLabelIri: a.progressLabelIri,
        responsibleIris: sorted(a.responsibleIris),
      },
    })
    const k = a.content
    out.push({
      key: `${a.iri}#content`,
      type: 'activityContent',
      label: a.title,
      activityIri: a.iri,
      data: {
        storyboardText: k.storyboardText,
        safetyText: k.safetyText,
        notesText: k.notesText,
        learningObjectivesText: k.learningObjectivesText,
        materialText: k.materialText,
        laThematicAreas: sorted(k.laThematicAreas),
        learningTopics: sorted(k.learningTopics),
        ysCharacteristics: sorted(k.ysCharacteristics),
        ysPhysicalActivityDurationMinutes: k.ysPhysicalActivityDurationMinutes,
      },
    })
  }
  for (const e of facts.scheduleEntries) {
    const title = actTitle.get(e.activityIri) ?? ''
    out.push({
      key: e.iri,
      type: 'scheduleEntry',
      label: `${title} · ${e.start.slice(0, 10)} ${clockOf(e.start)}–${clockOf(e.end)}`.trim(),
      activityIri: e.activityIri,
      data: { activityIri: e.activityIri, dayIri: e.dayIri, start: e.start, end: e.end },
    })
  }
  return out
}

/** Content hashes per entity (camp, periods, days, activities, `${activityIri}#content`, schedule entries, categories). */
export async function snapshotEntities(facts: CampFacts): Promise<Record<string, SnapshotEntity>> {
  const drafts = describeEntities(facts)
  const hashes = await Promise.all(drafts.map((d) => sha256Hex(stableStringify(d.data))))
  const out: Record<string, SnapshotEntity> = {}
  drafts.forEach((d, i) => {
    const fields: Record<string, string> = {}
    for (const [k, v] of Object.entries(d.data)) fields[k] = fastHash(stableStringify(v))
    const ent: SnapshotEntityEx = { type: d.type, label: d.label, hash: hashes[i]!, fields }
    if (d.activityIri) ent.activityIri = d.activityIri
    out[d.key] = ent
  })
  return out
}

export async function createSnapshot(facts: CampFacts, roundId: string, now: Date = new Date()): Promise<Snapshot> {
  return {
    id: crypto.randomUUID(),
    campIri: facts.camp.iri,
    roundId,
    createdAt: now.toISOString(),
    entities: await snapshotEntities(facts),
    facts,
  }
}

// ---------------------------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------------------------

const TYPE_ORDER: SnapshotEntityType[] = ['camp', 'period', 'day', 'category', 'activity', 'scheduleEntry', 'activityContent']

function activityIriOf(key: string, ent: SnapshotEntityEx): Iri | undefined {
  if (ent.activityIri) return ent.activityIri
  if (ent.type === 'activityContent') return key.replace(/#content$/, '')
  if (ent.type === 'activity') return key
  return undefined
}

/** Diff between two entity maps (from = older; null from = everything added). */
export function diffEntities(
  campIri: string,
  from: { roundId: string; entities: Record<string, SnapshotEntity> } | null,
  to: { roundId: string | null; entities: Record<string, SnapshotEntity> },
): Diff {
  const entries: DiffEntry[] = []
  const a = (from?.entities ?? {}) as Record<string, SnapshotEntityEx>
  const b = to.entities as Record<string, SnapshotEntityEx>
  const make = (key: string, ent: SnapshotEntityEx, change: DiffChange, fields?: string[]): DiffEntry => {
    const e: DiffEntry = { key, type: ent.type, label: ent.label, change }
    if (fields) e.fields = fields
    const act = activityIriOf(key, ent)
    if (act && ent.type !== 'activity') e.activityIri = act
    return e
  }
  for (const [key, ent] of Object.entries(b)) {
    const old = a[key]
    if (!old) entries.push(make(key, ent, 'added'))
    else if (old.hash !== ent.hash) {
      const names = new Set([...Object.keys(old.fields ?? {}), ...Object.keys(ent.fields ?? {})])
      const fields = [...names].filter((n) => old.fields?.[n] !== ent.fields?.[n]).sort()
      entries.push(make(key, ent, 'changed', fields))
    }
  }
  for (const [key, ent] of Object.entries(a)) if (!b[key]) entries.push(make(key, ent, 'removed'))
  entries.sort(
    (x, y) =>
      TYPE_ORDER.indexOf(x.type) - TYPE_ORDER.indexOf(y.type) ||
      x.label.localeCompare(y.label, 'de') ||
      x.key.localeCompare(y.key),
  )
  const counts: Record<DiffChange, number> = { added: 0, changed: 0, removed: 0 }
  for (const e of entries) counts[e.change]++
  return { campIri, fromRoundId: from?.roundId ?? null, toRoundId: to.roundId, entries, counts }
}

export function diffIsEmpty(d: Diff | null | undefined): boolean {
  return !d || d.entries.length === 0
}

export interface DiffActivityGroup {
  activityIri: Iri
  title: string
  entries: DiffEntry[]
}

export interface DiffGroups {
  /** Camp, periods, days, categories. */
  general: DiffEntry[]
  /** Activity, its schedule entries and content changes together. */
  activities: DiffActivityGroup[]
}

/** Groups a diff for display: general entries + one group per activity. `titleOf` resolves activity titles. */
export function groupDiff(diff: Diff, titleOf?: (iri: Iri) => string | undefined): DiffGroups {
  const general: DiffEntry[] = []
  const map = new Map<Iri, DiffActivityGroup>()
  for (const e of diff.entries) {
    const iri = e.type === 'activity' ? e.key : e.activityIri
    if (!iri) {
      general.push(e)
      continue
    }
    let g = map.get(iri)
    if (!g) {
      g = { activityIri: iri, title: titleOf?.(iri) ?? '', entries: [] }
      map.set(iri, g)
    }
    if (!g.title && e.type === 'activity') g.title = e.label
    g.entries.push(e)
  }
  const activities = [...map.values()]
  for (const g of activities) if (!g.title) g.title = g.activityIri.split('/').pop() ?? g.activityIri
  activities.sort((x, y) => x.title.localeCompare(y.title, 'de'))
  return { general, activities }
}

// ---------------------------------------------------------------------------------------------
// Review + round planning (pure, used by store.ts)
// ---------------------------------------------------------------------------------------------

/** Returns the new review state; throws RoundsError('invalidTransition'). `prev` null counts as 'neu'. */
export function applyStatusChange(
  prev: ReviewState | null,
  campIri: Iri,
  status: ReviewStatus,
  note: string | null = null,
  now: Date = new Date(),
): ReviewState {
  const from: ReviewStatus = prev?.status ?? 'neu'
  if (!canTransition(from, status)) throw new RoundsError('invalidTransition', `${from} -> ${status}`)
  const at = now.toISOString()
  return {
    campIri,
    status,
    history: [...(prev?.history ?? []), { status, at, note: note?.trim() ? note.trim() : null }],
    updatedAt: at,
  }
}

/** Closes the open round (if any) and creates round n+1. */
export function planNewRound(
  existing: Round[],
  campIri: Iri,
  ids: { roundId: string; snapshotId: string },
  note = '',
  now: Date = new Date(),
): { closed: Round | null; round: Round } {
  const at = now.toISOString()
  const open = existing.filter((r) => !r.closedAt).sort((a, b) => b.number - a.number)[0] ?? null
  const number = existing.reduce((m, r) => Math.max(m, r.number), 0) + 1
  return {
    closed: open ? { ...open, closedAt: at } : null,
    round: {
      id: ids.roundId,
      campIri,
      number,
      startedAt: at,
      closedAt: null,
      snapshotId: ids.snapshotId,
      note,
      exportedAt: null,
    },
  }
}

/** True when a backup should be suggested: reminder enabled and some round was never exported. */
export function exportReminderDue(settings: { remindAfterRound: boolean }, rounds: Round[]): boolean {
  return settings.remindAfterRound && rounds.some((r) => !r.exportedAt)
}
