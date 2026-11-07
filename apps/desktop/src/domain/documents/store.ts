/** Document persistence (tables `documents`, `watchedFolders`). OWNER: documents builder. */
import { getDb } from '../storage/db'
import type { DocumentRecord, Iri, WatchedFolder } from '../types'

export function listDocuments(campIri: Iri): Promise<DocumentRecord[]> {
  return getDb().documents.where('campIri').equals(campIri).toArray()
}

export async function saveDocument(doc: DocumentRecord): Promise<void> {
  await getDb().documents.put(doc)
}

export async function deleteDocument(id: string): Promise<void> {
  await getDb().documents.delete(id)
}

export function listWatchedFolders(campIri?: Iri): Promise<WatchedFolder[]> {
  const t = getDb().watchedFolders
  return campIri ? t.where('campIri').equals(campIri).toArray() : t.toArray()
}

export async function saveWatchedFolder(folder: WatchedFolder): Promise<void> {
  await getDb().watchedFolders.put(folder)
}

export async function deleteWatchedFolder(id: string): Promise<void> {
  await getDb().watchedFolders.delete(id)
}
