/**
 * Links into the eCamp web UI (pure).
 *
 * eCamp frontend route (ecamp3 frontend/src/router.js, name 'camp/activity'):
 *   /camps/:campId/:campShortTitle/program/activity/:activityId/:scheduleEntryId?/:activityName?
 * Only the ids are resolved by eCamp; the slug segments are cosmetic. A wrong or missing
 * scheduleEntryId falls back to the activity's first schedule entry.
 */
import type { CampFacts, Iri } from './types'

type LinkFacts = Pick<CampFacts, 'instanceBaseUrl' | 'camp' | 'scheduleEntries' | 'activities'>

const SLUG_CHAR_MAP: Record<string, string> = { ä: 'a', ö: 'o', ü: 'u', Ä: 'A', Ö: 'O', Ü: 'U', ß: 'ss', '&': 'and', '@': '(at)' }

/** Approximation of eCamp's `slugify` (npm slugify + '@'/'.'/':' extensions). Never empty. */
export function ecampSlug(input: string): string {
  const mapped = [...input].map((c) => SLUG_CHAR_MAP[c] ?? c).join('')
  const slug = mapped
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.:]/g, ' ')
    .replace(/[^A-Za-z0-9\s\-_~()]/g, '')
    .trim()
    .replace(/\s+/g, '-')
  return slug === '' ? '-' : slug
}

/** eCamp's campShortTitle without the automatic shorteners: shortTitle or title, max 16 chars. */
function campShortTitle(camp: LinkFacts['camp']): string {
  const s = camp.shortTitle?.trim() ? camp.shortTitle : camp.title
  return (s ?? '').substring(0, 16)
}

function lastSegment(iri: Iri): string {
  return iri.split('/').filter(Boolean).pop() ?? ''
}

/** Base URL must be http(s); returns it without trailing slash, or null. */
function safeBase(base: string | null): string | null {
  if (!base) return null
  try {
    const u = new URL(base)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u.origin + u.pathname.replace(/\/+$/, '')
  } catch {
    return null
  }
}

/** Absolute URL of the activity in eCamp (first schedule entry), or null if unknown. */
export function ecampActivityUrl(facts: LinkFacts, activityIri: Iri): string | null {
  const base = safeBase(facts.instanceBaseUrl)
  const activity = facts.activities.find((a) => a.iri === activityIri)
  if (!base || !activity || !facts.camp.id) return null
  const entry =
    facts.scheduleEntries
      .filter((e) => e.activityIri === activityIri)
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))[0] ?? null
  const parts = [
    'camps',
    encodeURIComponent(facts.camp.id),
    encodeURIComponent(ecampSlug(campShortTitle(facts.camp))),
    'program',
    'activity',
    encodeURIComponent(lastSegment(activity.iri)),
  ]
  if (entry) parts.push(encodeURIComponent(lastSegment(entry.iri)), encodeURIComponent(ecampSlug(activity.title)))
  return `${base}/${parts.join('/')}`
}

/** activityIri -> eCamp URL for every activity with a resolvable link. */
export function activityUrlMap(facts: LinkFacts | null): Record<Iri, string> {
  if (!facts) return {}
  const out: Record<Iri, string> = {}
  for (const a of facts.activities) {
    const url = ecampActivityUrl(facts, a.iri)
    if (url) out[a.iri] = url
  }
  return out
}
