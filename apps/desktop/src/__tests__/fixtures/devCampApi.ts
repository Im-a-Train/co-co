/**
 * Fake ApiGet over the JSON dump of the dev.ecamp3.ch camp "Auf in die Berge" (./dev-camp/*.json).
 * Shared by all tests. Unknown paths reject with an HTTP-404-like Error.
 * Note: the dump has no /api/users or /api/profiles responses (collaborator names fall back).
 */
import type { ApiGet } from '@/domain/types'
import activities from './dev-camp/activities.json'
import activityResponsibles from './dev-camp/activityResponsibles.json'
import camp from './dev-camp/camp.json'
import campCollaborations from './dev-camp/campCollaborations.json'
import categories from './dev-camp/categories.json'
import comments from './dev-camp/comments.json'
import contentNodes from './dev-camp/contentNodes.json'
import contentTypes from './dev-camp/contentTypes.json'
import dayResponsibles from './dev-camp/dayResponsibles.json'
import days from './dev-camp/days.json'
import materialLists from './dev-camp/materialLists.json'
import periods from './dev-camp/periods.json'
import progressLabels from './dev-camp/progressLabels.json'
import scheduleEntries from './dev-camp/scheduleEntries.json'

export const DEV_CAMP_IRI = '/api/camps/70ca971c992f'

export const devCampDump = {
  activities,
  activityResponsibles,
  camp,
  campCollaborations,
  categories,
  comments,
  contentNodes,
  contentTypes,
  dayResponsibles,
  days,
  materialLists,
  periods,
  progressLabels,
  scheduleEntries,
}

const collections: [RegExp, unknown][] = [
  [/^\/api\/periods\?/, periods],
  [/^\/api\/days\?/, days],
  [/^\/api\/day_responsibles\?/, dayResponsibles],
  [/^\/api\/schedule_entries\?/, scheduleEntries],
  [/^\/api\/activities\?/, activities],
  [/^\/api\/activity_responsibles\?/, activityResponsibles],
  [/^\/api\/camp_collaborations\?/, campCollaborations],
  [/^\/api\/categories\?/, categories],
  [/^\/api\/activity_progress_labels\?/, progressLabels],
  [/^\/api\/content_nodes\?/, contentNodes],
  [/^\/api\/content_types/, contentTypes],
  [/^\/api\/comments\?/, comments],
  [/^\/api\/material_lists\?/, materialLists],
]

export interface FakeApi {
  apiGet: ApiGet
  /** Every requested path, in order. */
  calls: string[]
}

export function createDevCampApi(): FakeApi {
  const calls: string[] = []
  const apiGet = (async (path: string) => {
    calls.push(path)
    const clean = decodeURIComponent(path)
    if (clean === DEV_CAMP_IRI) return structuredClone(camp)
    if (clean.startsWith('/api/camps?')) {
      return { _embedded: { items: [structuredClone(camp)] }, totalItems: 1, _links: { self: { href: path } } }
    }
    for (const [re, body] of collections) if (re.test(clean)) return structuredClone(body)
    throw new Error(`HTTP 404 (fake api): ${path}`)
  }) as ApiGet
  return { apiGet, calls }
}
