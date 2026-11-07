/** Mapping of eCamp camp / period / activity HAL resources to view models. */
import { embeddedList, linkHref, selfHref, str, type HalResource } from './hal'

export interface PeriodSummary {
  description: string | null
  start: string | null
  end: string | null
}

export interface CampSummary {
  iri: string
  title: string
  shortTitle: string | null
  motto: string | null
  coachName: string | null
  periods: PeriodSummary[] | null
  periodsHref: string | null
}

export function toPeriod(p: HalResource): PeriodSummary {
  return { description: str(p, 'description'), start: str(p, 'start'), end: str(p, 'end') }
}

export function toCampSummary(camp: HalResource): CampSummary | null {
  const iri = selfHref(camp) ?? (typeof camp.id === 'string' ? `/api/camps/${camp.id}` : null)
  if (!iri) return null
  const embeddedPeriods = camp._embedded && 'periods' in camp._embedded ? embeddedList(camp, 'periods') : null
  return {
    iri,
    title: str(camp, 'title') ?? str(camp, 'shortTitle') ?? iri,
    shortTitle: str(camp, 'shortTitle'),
    motto: str(camp, 'motto'),
    coachName: str(camp, 'coachName'),
    periods: embeddedPeriods ? embeddedPeriods.map(toPeriod) : null,
    periodsHref: linkHref(camp, 'periods'),
  }
}

/** Formats an ISO date (YYYY-MM-DD...) as dd.mm.yyyy; returns the input if unparsable. */
export function formatDateCh(value: string | null): string {
  if (!value) return '–'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value
}

export function formatPeriodRange(p: PeriodSummary): string {
  return `${formatDateCh(p.start)} – ${formatDateCh(p.end)}`
}

/** Builds the activities query of the contract: /api/activities?camp=<campIri>. */
/** Camps the given user collaborates on (any role, incl. guest). eCamp rejects an unfiltered /api/camps. */
export function campsPath(userIri: string): string {
  return `/api/camps?campCollaborator=${encodeURIComponent(userIri)}`
}

export function activitiesPath(campIri: string): string {
  return `/api/activities?camp=${campIri}`
}
