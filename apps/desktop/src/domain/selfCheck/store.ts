/** Persistence of self-check runs (table `selfChecks`) and their snapshots (table `snapshots`). */
import { getDb, newId } from '../storage/db'
import { createSnapshot } from '../rounds'
import type { CampFacts, Iri, SelfCheckRun } from '../types'
import { planSelfCheckRun } from './index'

/** Newest first. */
export async function listSelfChecks(campIri: Iri): Promise<SelfCheckRun[]> {
  const rows = await getDb().selfChecks.where('campIri').equals(campIri).toArray()
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

export async function saveSelfCheck(run: SelfCheckRun): Promise<void> {
  await getDb().selfChecks.put(run)
}

/** Deletes the run and its snapshot. */
export async function deleteSelfCheck(id: string): Promise<void> {
  const db = getDb()
  await db.transaction('rw', db.selfChecks, db.snapshots, async () => {
    const run = await db.selfChecks.get(id)
    if (run?.snapshotId) await db.snapshots.delete(run.snapshotId)
    await db.selfChecks.delete(id)
  })
}

/** Snapshots `facts` (roundId `selfcheck:<id>`) and saves the run. Not a review round. */
export async function createSelfCheckRun(
  facts: CampFacts,
  input: Omit<Parameters<typeof planSelfCheckRun>[0], 'id' | 'campIri' | 'snapshotId' | 'now'>,
  now: Date = new Date(),
): Promise<SelfCheckRun> {
  const db = getDb()
  const id = newId()
  const snapshot = await createSnapshot(facts, 'selfcheck:' + id, now)
  const run = planSelfCheckRun({ ...input, id, campIri: facts.camp.iri, snapshotId: snapshot.id, now: now.toISOString() })
  await db.transaction('rw', db.selfChecks, db.snapshots, async () => {
    await db.snapshots.put(snapshot)
    await db.selfChecks.put(run)
  })
  return run
}
