/**
 * Coach corrections of the safety-area detection («keine Wasser-Aktivität»), per camp and activity.
 * Green data (only activity iris + area names); stored in the Dexie `settings` table under `midata.areaOverrides`.
 */
import type { Iri } from '../types'
import { getDb, type CocoDb } from '../storage/db'
import type { SafetyArea } from './index'

export const AREA_OVERRIDES_KEY = 'midata.areaOverrides'

export type CampAreaOverrides = Record<string, SafetyArea[]>
type AllOverrides = Record<Iri, CampAreaOverrides>

const AREAS: readonly string[] = ['wasser', 'berg', 'winter']

/** Pure: returns the overrides with `area` dismissed (dismissed = true) or restored for the activity. */
export function setAreaDismissed(prev: CampAreaOverrides, activityIri: string, area: SafetyArea, dismissed: boolean): CampAreaOverrides {
  const current = prev[activityIri] ?? []
  const nextAreas = dismissed ? [...new Set([...current, area])] : current.filter((a) => a !== area)
  const next = { ...prev }
  if (nextAreas.length) next[activityIri] = nextAreas
  else delete next[activityIri]
  return next
}

function clean(raw: unknown): AllOverrides {
  const out: AllOverrides = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [camp, per] of Object.entries(raw as Record<string, unknown>)) {
    if (!per || typeof per !== 'object') continue
    const c: CampAreaOverrides = {}
    for (const [iri, areas] of Object.entries(per as Record<string, unknown>)) {
      if (Array.isArray(areas)) {
        const ok = areas.filter((a): a is SafetyArea => typeof a === 'string' && AREAS.includes(a))
        if (ok.length) c[iri] = ok
      }
    }
    out[camp] = c
  }
  return out
}

export async function getAreaOverrides(campIri: Iri, db: CocoDb = getDb()): Promise<CampAreaOverrides> {
  const rec = await db.settings.get(AREA_OVERRIDES_KEY)
  return clean(rec?.value)[campIri] ?? {}
}

export async function saveAreaOverrides(campIri: Iri, overrides: CampAreaOverrides, db: CocoDb = getDb()): Promise<void> {
  const rec = await db.settings.get(AREA_OVERRIDES_KEY)
  const all = clean(rec?.value)
  if (Object.keys(overrides).length) all[campIri] = overrides
  else delete all[campIri]
  await db.settings.put({ key: AREA_OVERRIDES_KEY, value: all })
}
