import { describe, expect, it } from 'vitest'
import { activitiesPath, campsPath, formatDateCh, toCampSummary } from '../camps'
import { collectionCount, embeddedList, linkHref, stripTemplate, type HalResource } from '../hal'
import { loadCustomInstances, normalizeBaseUrl, saveCustomInstances, STORAGE_KEY } from '../instances'
import { resultForStep } from '../../composables/useSpikeProtocol'

describe('campsPath', () => {
  it('filters camps by collaborator (eCamp rejects unfiltered /api/camps)', () => {
    expect(campsPath('/api/users/abc123')).toBe('/api/camps?campCollaborator=%2Fapi%2Fusers%2Fabc123')
  })
})

describe('normalizeBaseUrl', () => {
  it('accepts https and normalizes to origin', () => {
    expect(normalizeBaseUrl('https://app.ecamp3.ch/')).toEqual({ ok: true, baseUrl: 'https://app.ecamp3.ch' })
    expect(normalizeBaseUrl(' https://app.ecamp3.ch/camps?x=1 ')).toEqual({ ok: true, baseUrl: 'https://app.ecamp3.ch' })
    expect(normalizeBaseUrl('dev.ecamp3.ch')).toEqual({ ok: true, baseUrl: 'https://dev.ecamp3.ch' })
  })

  it('allows http only for localhost', () => {
    expect(normalizeBaseUrl('http://localhost:3000')).toEqual({ ok: true, baseUrl: 'http://localhost:3000' })
    expect(normalizeBaseUrl('http://127.0.0.1:3000')).toEqual({ ok: true, baseUrl: 'http://127.0.0.1:3000' })
    expect(normalizeBaseUrl('http://ecamp.example.ch')).toEqual({ ok: false, reason: 'insecure' })
  })

  it('rejects other schemes and garbage', () => {
    expect(normalizeBaseUrl('')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeBaseUrl('ftp://x.ch')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeBaseUrl('https://user:pw@x.ch')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeBaseUrl('https://')).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('custom instance persistence', () => {
  function memory(initial?: string) {
    const data = new Map<string, string>(initial ? [[STORAGE_KEY, initial]] : [])
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data }
  }

  it('round-trips and drops invalid, duplicate and built-in entries', () => {
    const store = memory(
      JSON.stringify([
        { label: 'Test', baseUrl: 'https://ecamp.example.ch/' },
        { label: 'Dup', baseUrl: 'https://ecamp.example.ch' },
        { label: 'Prod', baseUrl: 'https://app.ecamp3.ch' },
        { label: 'Bad', baseUrl: 'http://evil.example' },
        'nonsense',
      ]),
    )
    const list = loadCustomInstances(store)
    expect(list).toEqual([{ id: 'custom:https://ecamp.example.ch', label: 'Test', baseUrl: 'https://ecamp.example.ch', builtIn: false }])
    saveCustomInstances(list, store)
    expect(JSON.parse(store.data.get(STORAGE_KEY)!)).toEqual([{ label: 'Test', baseUrl: 'https://ecamp.example.ch' }])
  })

  it('survives broken storage', () => {
    expect(loadCustomInstances(memory('{not json'))).toEqual([])
    const throwing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(loadCustomInstances(throwing)).toEqual([])
    expect(() => saveCustomInstances([], throwing)).not.toThrow()
  })
})

describe('HAL helpers', () => {
  const collection: HalResource = {
    _links: { self: { href: '/api/camps' }, item: [{ href: '/api/camps/a' }] },
    _embedded: { items: [{ title: 'A' }, { title: 'B' }] },
  }

  it('reads links, strips templates and lists embedded items', () => {
    expect(stripTemplate('/api/camps{/id}{?isPrototype,campCollaborator}')).toBe('/api/camps')
    expect(linkHref(collection, 'item')).toBe('/api/camps/a')
    expect(linkHref(collection, 'missing')).toBeNull()
    expect(embeddedList(collection).map((i) => i.title)).toEqual(['A', 'B'])
    expect(collectionCount(collection)).toBe(2)
    expect(collectionCount({ ...collection, totalItems: 17 })).toBe(17)
  })

  it('maps camps with embedded periods', () => {
    const camp: HalResource = {
      title: 'Sommerlager',
      shortTitle: 'SoLa',
      motto: 'Piraten',
      coachName: 'Coach X',
      _links: { self: { href: '/api/camps/abc' }, periods: { href: '/api/periods?camp=%2Fapi%2Fcamps%2Fabc' } },
      _embedded: { periods: [{ description: 'Hauptlager', start: '2026-07-11', end: '2026-07-24' }] },
    }
    expect(toCampSummary(camp)).toEqual({
      iri: '/api/camps/abc',
      title: 'Sommerlager',
      shortTitle: 'SoLa',
      motto: 'Piraten',
      coachName: 'Coach X',
      periods: [{ description: 'Hauptlager', start: '2026-07-11', end: '2026-07-24' }],
      periodsHref: '/api/periods?camp=%2Fapi%2Fcamps%2Fabc',
    })
    expect(toCampSummary({ title: 'x' })).toBeNull()
    expect(toCampSummary({ id: 'z', title: 'x' })?.periods).toBeNull()
  })

  it('formats dates and activity paths', () => {
    expect(formatDateCh('2026-07-11')).toBe('11.07.2026')
    expect(formatDateCh('2026-07-11T00:00:00+00:00')).toBe('11.07.2026')
    expect(formatDateCh(null)).toBe('–')
    expect(activitiesPath('/api/camps/abc')).toBe('/api/activities?camp=/api/camps/abc')
  })
})

describe('resultForStep', () => {
  it('maps Rust log steps onto checklist entries', () => {
    expect(resultForStep('login-window-opened')).toBe('loginWindowOpened')
    expect(resultForStep('login-window-closed')).toBeNull()
    expect(resultForStep('cookies')).toBe('cookiesFound')
    expect(resultForStep('read-cookies')).toBe('cookiesFound')
    expect(resultForStep('token-refresh')).toBe('refreshOk')
    expect(resultForStep('page-load')).toBeNull()
    expect(resultForStep('refresh-start')).toBeNull()
    expect(resultForStep('refresh')).toBe('refreshOk')
  })
})
