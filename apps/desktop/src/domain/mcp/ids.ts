/** Id/IRI normalisation for MCP tool arguments. Pure. */
import type { Iri } from '../types'
import { McpToolError } from './types'

const ID = /^[A-Za-z0-9]+$/

function normalize(input: unknown, prefix: string, message: string): Iri {
  if (typeof input !== 'string') throw new McpToolError(message)
  const trimmed = input.trim()
  const id = trimmed.startsWith(`${prefix}/`) ? trimmed.slice(prefix.length + 1) : trimmed
  if (!ID.test(id)) throw new McpToolError(message)
  return `${prefix}/${id}`
}

/** '70ca971c992f' or '/api/camps/70ca971c992f' -> '/api/camps/70ca971c992f'. */
export function normalizeCampIri(input: unknown): Iri {
  return normalize(input, '/api/camps', 'Ungültige Lager-ID')
}

/** '/api/activities/…' likewise. */
export function normalizeActivityIri(input: unknown): Iri {
  return normalize(input, '/api/activities', 'Ungültige Aktivitäts-ID')
}
