import { describe, expect, it } from 'vitest'
import { activityBlockNumbers, activityShortUrlMap, activityUrlMap, ecampActivityShortUrl, ecampActivityUrl, ecampSlug } from '../ecampLinks'
import type { CampFacts } from '../types'

type Facts = Pick<CampFacts, 'instanceBaseUrl' | 'camp' | 'scheduleEntries' | 'activities'>

function facts(p: Partial<Facts> = {}, camp: Record<string, unknown> = {}): Facts {
  return {
    instanceBaseUrl: 'https://dev.ecamp3.ch',
    camp: { iri: '/api/camps/c1', id: 'c1', title: 'Auf in die Berge', shortTitle: 'Berge', ...camp } as Facts['camp'],
    activities: [{ iri: '/api/activities/a1', title: 'Postenlauf' }, { iri: '/api/activities/a2', title: 'Solo' }] as Facts['activities'],
    scheduleEntries: [
      { iri: '/api/schedule_entries/s2', activityIri: '/api/activities/a1', start: '2026-07-02T08:00:00Z' },
      { iri: '/api/schedule_entries/s1', activityIri: '/api/activities/a1', start: '2026-07-01T08:00:00Z' },
    ] as Facts['scheduleEntries'],
    ...p,
  }
}

describe('ecampSlug', () => {
  it('handles umlauts, special chars and empty input', () => {
    expect(ecampSlug('Größe & Spaß')).toBe('Grosse-and-Spass')
    expect(ecampSlug('Küche: Zmorge, 1.5!')).toBe('Kuche-Zmorge-1-5')
    expect(ecampSlug('???')).toBe('-')
  })
})

describe('ecampActivityUrl', () => {
  it('builds the URL with the earliest schedule entry', () => {
    expect(ecampActivityUrl(facts(), '/api/activities/a1')).toBe(
      'https://dev.ecamp3.ch/camps/c1/Berge/program/activity/a1/s1/Postenlauf',
    )
  })
  it('omits entry and name without schedule entry', () => {
    expect(ecampActivityUrl(facts(), '/api/activities/a2')).toBe('https://dev.ecamp3.ch/camps/c1/Berge/program/activity/a2')
  })
  it('falls back to title and cuts at 16 chars', () => {
    const f = facts({}, { shortTitle: null, title: 'Sommerlager Wolfsberg' })
    expect(ecampActivityUrl(f, '/api/activities/a2')).toContain('/camps/c1/Sommerlager-Wolf/')
  })
  it('strips trailing slash on the base', () => {
    expect(ecampActivityUrl(facts({ instanceBaseUrl: 'https://dev.ecamp3.ch/' }), '/api/activities/a2')).toMatch(
      /^https:\/\/dev\.ecamp3\.ch\/camps\//,
    )
  })
  it('returns null for null/non-http base and unknown activity', () => {
    expect(ecampActivityUrl(facts({ instanceBaseUrl: null }), '/api/activities/a1')).toBeNull()
    expect(ecampActivityUrl(facts({ instanceBaseUrl: 'javascript:alert(1)' }), '/api/activities/a1')).toBeNull()
    expect(ecampActivityUrl(facts({ instanceBaseUrl: 'nonsense' }), '/api/activities/a1')).toBeNull()
    expect(ecampActivityUrl(facts(), '/api/activities/zzz')).toBeNull()
  })
})

describe('activityUrlMap', () => {
  it('maps all resolvable activities; empty without facts', () => {
    expect(Object.keys(activityUrlMap(facts()))).toEqual(['/api/activities/a1', '/api/activities/a2'])
    expect(activityUrlMap(null)).toEqual({})
    expect(activityUrlMap(facts({ instanceBaseUrl: null }))).toEqual({})
  })
})

describe('activityBlockNumbers', () => {
  const e = (iri: string, activityIri: string, start: string, number: string | null) => ({ iri, activityIri, start, number })
  it('joins numbers sorted by start, deduplicated; skips missing numbers', () => {
    const f = {
      scheduleEntries: [
        e('s3', '/api/activities/a1', '2026-07-03T08:00:00Z', '3.4'),
        e('s1', '/api/activities/a1', '2026-07-01T08:00:00Z', '1.2'),
        e('s2', '/api/activities/a1', '2026-07-02T08:00:00Z', '3.4'),
        e('s4', '/api/activities/a2', '2026-07-01T08:00:00Z', null),
      ] as Facts['scheduleEntries'],
    }
    expect(activityBlockNumbers(f)).toEqual({ '/api/activities/a1': '1.2/3.4' })
    expect(activityBlockNumbers(null)).toEqual({})
  })
})

describe('ecampActivityShortUrl', () => {
  it('builds the id-only URL', () => {
    expect(ecampActivityShortUrl(facts(), '/api/activities/a1')).toBe('https://dev.ecamp3.ch/camps/c1/-/program/activity/a1')
    expect(ecampActivityShortUrl(facts(), '/api/activities/a2')).toBe('https://dev.ecamp3.ch/camps/c1/-/program/activity/a2')
  })
  it('returns null for bad base, unknown activity and missing camp id', () => {
    expect(ecampActivityShortUrl(facts({ instanceBaseUrl: null }), '/api/activities/a1')).toBeNull()
    expect(ecampActivityShortUrl(facts({ instanceBaseUrl: 'javascript:alert(1)' }), '/api/activities/a1')).toBeNull()
    expect(ecampActivityShortUrl(facts(), '/api/activities/zzz')).toBeNull()
    expect(ecampActivityShortUrl(facts({}, { id: '' }), '/api/activities/a1')).toBeNull()
  })
  it('activityShortUrlMap maps all resolvable activities', () => {
    expect(activityShortUrlMap(facts())).toEqual({
      '/api/activities/a1': 'https://dev.ecamp3.ch/camps/c1/-/program/activity/a1',
      '/api/activities/a2': 'https://dev.ecamp3.ch/camps/c1/-/program/activity/a2',
    })
    expect(activityShortUrlMap(null)).toEqual({})
  })
})
