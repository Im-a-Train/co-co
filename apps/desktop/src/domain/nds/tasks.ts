/**
 * NDS «Pendenzen» as deadlines for the Fristen radar (RED ZONE: held in memory only, never
 * persisted, never handed to MCP or AI). Pure; the tasks come from `commands.ndsFetchTasks`.
 */
import type { NdsTask } from '@/lib/tauri'
import type { Deadline, IsoDate } from '../types'

/** `processingStatus` values that mean the task is finished (upper-cased compare). Single place. */
export const NDS_TASK_DONE_STATES: readonly string[] = ['DONE', 'CLOSED', 'COMPLETED', 'FINISHED']

export function isNdsTaskDone(status: string | null | undefined): boolean {
  return !!status && NDS_TASK_DONE_STATES.includes(status.trim().toUpperCase())
}

export interface NdsTaskLabels {
  /** Suffix mentioning the escalation date, e.g. `(Eskalation 15.08.2026)`. */
  escalation: (isoDate: IsoDate) => string
}

/** One deadline per task that has a due date; `today` is unused for now but keeps the call sites uniform. */
export function ndsTasksToDeadlines(tasks: readonly NdsTask[], _today: IsoDate, labels?: NdsTaskLabels): Deadline[] {
  const out: Deadline[] = []
  for (const t of tasks) {
    if (!t.dueDate) continue
    const suffix = t.escalationDate && labels ? ` ${labels.escalation(t.escalationDate)}` : ''
    out.push({
      campIri: `nds:${t.businessId}`,
      campTitle: t.correlationTitle ?? 'NDS',
      kind: 'nds-task',
      due: t.dueDate,
      done: isNdsTaskDone(t.processingStatus),
      ruleId: null,
      source: null,
      title: `${t.title}${suffix}`,
      audience: 'coach',
    })
  }
  return out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.title!.localeCompare(b.title!)))
}
