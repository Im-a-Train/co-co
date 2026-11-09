/**
 * Per-camp hidden default points ("Standard-Themen") in the settings table (key 'feedback.hiddenGeneralPoints',
 * value Record<campIri, string[]>; no schema change, covered by backups). Hiding never touches feedback items.
 */
import { getDb, type CocoDb } from '../storage/db'
import type { Iri } from '../types'

export const HIDDEN_GENERAL_POINTS_KEY = 'feedback.hiddenGeneralPoints'

type All = Record<string, string[]>

function clean(raw: unknown): All {
  const out: All = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [camp, ids] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(ids)) out[camp] = [...new Set(ids.filter((x): x is string => typeof x === 'string'))]
  }
  return out
}

export async function getHiddenGeneralPoints(campIri: Iri, db: CocoDb = getDb()): Promise<string[]> {
  const rec = await db.settings.get(HIDDEN_GENERAL_POINTS_KEY)
  return clean(rec?.value)[campIri] ?? []
}

async function mutate(campIri: Iri, fn: (ids: string[]) => string[], db: CocoDb): Promise<string[]> {
  return db.transaction('rw', db.settings, async () => {
    const all = clean((await db.settings.get(HIDDEN_GENERAL_POINTS_KEY))?.value)
    const next = fn(all[campIri] ?? [])
    if (next.length) all[campIri] = next
    else delete all[campIri]
    await db.settings.put({ key: HIDDEN_GENERAL_POINTS_KEY, value: all })
    return next
  })
}

export const hideGeneralPoint = (campIri: Iri, pointId: string, db: CocoDb = getDb()) =>
  mutate(campIri, (ids) => (ids.includes(pointId) ? ids : [...ids, pointId]), db)

export const restoreAllGeneralPoints = (campIri: Iri, db: CocoDb = getDb()) => mutate(campIri, () => [], db)
