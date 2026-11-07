/**
 * Dexie access for the `midata` table (M7). Records are tagged `zone: 'red-derived'`.
 * CONTRACT (M7): signatures are used by useFindings and useMidata. Implement the bodies.
 */
import type { Iri, MidataAggregate, MidataRecord } from '../types'
import type { CocoDb } from '../storage/db'

export async function getMidataRecord(campIri: Iri, db?: CocoDb): Promise<MidataRecord | null> {
  void campIri
  void db
  throw new Error('M7: not implemented')
}

/** Links the camp to a MiData event. Changing the event drops a stored aggregate of another event. */
export async function saveMidataLink(campIri: Iri, eventId: string, source: 'ecamp' | 'manual', db?: CocoDb): Promise<MidataRecord> {
  void campIri
  void eventId
  void source
  void db
  throw new Error('M7: not implemented')
}

export async function saveMidataAggregate(campIri: Iri, aggregate: MidataAggregate, db?: CocoDb): Promise<MidataRecord> {
  void campIri
  void aggregate
  void db
  throw new Error('M7: not implemented')
}

/** Removes link + aggregate of a camp. */
export async function clearMidata(campIri: Iri, db?: CocoDb): Promise<void> {
  void campIri
  void db
  throw new Error('M7: not implemented')
}
