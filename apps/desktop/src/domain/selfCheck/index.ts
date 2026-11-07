/**
 * Leader self-check («Entwurfsrunde»). Pure.
 *
 * The same rules run for the Lagerleitung before they submit to the coach. A run stores the open
 * findings; the next run (or the coach's review) shows what was fixed since.
 */
import type { CampFacts, CollaboratorRole, Finding, FindingCounts, Iri, IsoDateTime, SelfCheckFinding, SelfCheckRun } from '../types'

/** Leaders (role member / manager) see the self-check as their main view; guests are coaches. */
export function isLeaderRole(role: CollaboratorRole | null | undefined): boolean {
  void role
  throw new Error('not implemented')
}

/** Open findings (no override, origin 'rule') as SelfCheckFinding; redDerived from tags midata / nds-quelle. */
export function toSelfCheckFindings(findings: Finding[]): SelfCheckFinding[] {
  void findings
  throw new Error('not implemented')
}

export function planSelfCheckRun(input: {
  id: string
  campIri: Iri
  by: SelfCheckRun['by']
  snapshotId: string | null
  note: string
  counts: FindingCounts
  validJsDays: number | null
  totalDays: number | null
  findings: Finding[]
  now: IsoDateTime
}): SelfCheckRun {
  void input
  throw new Error('not implemented')
}

export interface SelfCheckProgress {
  /** In the previous run, no longer present now. */
  fixed: SelfCheckFinding[]
  /** In both. */
  remaining: SelfCheckFinding[]
  /** New since the previous run. */
  added: SelfCheckFinding[]
}

/** Compares a previous run with the current open findings (by finding id). */
export function compareWithRun(previous: SelfCheckRun | null, current: Finding[]): SelfCheckProgress {
  void [previous, current]
  throw new Error('not implemented')
}

export interface SelfCheckReportOptions {
  /** Include findings that quote MiData/NDS (default false: the report may leave the coach's machine). */
  includeRedDerived?: boolean
  /** eCamp base URL for activity links (null = no links). */
  instanceBaseUrl: string | null
  now: Date
}

/**
 * Plain-text report (German) for the Lagerleitung: header with camp + date + counts + J+S days,
 * then findings grouped Muss / Soll / Hinweis, each with activity label («Nr. Titel») and eCamp link,
 * then «Behoben seit letztem Selbstcheck» when `progress` is given. Ready for the clipboard.
 */
export function renderSelfCheckReport(
  facts: CampFacts,
  findings: Finding[],
  jsDays: { valid: number; total: number } | null,
  progress: SelfCheckProgress | null,
  opts: SelfCheckReportOptions,
): string {
  void [facts, findings, jsDays, progress, opts]
  throw new Error('not implemented')
}
