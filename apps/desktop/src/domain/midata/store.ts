/**
 * Dexie access for the `midata` table (M7). Records are tagged `zone: 'red-derived'`.
 */
import type { Iri, MidataAggregate, MidataRecord } from '../types'
import { getDb, type CocoDb } from '../storage/db'

const now = () => new Date().toISOString()

export async function getMidataRecord(campIri: Iri, db: CocoDb = getDb()): Promise<MidataRecord | null> {
  return (await db.midata.get(campIri)) ?? null
}

/** Links the camp to a MiData event. Changing the event drops a stored aggregate of another event. */
export async function saveMidataLink(campIri: Iri, eventId: string, source: 'ecamp' | 'manual', db: CocoDb = getDb()): Promise<MidataRecord> {
  const prev = await getMidataRecord(campIri, db)
  const keep = prev?.aggregate && prev.eventId === eventId ? prev.aggregate : null
  const rec: MidataRecord = { campIri, zone: 'red-derived', eventId, eventSource: source, aggregate: keep, updatedAt: now() }
  await db.midata.put(rec)
  return rec
}

export async function saveMidataAggregate(campIri: Iri, aggregate: MidataAggregate, db: CocoDb = getDb()): Promise<MidataRecord> {
  const prev = await getMidataRecord(campIri, db)
  if (prev?.eventId && prev.eventId !== aggregate.eventId)
    throw new Error('Die MiData-Daten gehören zu einem anderen Anlass als die gespeicherte Verknüpfung.')
  const rec: MidataRecord = {
    campIri,
    zone: 'red-derived',
    eventId: prev?.eventId ?? aggregate.eventId,
    eventSource: prev?.eventSource ?? 'manual',
    aggregate,
    updatedAt: now(),
  }
  await db.midata.put(rec)
  return rec
}

/** Removes link + aggregate of a camp. */
export async function clearMidata(campIri: Iri, db: CocoDb = getDb()): Promise<void> {
  await db.midata.delete(campIri)
}
