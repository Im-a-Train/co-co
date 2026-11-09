import type { ActivityFact, GpxStats } from '@/domain/types'
import { CAMP, makeDoc } from '../factory'

export const ids = (hits: { targets: string[] }[]) => hits.map((h) => h.targets.join('|'))

/** GPX stats of a route (Lkm = km + ascent/100). */
export function gpx(km: number, ascentM = 0, descentM = 0): GpxStats {
  return {
    name: 'Route',
    pointCount: 10,
    distanceKm: km,
    ascentM,
    descentM,
    lkm: km + ascentM / 100,
    lkmWithDescent: km + ascentM / 100 + descentM / 150,
    paceLkmPerHour: 4,
    estimatedMinutes: 0,
    highestPointM: null,
    lowestPointM: null,
  }
}

export const gpxDoc = (a: ActivityFact, stats: GpxStats, id = 'g1') =>
  makeDoc({ id, campIri: CAMP, name: 'route.gpx', kind: 'gpx', activityIris: [a.iri], gpx: stats })
