/** IRI helpers shared by all modules. FROZEN (architect). */
import type { Iri } from './types'

/** Last path segment of an IRI: `/api/camps/70ca971c992f` -> `70ca971c992f`. */
export function idFromIri(iri: Iri): string {
  const clean = iri.split(/[?#]/)[0].replace(/\/+$/, '')
  return clean.slice(clean.lastIndexOf('/') + 1)
}

export function campIriFromId(campId: string): Iri {
  return `/api/camps/${campId}`
}

export function campIdFromIri(campIri: Iri): string {
  return idFromIri(campIri)
}
