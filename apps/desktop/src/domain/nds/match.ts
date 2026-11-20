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

const STOP_WORDS = new Set([
  'lager', 'sola', 'pfila', 'hela', 'herbstlager', 'sommerlager', 'winterlager', 'pfingstlager', 'abteilung', 'pfadi',
  'stufe', 'camp', 'jahr', 'der', 'die', 'das', 'und', 'von', 'des', 'pfadfinder', 'pfadfinderinnen', 'scouts', 'scout',
])

/** Lowercase, umlauts -> ae/oe/ue, punctuation stripped, tokens < 3 chars, stop words and years dropped. */
function tokens(...parts: Array<string | null | undefined>): Set<string> {
  const text = parts
    .filter((p): p is string => !!p)
    .join(' ')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  const out = new Set<string>()
  for (const t of text.split(/[^a-z0-9]+/)) {
    if (t.length < 3 || STOP_WORDS.has(t) || /^(19|20)\d\d$/.test(t)) continue
    out.add(t)
  }
  return out
}

const normOrg = (s: string | null | undefined): string => [...tokens(s)].join(' ')

const DAY = 86_400_000
const dayNum = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY

/**
 * Scores every candidate and returns them sorted by score (desc), then start date, then group name.
 * `orgNames` are the coach's own organisation names (NdsCoachProfile), used as a bonus signal when
 * a candidate's organisationName matches one of them.
 */
export function rankNdsCamps(camp: NdsMatchCamp, candidates: NdsCampSummary[], orgNames: string[] = []): RankedNdsCamp[] {
  const campTokens = tokens(camp.title, camp.shortTitle, camp.organizer)
  const orgs = orgNames.map(normOrg).filter((o) => o.length > 0)
  const cs = camp.start ? dayNum(camp.start) : NaN
  const ce = camp.end ? dayNum(camp.end) : NaN

  const scored = candidates.map((c) => {
    let score = 0
    const reasons: NdsMatchReason[] = []

    if (camp.start && camp.end && c.start && c.end && !Number.isNaN(cs + ce)) {
      const ns = dayNum(c.start)
      const ne = dayNum(c.end)
      if (c.start.slice(0, 10) === camp.start.slice(0, 10) && c.end.slice(0, 10) === camp.end.slice(0, 10)) {
        score += 0.55
        reasons.push('sameDates')
      } else {
        const overlap = Math.min(ce, ne) - Math.max(cs, ns) + 1
        if (overlap > 0) {
          const len = Math.max(ce - cs + 1, ne - ns + 1)
          score += (0.35 * overlap) / len
          reasons.push('overlapDates')
        }
      }
    }

    const candTokens = tokens(c.groupName, c.organisationName)
    let shared = 0
    for (const t of candTokens) if (campTokens.has(t)) shared++
    if (shared > 0) {
      score += (0.3 * shared) / (candTokens.size + campTokens.size - shared)
      reasons.push('nameMatch')
    }

    // Token-wise: every token of one of the coach's organisations appears in the candidate's organisation
    // (no raw substring match, so «Pfadi Bern» does not match «Pfadi Bernstein»).
    const orgTokens = tokens(c.organisationName)
    if (orgTokens.size > 0 && orgs.some((o) => o.split(' ').every((t) => orgTokens.has(t)))) {
      score += 0.15
      reasons.push('organisation')
    }

    return { camp: c, score: Math.min(1, Math.max(0, score)), reasons, suggested: false }
  })

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.camp.start ?? '9999').localeCompare(b.camp.start ?? '9999') ||
      (a.camp.groupName ?? '').localeCompare(b.camp.groupName ?? ''),
  )
  const top = scored[0]
  if (top && top.score >= SUGGEST_MIN_SCORE && top.score - (scored[1]?.score ?? 0) >= SUGGEST_MIN_MARGIN) top.suggested = true
  return scored
}
