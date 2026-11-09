/**
 * Documents of one camp: ingest (picker, drag and drop, watched folders), links, search.
 * Originals stay on disk; only extracted text + metadata go to IndexedDB.
 */
import { computed, onBeforeUnmount, onMounted, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { base64ToBytes, commands, onDocsChanged, onDocsDropped, type DocsChangedEvent } from '@/lib/tauri'
import { newId, nowIso } from '@/domain/storage/db'
import { getAppSettings } from '@/domain/storage/settings'
import {
  buildSearchIndex,
  detectKind,
  documentFactsFrom,
  type DocumentFacts,
  type SearchHit,
} from '@/domain/documents'
import { ingestDocument } from '@/domain/documents/ingest'
import {
  deleteDocument,
  deleteWatchedFolder,
  listDocuments,
  listWatchedFolders,
  saveDocument,
  saveWatchedFolder,
} from '@/domain/documents/store'
import type { DocumentRecord, DocumentSource, Iri, WatchedFolder } from '@/domain/types'
import { useCampFacts } from './useCampFacts'

export const DOCUMENT_FILTERS = [{ name: 'Dokumente', extensions: ['pdf', 'docx', 'xlsx', 'gpx', 'txt', 'md'] }]

/** Re-reads the original from disk (bytes are never stored in IndexedDB), for the in-app viewer. */
export async function loadDocumentBytes(path: string): Promise<Uint8Array> {
  return base64ToBytes((await commands.readDocument(path)).bytesBase64)
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Facts derived from the stored documents of a camp, for the rule engine. */
export async function getDocumentFacts(campIri: Iri): Promise<DocumentFacts> {
  return documentFactsFrom(await listDocuments(campIri))
}

export function useDocuments(campIri: MaybeRefOrGetter<Iri>) {
  const { facts } = useCampFacts(campIri)
  const documents = ref<DocumentRecord[]>([])
  const folders = ref<WatchedFolder[]>([])
  const busy = ref(false)
  const error = ref<string | null>(null)
  const notice = ref<string | null>(null)
  const unlisten: Array<() => void> = []

  const searchIndex = computed(() => buildSearchIndex(documents.value, facts.value))
  const documentFacts = computed(() => documentFactsFrom(documents.value))
  const pendingLinks = computed(() => documents.value.filter((d) => d.linkSuggestions.length > 0 && d.activityIris.length === 0))

  function search(query: string): SearchHit[] {
    return searchIndex.value.search(query)
  }

  async function reload() {
    documents.value = await listDocuments(toValue(campIri))
    folders.value = await listWatchedFolders(toValue(campIri))
  }

  async function persist(doc: DocumentRecord) {
    await saveDocument(doc)
    const i = documents.value.findIndex((d) => d.id === doc.id)
    if (i >= 0) documents.value.splice(i, 1, doc)
    else documents.value.push(doc)
  }

  async function ingestPath(path: string, source: DocumentSource, folder: string | null) {
    const iri = toValue(campIri)
    const file = await commands.readDocument(path)
    const existing = documents.value.find((d) => d.path === path) ?? null
    const s = (await getAppSettings()).gpx
    const { record, changed } = await ingestDocument(
      {
        campIri: iri,
        path: file.path,
        name: file.name,
        size: file.size,
        modifiedMs: file.modifiedMs,
        bytes: base64ToBytes(file.bytesBase64),
        source,
        folder,
      },
      existing,
      { facts: facts.value, gpx: { paceLkmPerHour: s.paceLkmPerHour, includeDescent: s.includeDescent }, newId },
    )
    await persist(record)
    return changed
  }

  async function ingestPaths(paths: string[], source: DocumentSource, folder: string | null = null) {
    busy.value = true
    error.value = null
    const failures: string[] = []
    let count = 0
    for (const p of paths) {
      try {
        // Dropped folders have no known extension: try to treat them as watched folders.
        if (source === 'drop' && detectKind(p) === 'other') {
          try {
            await commands.listFolder(p)
            await addFolder(p)
            continue
          } catch {
            /* not a folder: fall through and ingest as a file */
          }
        }
        await ingestPath(p, source, folder)
        count++
      } catch (e) {
        failures.push(`${p.split(/[\\/]/).pop()}: ${errText(e)}`)
      }
    }
    busy.value = false
    if (failures.length) error.value = failures.join('\n')
    return count
  }

  async function pickFiles() {
    try {
      const paths = await commands.pickFiles(DOCUMENT_FILTERS)
      if (paths.length) await ingestPaths(paths, 'picker')
    } catch (e) {
      error.value = errText(e)
    }
  }

  async function scanFolder(path: string) {
    const entries = await commands.listFolder(path)
    const files = entries.filter((e) => !e.isDir && detectKind(e.name) !== 'other')
    await ingestPaths(
      files.map((f) => f.path),
      'folder',
      path,
    )
  }

  async function addFolder(path: string) {
    const iri = toValue(campIri)
    if (!folders.value.some((f) => f.path === path)) {
      const folder: WatchedFolder = { id: newId(), campIri: iri, path, addedAt: nowIso() }
      await commands.watchFolder(path)
      await saveWatchedFolder(folder)
      folders.value.push(folder)
    }
    await scanFolder(path)
  }

  async function pickFolder() {
    try {
      const path = await commands.pickFolder()
      if (path) await addFolder(path)
    } catch (e) {
      error.value = errText(e)
    }
  }

  async function removeFolder(folder: WatchedFolder) {
    try {
      await commands.unwatchFolder(folder.path)
    } catch {
      /* already gone */
    }
    await deleteWatchedFolder(folder.id)
    folders.value = folders.value.filter((f) => f.id !== folder.id)
  }

  async function rescan() {
    for (const f of folders.value) {
      try {
        await scanFolder(f.path)
      } catch (e) {
        error.value = errText(e)
      }
    }
  }

  async function remove(id: string) {
    await deleteDocument(id)
    documents.value = documents.value.filter((d) => d.id !== id)
  }

  async function update(id: string, patch: Partial<DocumentRecord>) {
    const d = documents.value.find((x) => x.id === id)
    if (!d) return
    await persist({ ...d, ...patch })
  }

  async function confirmLink(id: string, activityIri: Iri) {
    const d = documents.value.find((x) => x.id === id)
    if (!d) return
    await persist({
      ...d,
      activityIris: d.activityIris.includes(activityIri) ? d.activityIris : [...d.activityIris, activityIri],
      linkSuggestions: d.linkSuggestions.filter((s) => s.activityIri !== activityIri),
    })
  }

  async function unlink(id: string, activityIri: Iri) {
    const d = documents.value.find((x) => x.id === id)
    if (!d) return
    await persist({ ...d, activityIris: d.activityIris.filter((i) => i !== activityIri) })
  }

  async function rejectSuggestion(id: string, activityIri: Iri) {
    const d = documents.value.find((x) => x.id === id)
    if (!d) return
    await persist({ ...d, linkSuggestions: d.linkSuggestions.filter((s) => s.activityIri !== activityIri) })
  }

  const setAiAllowed = (id: string, aiAllowed: boolean) => update(id, { aiAllowed, ...(aiAllowed ? {} : { aiSummary: null }) })
  const setAiSummary = (id: string, aiSummary: string) => update(id, { aiSummary })

  async function onChanged(e: DocsChangedEvent) {
    const folder = folders.value.find((f) => e.folder === f.path || e.path.startsWith(f.path))
    if (!folder) return
    try {
      if (e.kind === 'remove') {
        const d = documents.value.find((x) => x.path === e.path)
        if (d) await remove(d.id)
        return
      }
      if (detectKind(e.path) === 'other') return
      const changed = await ingestPath(e.path, 'folder', folder.path)
      if (changed) notice.value = `${e.path.split(/[\\/]/).pop()}`
    } catch (err) {
      error.value = errText(err)
    }
  }

  async function init() {
    try {
      await reload()
      for (const f of folders.value) {
        try {
          await commands.watchFolder(f.path) // idempotent re-watch
        } catch (e) {
          error.value = errText(e)
        }
      }
    } catch (e) {
      error.value = errText(e)
    }
  }

  onMounted(async () => {
    await init()
    unlisten.push(await onDocsDropped((e) => void ingestPaths(e.paths, 'drop')))
    unlisten.push(await onDocsChanged((e) => void onChanged(e)))
  })
  onBeforeUnmount(() => {
    for (const u of unlisten.splice(0)) u()
  })

  return {
    documents,
    folders,
    busy,
    error,
    notice,
    facts,
    documentFacts,
    pendingLinks,
    search,
    reload,
    pickFiles,
    pickFolder,
    addFolder,
    removeFolder,
    rescan,
    ingestPaths,
    remove,
    confirmLink,
    unlink,
    rejectSuggestion,
    setAiAllowed,
    setAiSummary,
  }
}
