/** Red-zone sanitising for MCP (ADR 0011). Pure. */
import { emptyCoachInputs } from '../campFacts/store'
import type { CoachInputs, FeedbackItem } from '../types'
import { RED_DERIVED_MARKER } from '../zones/aiGateway'

/**
 * Coach inputs without values that were adopted from MiData/NDS: those fields are reset to their empty
 * value and the provenance maps are removed. (This file may name midataFields/ndsFields on purpose.)
 */
export function stripRedDerivedInputs(inputs: CoachInputs | null): CoachInputs | null {
  if (!inputs) return null
  const empty = emptyCoachInputs(inputs.campIri) as unknown as Record<string, unknown>
  const next = { ...inputs } as unknown as Record<string, unknown>
  for (const key of [...Object.keys(inputs.midataFields ?? {}), ...Object.keys(inputs.ndsFields ?? {})]) {
    if (key in empty) next[key] = empty[key]
  }
  delete next.midataFields
  delete next.ndsFields
  return next as unknown as CoachInputs
}

/** Feedback quoting MiData/NDS is never exposed to MCP clients. */
export function isRedFeedback(item: Pick<FeedbackItem, 'redDerived' | 'text'>): boolean {
  return item.redDerived === true || RED_DERIVED_MARKER.test(item.text)
}
