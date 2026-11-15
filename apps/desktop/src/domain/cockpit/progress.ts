/**
 * Review progress of a camp (Übersicht): ordered steps with a weighted percentage. Pure, no Vue.
 * Labels live under `cockpit.overview.progress.step.<key>`, hints under `cockpit.overview.progress.hint.<key>`.
 */
import type { CampProgressSummary, IsoDateTime, ReviewStatus } from '../types'
import type { ApprovalBlockers } from '../rounds'

export interface ReviewProgressInput {
  reviewStatus: ReviewStatus | null
  mappingConfirmed: boolean
  /** Inputs the coach still has to give (open coach-todo findings); the step is done at 0. */
  missingInputs: number
  /** Rule modules in state 'suggested'; the mapping step is done only when none is left. */
  suggestedModules: string[]
  /** Findings (rules + manual) that have been looked at / all findings; coach todos are excluded by the caller. */
  triage: { done: number; total: number }
  manualFindingCount: number
  /** `reviewed` counts documents per `isDocumentReviewed`. */
  documents: { total: number; reviewed: number }
  checklist: { done: number; total: number }
  feedback: { total: number; draft: number; posted: number; sent: number }
  rounds: number
}

export type ReviewStepKey = 'mapping' | 'inputs' | 'triage' | 'documents' | 'checklist' | 'feedback' | 'status'

export interface ReviewProgressStep {
  key: ReviewStepKey
  labelKey: string
  done: boolean
  value: number
  total: number
  hintKey?: string
}

export interface ReviewProgress {
  /** 0..100, weighted average of the step fractions. */
  percent: number
  steps: ReviewProgressStep[]
}

/** Weight of each step in the percentage (sums to 100). */
export const REVIEW_STEP_WEIGHTS: Record<ReviewStepKey, number> = {
  mapping: 15,
  inputs: 10,
  triage: 25,
  documents: 10,
  checklist: 10,
  feedback: 15,
  status: 15,
}

/**
 * A document counts as reviewed when the coach did anything with it: it has a document check result,
 * a manual finding points at it, or it is linked to at least one activity.
 */
export function isDocumentReviewed(
  doc: { docCheck: unknown | null; activityIris: readonly string[] },
  manualFindingCount: number,
): boolean {
  return doc.docCheck != null || manualFindingCount > 0 || doc.activityIris.length > 0
}

function ratio(done: number, total: number): number {
  return total <= 0 ? 0 : Math.min(1, Math.max(0, done / total))
}

export function reviewProgress(input: ReviewProgressInput): ReviewProgress {
  const { triage, documents, checklist, feedback } = input
  const approved = input.reviewStatus === 'bewilligt' || input.reviewStatus === 'bewilligt_mit_auflagen'
  const changesRequested = input.reviewStatus === 'aenderungen_angefragt'
  const feedbackSettled = feedback.posted + feedback.sent

  const mappingDone = input.mappingConfirmed && input.suggestedModules.length === 0
  const inputsDone = input.missingInputs <= 0

  // Nothing to triage / nothing to tick off counts as done; no documents or no feedback does not.
  const triageDone = triage.total === 0 || triage.done >= triage.total
  const documentsDone = documents.total > 0 && documents.reviewed >= documents.total
  const checklistDone = checklist.total === 0 || checklist.done >= checklist.total

  const defs: { key: ReviewStepKey; done: boolean; fraction: number; value: number; total: number }[] = [
    { key: 'mapping', done: mappingDone, fraction: mappingDone ? 1 : 0, value: mappingDone ? 1 : 0, total: 1 },
    { key: 'inputs', done: inputsDone, fraction: inputsDone ? 1 : 0, value: inputsDone ? 1 : 0, total: 1 },
    { key: 'triage', done: triageDone, fraction: triageDone ? 1 : ratio(triage.done, triage.total), value: triage.done, total: triage.total },
    { key: 'documents', done: documentsDone, fraction: ratio(documents.reviewed, documents.total), value: documents.reviewed, total: documents.total },
    { key: 'checklist', done: checklistDone, fraction: checklistDone ? 1 : ratio(checklist.done, checklist.total), value: checklist.done, total: checklist.total },
    // Feedback: half for having any item, the other half for what is already posted/sent.
    {
      key: 'feedback',
      done: feedback.total > 0,
      fraction: feedback.total > 0 ? 0.5 + 0.5 * ratio(feedbackSettled, feedback.total) : 0,
      value: feedbackSettled,
      total: feedback.total,
    },
    { key: 'status', done: approved, fraction: approved ? 1 : changesRequested ? 0.5 : 0, value: approved ? 1 : 0, total: 1 },
  ]

  let percent = 0
  for (const d of defs) percent += REVIEW_STEP_WEIGHTS[d.key] * d.fraction
  const nextOpen = defs.find((d) => !d.done)?.key

  return {
    percent: Math.round(percent),
    steps: defs.map((d) => ({
      key: d.key,
      labelKey: `cockpit.overview.progress.step.${d.key}`,
      done: d.done,
      value: d.value,
      total: d.total,
      ...(d.key === nextOpen ? { hintKey: `cockpit.overview.progress.hint.${d.key}` } : {}),
    })),
  }
}

/** Route name (router/index.ts) where each step is worked on. */
export const REVIEW_STEP_ROUTES: Record<ReviewStepKey, string> = {
  mapping: 'camp-grid',
  inputs: 'camp-inputs',
  triage: 'camp-findings',
  documents: 'camp-documents',
  checklist: 'camp-checklist',
  feedback: 'camp-feedback',
  status: 'camp-rounds',
}

export type ReviewVerdict =
  | { kind: 'approved'; at: IsoDateTime | null }
  | { kind: 'blocked'; blockers: ApprovalBlockers }
  | { kind: 'ready' }
  | { kind: 'waiting' }

/** One-line verdict on top of the Übersicht. */
export function reviewVerdict(input: {
  blockers: ApprovalBlockers
  reviewStatus: ReviewStatus | null
  approvedAt: IsoDateTime | null
}): ReviewVerdict {
  const { reviewStatus, blockers } = input
  if (reviewStatus === 'bewilligt' || reviewStatus === 'bewilligt_mit_auflagen') return { kind: 'approved', at: input.approvedAt }
  if (reviewStatus === 'aenderungen_angefragt') return { kind: 'waiting' }
  return blockers.any ? { kind: 'blocked', blockers } : { kind: 'ready' }
}

/** Snapshot stored on the camp summary record for «Meine Lager». */
export function toCampProgressSummary(
  progress: ReviewProgress,
  extra: { triageOpen: number; openMust: number },
  now: Date = new Date(),
): CampProgressSummary {
  return {
    percent: progress.percent,
    nextStep: progress.steps.find((s) => !s.done)?.key ?? null,
    triageOpen: extra.triageOpen,
    openMust: extra.openMust,
    updatedAt: now.toISOString(),
  }
}
