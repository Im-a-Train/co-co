import type { RulePredicate } from '../../types'

/** Merges per-module predicate registries; throws on a rule id defined in two files. */
export function mergePredicates(...parts: Record<string, RulePredicate>[]): Record<string, RulePredicate> {
  const out: Record<string, RulePredicate> = {}
  for (const part of parts) {
    for (const [id, fn] of Object.entries(part)) {
      if (id in out) throw new Error(`Prädikat ${id} ist doppelt registriert`)
      out[id] = fn
    }
  }
  return out
}
