/** Persistence of reviews, rounds, snapshots (tables `reviews`, `rounds`, `snapshots`). */
import { getDb, newId } from '../storage/db'
import type { CampFacts, Iri, ReviewState, ReviewStatus, Round, Snapshot } from '../types'
import { RoundsError, applyStatusChange, createSnapshot, planNewRound } from './index'

export function getReview(campIri: Iri): Promise<ReviewState | null> {
  return getDb()
    .reviews.get(campIri)
    .then((r) => r ?? null)
}

/** All review states (for "Meine Lager"). */
export function listReviews(): Promise<ReviewState[]> {
  return getDb().reviews.toArray()
}

/** Validates the transition (canTransition) and appends to history. */
export async function setReviewStatus(campIri: Iri, status: ReviewStatus, note?: string | null): Promise<ReviewState> {
  const db = getDb()
  return db.transaction('rw', db.reviews, async () => {
    const next = applyStatusChange((await db.reviews.get(campIri)) ?? null, campIri, status, note ?? null)
    await db.reviews.put(next)
    return next
  })
}

export async function listRounds(campIri: Iri): Promise<Round[]> {
  const rows = await getDb().rounds.where('campIri').equals(campIri).toArray()
  return rows.sort((a, b) => a.number - b.number)
}

/** Rounds of all camps (backup reminder). */
export function listAllRounds(): Promise<Round[]> {
  return getDb().rounds.toArray()
}

/** Closes the open round (if any), creates round n+1 with a snapshot of `facts`. */
export async function startRound(facts: CampFacts, note = ''): Promise<Round> {
  const db = getDb()
  const campIri = facts.camp.iri
  const roundId = newId()
  const snapshot = await createSnapshot(facts, roundId)
  // Not atomic (see CocoDb.transaction): order the writes so a failure never leaves a half round.
  // snapshot -> new round row -> close the previous round; on failure undo what was written.
  return db.transaction('rw', db.rounds, db.snapshots, async () => {
    const existing = await db.rounds.where('campIri').equals(campIri).toArray()
    const plan = planNewRound(existing, campIri, { roundId, snapshotId: snapshot.id }, note)
    let snapshotWritten = false
    let roundWritten = false
    try {
      await db.snapshots.put(snapshot)
      snapshotWritten = true
      await db.rounds.put(plan.round)
      roundWritten = true
      if (plan.closed) await db.rounds.put(plan.closed)
      return plan.round
    } catch (e) {
      if (roundWritten) await db.rounds.delete(plan.round.id).catch(() => undefined)
      if (snapshotWritten) await db.snapshots.delete(snapshot.id).catch(() => undefined)
      throw e
    }
  })
}

/** Closes a round without starting a new one. */
export async function closeRound(roundId: string): Promise<Round> {
  const db = getDb()
  return db.transaction('rw', db.rounds, async () => {
    const r = await db.rounds.get(roundId)
    if (!r) throw new RoundsError('noRound')
    if (r.closedAt) return r
    const closed = { ...r, closedAt: new Date().toISOString() }
    await db.rounds.put(closed)
    return closed
  })
}

export function getSnapshot(id: string): Promise<Snapshot | null> {
  return getDb()
    .snapshots.get(id)
    .then((s) => s ?? null)
}

export async function markRoundExported(roundId: string, at: string = new Date().toISOString()): Promise<void> {
  await getDb().rounds.update(roundId, { exportedAt: at })
}

/** Marks every round that was never exported as exported (after a full backup export). */
export async function markAllRoundsExported(at: string = new Date().toISOString()): Promise<void> {
  const db = getDb()
  await db.transaction('rw', db.rounds, async () => {
    const rows = await db.rounds.toArray()
    await db.rounds.bulkPut(rows.filter((r) => !r.exportedAt).map((r) => ({ ...r, exportedAt: at })))
  })
}
