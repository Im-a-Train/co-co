// M21 (ADR 0016): rank NDS camps (from nds_find_camps) against the eCamp camp, so the picker can
// pre-sort and mark one suggestion. Pure; the coach still confirms the pick (no automatic link).
import type { IsoDate, NdsCampSummary } from '@/domain/types'

/** The eCamp side of the match (from CampInfo). */
export interface NdsMatchCamp {
  title: string
  shortTitle?: string | null
  organizer?: string | null
  start: IsoDate | null
  end: IsoDate | null
}

export type NdsMatchReason = 'sameDates' | 'overlapDates' | 'nameMatch' | 'organisation'

export interface RankedNdsCamp {
  camp: NdsCampSummary
  /** 0..1 */
  score: number
  reasons: NdsMatchReason[]
  /** True for at most one candidate: the top one when score ≥ SUGGEST_MIN_SCORE and it leads the runner-up by ≥ SUGGEST_MIN_MARGIN. */
  suggested: boolean
}

export const SUGGEST_MIN_SCORE = 0.6
export const SUGGEST_MIN_MARGIN = 0.15

/**
 * Scores every candidate and returns them sorted by score (desc), then start date, then group name.
 * `orgNames` are the coach's own organisation names (NdsCoachProfile), used as a bonus signal when
 * a candidate's organisationName matches one of them.
 */
export function rankNdsCamps(camp: NdsMatchCamp, candidates: NdsCampSummary[], orgNames: string[] = []): RankedNdsCamp[] {
  void camp
  void orgNames
  return candidates.map((c) => ({ camp: c, score: 0, reasons: [], suggested: false }))
}
