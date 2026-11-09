/**
 * Rule edits store (Dexie table `ruleEdits`, ADR 0013) + the process-wide effective packs.
 *
 * `saveRuleEdit` merges the given patch on top of the stored one (so a partial patch, e.g. from MCP,
 * keeps earlier edits), reduces it to the fields that differ from the bundled rule and stores it.
 * To drop a field's edit, pass the bundled value again; to drop everything use `resetRuleEdit`.
 */
import { getDb, nowIso } from '../storage/db'
import type { EditOrigin, RuleEditPatch, RuleEditRecord, RulePack } from '../types'
import { applyRuleEdits, diffPatch, mergePatches, validateRuleEditPatch } from './edits'
import { loadBundledPacks } from './packs'
import { getSourceRegistry } from './packs/registry'

export const MAX_RULE_EDIT_HISTORY = 10

let cache: RulePack[] | null = null
let cachedEdits: RuleEditRecord[] = []
let cacheErrors: Array<{ ruleId: string; errors: string[] }> = []
const listeners = new Set<() => void>()

/** Source keys of the effective registry (bundled sources + Hilfsmittel overlay), incl. former keys. */
export function knownSourceKeys(): Set<string> {
  const keys = new Set<string>()
  for (const r of getSourceRegistry().records) {
    keys.add(r.key)
    for (const fk of r.formerKeys ?? []) keys.add(fk)
  }
  return keys
}

/** Called after every cache refresh (useRuleEdits bumps its reactive version here). */
export function onRuleEditsChanged(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Forgets the cached edits (data store locked); effective packs equal the bundled ones again. */
export function clearRuleEditsCache(): void {
  cache = null
  cachedEdits = []
  cacheErrors = []
  listeners.forEach((cb) => cb())
}

/** Edits of the last reload that were skipped because they no longer validate. */
export function skippedRuleEdits(): ReadonlyArray<{ ruleId: string; errors: string[] }> {
  return cacheErrors
}

/** The edits as loaded by the last reload (no DB access). */
export function cachedRuleEdits(): readonly RuleEditRecord[] {
  return cachedEdits
}

export async function listRuleEdits(): Promise<RuleEditRecord[]> {
  return getDb().ruleEdits.toArray()
}

function bundledMeta(ruleId: string) {
  for (const p of loadBundledPacks()) for (const r of p.rules) if (r.meta.id === ruleId) return r.meta
  return undefined
}

/**
 * Validates (edits.ts policy, against the effective source registry), stores the minimal patch and
 * pushes the previous one to history. An empty minimal patch deletes the edit. Throws Error(German).
 */
export async function saveRuleEdit(
  ruleId: string,
  patch: RuleEditPatch,
  opts: { origin: EditOrigin; reason?: string; resourceKeys?: string[] },
): Promise<RuleEditRecord | null> {
  const meta = bundledMeta(ruleId)
  if (!meta) throw new Error(`Die Regel «${ruleId}» gibt es nicht.`)
  const known = knownSourceKeys()
  const errors = validateRuleEditPatch(meta, patch, opts.origin, known)
  if (errors.length) throw new Error(errors.join(' '))
  const db = getDb()
  const existing = await db.ruleEdits.get(ruleId)
  const minimal = diffPatch(meta, mergePatches(existing?.patch ?? {}, patch))
  const mergedErrors = validateRuleEditPatch(meta, minimal, 'manual', known)
  if (mergedErrors.length) throw new Error(mergedErrors.join(' '))
  if (Object.keys(minimal).length === 0) {
    await db.ruleEdits.delete(ruleId)
    await reloadRuleEdits()
    return null
  }
  const at = nowIso()
  const history = existing
    ? [{ patch: existing.patch, updatedAt: existing.updatedAt, updatedBy: existing.updatedBy, ...(existing.reason ? { reason: existing.reason } : {}) }, ...(existing.history ?? [])].slice(0, MAX_RULE_EDIT_HISTORY)
    : []
  const record: RuleEditRecord = {
    ruleId,
    baseVersion: meta.version,
    patch: minimal,
    ...(opts.reason?.trim() ? { reason: opts.reason.trim() } : {}),
    ...(opts.resourceKeys?.length ? { resourceKeys: [...opts.resourceKeys] } : {}),
    updatedAt: at,
    updatedBy: opts.origin,
    ...(history.length ? { history } : {}),
  }
  await db.ruleEdits.put(record)
  await reloadRuleEdits()
  return record
}

/** Drops the edit of one rule (back to bundled). */
export async function resetRuleEdit(ruleId: string): Promise<void> {
  await getDb().ruleEdits.delete(ruleId)
  await reloadRuleEdits()
}

/**
 * Synchronous effective packs: bundled packs with the last loaded edits applied. Before
 * `reloadRuleEdits()` ran (or while the store is locked) this equals loadBundledPacks().
 */
export function loadEffectivePacks(): RulePack[] {
  return cache ?? loadBundledPacks()
}

/** Reads the table and refreshes the cache behind loadEffectivePacks(); bumps the reactive version. */
export async function reloadRuleEdits(): Promise<void> {
  const edits = await listRuleEdits()
  const { packs, errors } = applyRuleEdits(loadBundledPacks(), edits, knownSourceKeys())
  cache = edits.length ? packs : null
  cachedEdits = edits
  cacheErrors = errors
  listeners.forEach((cb) => cb())
}
