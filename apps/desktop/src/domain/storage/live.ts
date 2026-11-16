/**
 * Live reads for composables and views: Dexie liveQuery behind one helper, so code outside domain/storage never
 * imports Dexie itself (encryption guard). The query must read through getDb(), i.e. the encryption middleware.
 */
import { liveQuery } from 'dexie'

/** Calls `onValue` with the first result and again after every write that changes it; returns the unsubscribe. */
export function subscribeLive<T>(query: () => Promise<T>, onValue: (value: T) => void): () => void {
  try {
    const sub = liveQuery(query).subscribe({ next: onValue, error: () => {} })
    return () => sub.unsubscribe()
  } catch {
    // store not usable (locked): no emissions
    return () => {}
  }
}
