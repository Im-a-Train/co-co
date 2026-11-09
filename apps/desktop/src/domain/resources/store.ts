/**
 * Hilfsmittel store (Dexie table `resources`, ADR 0013). Seeds missing bundled records on first read.
 * Every write calls `notifyResourcesChanged()` so the source registry overlay and the UI refresh.
 */
import { getDb, nowIso } from '../storage/db'
import type { EditOrigin, ResourceRecord } from '../types'
import { applyResourcePatch, bundledResources, toSourceRecord, validateResource, type NewResourceInput, type ResourcePatch } from './index'

const listeners = new Set<() => void>()

/** Registers a callback for every write; returns the unsubscribe function. */
export function onResourcesChanged(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function notifyResourcesChanged(): void {
  for (const cb of [...listeners]) {
    try {
      cb()
    } catch {
      /* a failing listener must not break the write */
    }
  }
}

let seeding: Promise<void> | null = null

function sameMetadata(a: ResourceRecord, b: ResourceRecord): boolean {
  return JSON.stringify(toSourceRecord(a)) === JSON.stringify(toSourceRecord(b))
}

/** Adds missing bundled records; refreshes unmodified bundled ones when sources.yaml changed. */
async function seed(): Promise<void> {
  if (seeding) return seeding
  seeding = (async () => {
    const db = getDb()
    const now = nowIso()
    const existing = new Map((await db.resources.toArray()).map((r) => [r.key, r]))
    const writes: ResourceRecord[] = []
    for (const b of bundledResources(now)) {
      const cur = existing.get(b.key)
      if (!cur) writes.push(b)
      else if (cur.origin === 'bundled' && !cur.modified && !sameMetadata(cur, b)) writes.push({ ...b, history: cur.history })
    }
    if (writes.length) await db.resources.bulkPut(writes)
  })().finally(() => {
    seeding = null
  })
  return seeding
}

/** All resources (bundled seeded + custom), sorted by key. */
export async function listResources(): Promise<ResourceRecord[]> {
  await seed()
  return (await getDb().resources.toArray()).sort((a, b) => a.key.localeCompare(b.key))
}

export async function getResource(key: string): Promise<ResourceRecord | undefined> {
  await seed()
  return getDb().resources.get(key)
}

/** Updates one resource; throws Error(German message) on validation failure or unknown key. */
export async function updateResource(key: string, patch: ResourcePatch, origin: EditOrigin): Promise<ResourceRecord> {
  const cur = await getResource(key)
  if (!cur) throw new Error(`Hilfsmittel «${key}» nicht gefunden.`)
  const errors = validateResource({ ...patch })
  if (errors.length) throw new Error(errors.join(' '))
  const clean: ResourcePatch = { ...patch }
  if (clean.url === '') clean.url = null
  const next = applyResourcePatch(cur, clean, origin, nowIso())
  await getDb().resources.put(next)
  notifyResourcesChanged()
  return next
}

/** Adds a custom resource; throws on duplicate key or validation failure. */
export async function addResource(input: NewResourceInput, origin: EditOrigin): Promise<ResourceRecord> {
  const errors = validateResource({ ...input })
  if (errors.length) throw new Error(errors.join(' '))
  if (await getResource(input.key)) throw new Error(`Der Schlüssel «${input.key}» existiert bereits.`)
  const now = nowIso()
  const rec: ResourceRecord = {
    key: input.key,
    title: input.title.trim(),
    ...(input.publisher ? { publisher: input.publisher } : {}),
    edition: input.edition ?? '',
    ...(input.date ? { date: input.date } : {}),
    url: input.url ? input.url : null,
    weight: input.weight ?? 'info',
    pageConvention: input.pageConvention ?? 'section',
    partlyRead: [],
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.checkedOn ? { checkedOn: input.checkedOn } : {}),
    ...(input.content ? { content: input.content } : {}),
    ...(input.fileName ? { fileName: input.fileName } : {}),
    ...(input.contentHash ? { contentHash: input.contentHash } : {}),
    origin: 'custom',
    modified: false,
    updatedAt: now,
    updatedBy: origin,
  }
  await getDb().resources.put(rec)
  notifyResourcesChanged()
  return rec
}

/** Keys of resources cited by rule edits (patch.sources and resourceKeys). */
export async function resourceKeysCitedByRuleEdits(): Promise<Set<string>> {
  const cited = new Set<string>()
  for (const e of await getDb().ruleEdits.toArray()) {
    for (const s of e.patch.sources ?? []) cited.add(s.key)
    for (const k of e.resourceKeys ?? []) cited.add(k)
  }
  return cited
}

/** Bundled: back to sources.yaml (content dropped). Custom: deleted (refused while a rule edit cites it). */
export async function resetResource(key: string): Promise<void> {
  const cur = await getResource(key)
  if (!cur) throw new Error(`Hilfsmittel «${key}» nicht gefunden.`)
  const bundled = cur.origin === 'bundled' ? bundledResources(nowIso()).find((b) => b.key === key) : undefined
  if (bundled) {
    await getDb().resources.put(bundled)
  } else {
    if ((await resourceKeysCitedByRuleEdits()).has(key)) throw new Error(`«${key}» wird von einer Regelanpassung zitiert und kann nicht gelöscht werden.`)
    await getDb().resources.delete(key)
  }
  notifyResourcesChanged()
}
