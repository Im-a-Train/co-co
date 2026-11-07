/**
 * Dexie access for the `nds` table (M8). Records are tagged `zone: 'red-derived'`.
 */
import type { Iri, NdsAggregate, NdsRecord } from '../types'
import { getDb, type CocoDb } from '../storage/db'

const now = () => new Date().toISOString()

export async function getNdsRecord(campIri: Iri, db: CocoDb = getDb()): Promise<NdsRecord | null> {
  return (await db.nds.get(campIri)) ?? null
}

/** Links the camp to an NDS camp. Changing the link drops a stored aggregate of another camp. */
export async function saveNdsLink(
  campIri: Iri,
  link: { offerBusinessId: string; campBusinessId: string },
  db: CocoDb = getDb(),
): Promise<NdsRecord> {
  const prev = await getNdsRecord(campIri, db)
  const same = prev?.link?.campBusinessId === link.campBusinessId && prev.link.offerBusinessId === link.offerBusinessId
  const keep = same ? prev!.aggregate : null
  const rec: NdsRecord = {
    campIri,
    zone: 'red-derived',
    link: { offerBusinessId: link.offerBusinessId, campBusinessId: link.campBusinessId },
    aggregate: keep,
    fetchedAt: keep ? prev!.fetchedAt : null,
    updatedAt: now(),
  }
  await db.nds.put(rec)
  return rec
}

export async function saveNdsAggregate(campIri: Iri, aggregate: NdsAggregate, db: CocoDb = getDb()): Promise<NdsRecord> {
  const prev = await getNdsRecord(campIri, db)
  if (prev?.link && prev.link.campBusinessId !== aggregate.campBusinessId)
    throw new Error('Die NDS-Daten gehören zu einem anderen Lager als die gespeicherte Verknüpfung.')
  const rec: NdsRecord = {
    campIri,
    zone: 'red-derived',
    link: prev?.link ?? { offerBusinessId: aggregate.offerBusinessId, campBusinessId: aggregate.campBusinessId },
    aggregate,
    fetchedAt: aggregate.fetchedAt,
    updatedAt: now(),
  }
  await db.nds.put(rec)
  return rec
}

/** Removes link + aggregate of a camp. */
export async function clearNds(campIri: Iri, db: CocoDb = getDb()): Promise<void> {
  await db.nds.delete(campIri)
}
