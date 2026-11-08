/**
 * Per-camp rule configuration (Dexie table `campRuleConfig`, zone green; catalog v2 §3.8).
 * Pure parts: defaultCampRuleConfig, normalizeCampRuleConfig. Persistence: get/put (IndexedDB).
 */
import { getDb, nowIso, type CocoDb } from '../storage/db'
import type { CampRuleConfig, Iri } from '../types'
import { defaultCampRuleConfig, normalizeCampRuleConfig } from './lib/campRuleConfig'

export { defaultCampRuleConfig, normalizeCampRuleConfig }

/** Stored record or null (no record = all defaults). */
export async function getCampRuleConfig(campIri: Iri, db: CocoDb = getDb()): Promise<CampRuleConfig | null> {
  const rec = await db.campRuleConfig.get(campIri)
  return rec ? normalizeCampRuleConfig(rec, campIri) : null
}

export async function putCampRuleConfig(config: CampRuleConfig, db: CocoDb = getDb()): Promise<CampRuleConfig> {
  const rec = { ...normalizeCampRuleConfig(config, config.campIri), updatedAt: nowIso() }
  await db.campRuleConfig.put(rec)
  return rec
}

/** Read-modify-write helper (creates the default record when none exists). */
export async function updateCampRuleConfig(
  campIri: Iri,
  fn: (c: CampRuleConfig) => CampRuleConfig,
  db: CocoDb = getDb(),
): Promise<CampRuleConfig> {
  return db.transaction('rw', db.campRuleConfig, async () => {
    const current = (await getCampRuleConfig(campIri, db)) ?? defaultCampRuleConfig(campIri)
    return putCampRuleConfig(fn(current), db)
  })
}

/** All stored records (e.g. for the deadline radar over all camps). */
export async function listCampRuleConfigs(db: CocoDb = getDb()): Promise<CampRuleConfig[]> {
  return (await db.campRuleConfig.toArray()).map((r) => normalizeCampRuleConfig(r, r.campIri))
}
