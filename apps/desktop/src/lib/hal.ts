/** Minimal HAL helpers for eCamp API (application/hal+json) responses. */

export interface HalLink {
  href: string
  templated?: boolean
}

export type HalResource = Record<string, unknown> & {
  _links?: Record<string, HalLink | HalLink[] | undefined>
  _embedded?: Record<string, unknown>
}

export function asResource(value: unknown): HalResource | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as HalResource) : null
}

/** Removes RFC 6570 template parts like `{/id}` or `{?isPrototype}`. */
export function stripTemplate(href: string): string {
  return href.replace(/\{[^}]*\}/g, '')
}

export function linkHref(resource: HalResource | null | undefined, rel: string): string | null {
  const link = resource?._links?.[rel]
  const first = Array.isArray(link) ? link[0] : link
  return first && typeof first.href === 'string' ? stripTemplate(first.href) : null
}

export function selfHref(resource: HalResource | null | undefined): string | null {
  return linkHref(resource, 'self')
}

/** Returns embedded resources of a relation (collection `items` by default). */
export function embeddedList(resource: HalResource | null | undefined, rel = 'items'): HalResource[] {
  const value = resource?._embedded?.[rel]
  if (Array.isArray(value)) return value.map(asResource).filter((r): r is HalResource => r !== null)
  const single = asResource(value)
  return single ? [single] : []
}

export function embeddedOne(resource: HalResource | null | undefined, rel: string): HalResource | null {
  return asResource(resource?._embedded?.[rel])
}

export function str(resource: HalResource | null | undefined, key: string): string | null {
  const v = resource?.[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** Collection total if present (`totalItems`), otherwise number of embedded items. */
export function collectionCount(resource: HalResource | null | undefined): number {
  const total = resource?.totalItems
  return typeof total === 'number' ? total : embeddedList(resource).length
}
