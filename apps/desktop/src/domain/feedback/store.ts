/** Feedback persistence (table `feedback`). OWNER: feedback builder. */
import { getDb } from '../storage/db'
import type { FeedbackItem, Iri } from '../types'

export async function listFeedback(campIri: Iri): Promise<FeedbackItem[]> {
  const rows = await getDb().feedback.where('campIri').equals(campIri).toArray()
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
}

export async function saveFeedback(item: FeedbackItem): Promise<void> {
  await getDb().feedback.put(item)
}

export async function deleteFeedback(id: string): Promise<void> {
  await getDb().feedback.delete(id)
}
