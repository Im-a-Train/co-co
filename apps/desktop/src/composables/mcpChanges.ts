/**
 * Change signal for data written by MCP tools (ADR 0011). The MCP bridge writes straight to the Dexie stores;
 * composables that keep their own non-live copy (useFeedback, useRounds) watch `lastMcpChange` and reload the
 * affected camp, so a later UI edit never writes stale data over an MCP change.
 */
import { shallowRef } from 'vue'
import type { Iri } from '@/domain/types'

export type McpChangeKind = 'feedback' | 'review' | 'override'

export interface McpChange {
  /** Increases with every change (a repeated change of the same camp still triggers watchers). */
  seq: number
  campIri: Iri
  kind: McpChangeKind
}

export const lastMcpChange = shallowRef<McpChange | null>(null)

let seq = 0

export function notifyMcpChange(campIri: Iri, kind: McpChangeKind): void {
  lastMcpChange.value = { seq: ++seq, campIri, kind }
}
