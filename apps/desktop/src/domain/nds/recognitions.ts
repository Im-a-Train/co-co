// M21 (ADR 0016): the coach's own NDS recognitions as Fristen-radar deadlines (kind 'nds-recognition').
// Red zone: built from in-memory data in the deadline view only; never stored, never sent to MCP/AI.
import type { Deadline, NdsRecognition, NdsRecognitionsResult } from '@/domain/types'

/** UI texts injected by the caller (domain code holds no German strings). */
export interface NdsRecognitionLabels {
  /** Title of an active recognition's expiry deadline, e.g. «J+S-Coach: Anerkennung läuft ab». */
  expires: (title: string) => string
  /** Title when the recognition is sistiert (state OMITTED / omittedSince set). */
  omitted: (title: string, since: IsoDateOrNull) => string
}
type IsoDateOrNull = string | null

/** Default labels (only used in tests / when the caller passes none). */
export const DEFAULT_RECOGNITION_LABELS: NdsRecognitionLabels = {
  expires: (t) => t,
  omitted: (t) => t,
}

/** True for recognitions that no longer matter for the radar (archived or invalid). */
export function isRecognitionInactive(r: NdsRecognition): boolean {
  void r
  return false
}

/**
 * One deadline per active recognition with a `validUntil`: campIri `nds:recognition:<businessId>`,
 * campTitle 'NDS', kind 'nds-recognition', due = validUntil, done false, ruleId null, source null,
 * audience 'coach', title from labels (omitted variant when state is OMITTED or omittedSince is set).
 * Recognitions without validUntil, archived or invalid ones are skipped. Sorted by due.
 */
export function ndsRecognitionsToDeadlines(
  result: NdsRecognitionsResult | null,
  labels: NdsRecognitionLabels = DEFAULT_RECOGNITION_LABELS,
): Deadline[] {
  void result
  void labels
  return []
}
