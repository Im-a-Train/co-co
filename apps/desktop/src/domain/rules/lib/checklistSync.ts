/**
 * Sync between the coach checklist and the deadlines of one camp. Pure.
 *
 * A checklist item with `milestone: <M-ID>` describes the same task as that milestone. While the milestone
 * is part of the camp's deadlines, its done state (CoachInputs.milestonesDone, the same storage as /fristen)
 * is the single truth for the pair and the row shows the milestone's due date + status. Toggling either
 * side yields a plan of writes (milestone first, then checklist state) that the caller runs sequentially
 * (Dexie wrapper is not atomic), so a failure on the second write never leaves the deadline stale.
 */
import type { CampRuleConfig, CoachInputs, Deadline, IsoDate } from '../../types'
import { deadlineStatus, type DeadlineStatus } from './deadlines'
import type { ChecklistItem } from './checklist'

export interface ChecklistRow {
  item: ChecklistItem
  done: boolean
  /** The linked milestone deadline of this camp (null: unlinked, or milestone not active for this camp). */
  deadline: Deadline | null
  status: DeadlineStatus | null
}

/** Rows for the visible items: linked items take done/due/status from the milestone deadline. */
export function buildChecklistRows(
  items: readonly ChecklistItem[],
  state: CampRuleConfig['checklist'],
  milestoneDeadlines: readonly Deadline[],
  today: IsoDate,
): ChecklistRow[] {
  const byId = new Map(milestoneDeadlines.filter((d) => d.milestoneId).map((d) => [d.milestoneId as string, d]))
  return items.map((item) => {
    const deadline = (item.milestone ? byId.get(item.milestone) : undefined) ?? null
    return {
      item,
      done: deadline ? deadline.done : state[item.id]?.done === true,
      deadline,
      status: deadline ? deadlineStatus(deadline, today) : null,
    }
  })
}

export interface SyncPlan {
  /** Write to CoachInputs.milestonesDone (run first). */
  milestone?: { id: string; done: boolean }
  /** Writes to CampRuleConfig.checklist (run second). */
  checklist: { id: string; done: boolean }[]
}

/** Toggling a checklist item: also its milestone when linked. */
export function planItemToggle(item: Pick<ChecklistItem, 'id' | 'milestone'>, done: boolean): SyncPlan {
  return { ...(item.milestone ? { milestone: { id: item.milestone, done } } : {}), checklist: [{ id: item.id, done }] }
}

/** Toggling a milestone: also every checklist item linked to it (visible or not). */
export function planMilestoneToggle(milestoneId: string, done: boolean, allItems: readonly Pick<ChecklistItem, 'id' | 'milestone'>[]): SyncPlan {
  return {
    milestone: { id: milestoneId, done },
    checklist: allItems.filter((i) => i.milestone === milestoneId).map((i) => ({ id: i.id, done })),
  }
}

/** milestonesDone with one milestone set (date = today) or cleared. Returns a new object. */
export function withMilestoneDone(done: Record<string, IsoDate> | undefined, id: string, value: boolean, today: IsoDate): Record<string, IsoDate> {
  const next = { ...(done ?? {}) }
  if (value) next[id] = next[id] ?? today
  else delete next[id]
  return next
}

/** CoachInputs with one deadline marked done/undone, in the storage the deadline radar and «Angaben» use. */
export function withDeadlineDone(inputs: CoachInputs, d: Pick<Deadline, 'kind' | 'milestoneId'>, value: boolean, today: IsoDate): CoachInputs {
  switch (d.kind) {
    case 'pbs-milestone':
      return d.milestoneId ? { ...inputs, milestonesDone: withMilestoneDone(inputs.milestonesDone, d.milestoneId, value, today) } : inputs
    case 'nds-registration':
      return { ...inputs, ndsRegistered: value, ndsRegisteredOn: value ? (inputs.ndsRegisteredOn ?? today) : null }
    case 'nds-closing':
      return { ...inputs, ndsClosed: value, ndsClosedOn: value ? (inputs.ndsClosedOn ?? today) : null }
    case 'leihmaterial':
      return { ...inputs, leihmaterialOrdered: value }
    case 'landeskarten':
      return { ...inputs, landeskartenOrdered: value }
    case 'lagerbewilligung':
      return { ...inputs, lagerbewilligungDone: value }
    default:
      return inputs
  }
}
