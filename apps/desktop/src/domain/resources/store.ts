/**
 * Hilfsmittel store (Dexie table `resources`, ADR 0013). Seeds missing bundled records on first read.
 * CONTRACT (main session): keep the exported signatures; implementation by the resources agent.
 * Every write calls `notifyResourcesChanged()` so the source registry overlay and the UI refresh.
 */
import type { EditOrigin, ResourceRecord } from '../types'
import type { NewResourceInput, ResourcePatch } from './index'

/** All resources (bundled seeded + custom), sorted by key. */
export async function listResources(): Promise<ResourceRecord[]> {
  throw new Error('not implemented')
}

export async function getResource(_key: string): Promise<ResourceRecord | undefined> {
  throw new Error('not implemented')
}

/** Updates one resource; throws Error(German message) on validation failure or unknown key. */
export async function updateResource(_key: string, _patch: ResourcePatch, _origin: EditOrigin): Promise<ResourceRecord> {
  throw new Error('not implemented')
}

/** Adds a custom resource; throws on duplicate key or validation failure. */
export async function addResource(_input: NewResourceInput, _origin: EditOrigin): Promise<ResourceRecord> {
  throw new Error('not implemented')
}

/** Bundled: back to sources.yaml (content dropped). Custom: deleted (refused while a rule edit cites it). */
export async function resetResource(_key: string): Promise<void> {
  throw new Error('not implemented')
}
