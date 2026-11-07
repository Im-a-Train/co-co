import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createDevCampApi, DEV_CAMP_IRI } from '@/__tests__/fixtures/devCampApi'
import type { ApiGet, CampFacts, CategoryFact } from '../../types'
import { emptyCoachInputs } from '../store'
import {
  classOf,
  guessCategories,
  htmlToText,
  loadCampFacts,
  loadCampList,
  mappingFromGuesses,
} from '../index'

const FACTS_FILE = fileURLToPath(
  new URL('../../../__tests__/fixtures/camps/auf-in-die-berge.facts.json', import.meta.url),
)
const FIXED_NOW = '2026-01-01T00:00:00.000Z'

async function load(userIri: string | null = '/api/users/dac7116e02ed') {
  const api = createDevCampApi()
  const progress: string[] = []
  const facts = await loadCampFacts(api.apiGet, DEV_CAMP_IRI, (p) => progress.push(p.step), {
    userIri,
    instanceBaseUrl: 'https://dev.ecamp3.ch',
  })
  return { api, facts, progress }
}

describe('htmlToText', () => {
  it('strips tags, keeps paragraph breaks, decodes entities', () => {
    expect(htmlToText('<p>Hallo &amp; <strong>Welt</strong></p><p>Zeile&nbsp;2</p>')).toBe('Hallo & Welt\nZeile 2')
    expect(htmlToText('<ul><li>a</li><li>b</li></ul>')).toBe('- a\n- b')
    expect(htmlToText(null)).toBe('')
    expect(htmlToText('<p></p><p></p>')).toBe('')
  })
})

describe('loadCampFacts (dev camp dump)', () => {
  it('normalises the camp graph', async () => {
    const { facts, api } = await load()
    expect(facts.camp.title).toBe('Auf in die Berge')
    expect(facts.camp.id).toBe('70ca971c992f')
    expect(facts.camp.start).toBe('2031-01-24')
    expect(facts.camp.end).toBe('2031-01-30')
    expect(facts.periods).toHaveLength(1)
    expect(facts.days).toHaveLength(7)
    expect(facts.days[0].date).toBe('2031-01-24')
    expect(facts.days[0].number).toBe(1)
    expect(facts.scheduleEntries).toHaveLength(7)
    expect(facts.scheduleEntries[0].durationMinutes).toBe(600)
    expect(facts.activities).toHaveLength(2)
    expect(facts.categories.map((c) => c.short).sort()).toEqual(['Ski', 'Snwb'])
    expect(facts.dayResponsibles).toHaveLength(3)
    expect(facts.activityResponsibles).toHaveLength(3)
    expect(facts.progressLabels.map((l) => l.position)).toEqual([1, 2, 3])
    expect(facts.comments).toHaveLength(7)
    expect(facts.instanceBaseUrl).toBe('https://dev.ecamp3.ch')
    expect(api.calls.some((c) => c.startsWith('/api/schedule_entries?period='))).toBe(true)
    expect(api.calls.some((c) => c.startsWith('/api/day_responsibles?day.period='))).toBe(true)
  })

  it('links schedule entries and responsibles to activities', async () => {
    const { facts } = await load()
    for (const a of facts.activities) {
      expect(a.scheduleEntryIris.length).toBeGreaterThan(0)
      expect(a.responsibleIris.length).toBeGreaterThan(0)
    }
    const total = facts.activities.reduce((n, a) => n + a.scheduleEntryIris.length, 0)
    expect(total).toBe(facts.scheduleEntries.length)
  })

  it('groups content nodes per activity with plain text', async () => {
    const { facts } = await load()
    const withSafety = facts.activities.filter((a) => a.content.hasSafetyConsiderations)
    expect(withSafety).toHaveLength(1)
    expect(withSafety[0].content.safetyText).toContain('Ausrüstung überprüfen')
    expect(withSafety[0].content.safetyText).not.toContain('<p>')
    expect(facts.activities.every((a) => a.content.hasStoryboard)).toBe(true)
    expect(facts.activities.some((a) => a.content.storyboardText.includes('Abmarsch'))).toBe(true)
    expect(facts.activities.some((a) => a.content.notesText.includes('Euphorie'))).toBe(true)
  })

  it('collaborators get display names and the current user is marked', async () => {
    const { facts } = await load()
    expect(facts.collaborators).toHaveLength(4)
    const me = facts.collaborators.filter((c) => c.isCurrentUser)
    expect(me).toHaveLength(1)
    expect(me[0].displayName).toBe('Luke Skywalker')
    expect(me[0].role).toBe('manager')
    expect(facts.collaborators.find((c) => c.role === 'guest')?.displayName).toBe('Bi-Pi')
    expect(facts.comments.find((c) => c.authorIri)?.authorDisplayName).toBeTruthy()
  })

  it('uses profile names when the profiles endpoint answers', async () => {
    const base = createDevCampApi().apiGet
    const apiGet = (async (path: string) => {
      if (path.startsWith('/api/profiles?')) {
        return {
          _embedded: {
            items: [
              {
                _links: { self: { href: '/api/profiles/4bc441dc4b29' } },
                nickname: 'Luke',
                firstname: 'Luke',
                surname: 'Skywalker',
              },
            ],
          },
        }
      }
      return base(path)
    }) as ApiGet
    const facts = await loadCampFacts(apiGet, DEV_CAMP_IRI, undefined, { userIri: '/api/users/dac7116e02ed' })
    expect(facts.collaborators.find((c) => c.isCurrentUser)?.displayName).toBe('Luke')
  })

  it('follows HAL pagination', async () => {
    const base = createDevCampApi().apiGet
    const calls: string[] = []
    const apiGet = (async (path: string) => {
      calls.push(path)
      if (path.startsWith('/api/categories?camp=') && !path.includes('page=2')) {
        const full = (await base(path)) as { _embedded: { items: unknown[] } }
        return {
          _embedded: { items: [full._embedded.items[0]] },
          _links: { self: { href: path }, next: { href: path + '&page=2' } },
        }
      }
      if (path.includes('page=2')) {
        const full = (await base(path.replace('&page=2', ''))) as { _embedded: { items: unknown[] } }
        return { _embedded: { items: [full._embedded.items[1]] }, _links: { self: { href: path } } }
      }
      return base(path)
    }) as ApiGet
    const facts = await loadCampFacts(apiGet, DEV_CAMP_IRI)
    expect(facts.categories).toHaveLength(2)
    expect(calls.filter((c) => c.includes('page=2'))).toHaveLength(1)
  })

  it('tolerates failing comments but rejects on required endpoints', async () => {
    const base = createDevCampApi().apiGet
    const noComments = (async (p: string) => {
      if (p.startsWith('/api/comments')) throw new Error('HTTP 403')
      return base(p)
    }) as ApiGet
    expect((await loadCampFacts(noComments, DEV_CAMP_IRI)).comments).toEqual([])
    const noActs = (async (p: string) => {
      if (p.startsWith('/api/activities')) throw new Error('HTTP 500')
      return base(p)
    }) as ApiGet
    await expect(loadCampFacts(noActs, DEV_CAMP_IRI)).rejects.toThrow('HTTP 500')
  })

  it('reports progress', async () => {
    const { progress } = await load()
    expect(progress).toContain('contentNodes')
    expect(progress).toContain('scheduleEntries')
  })

  it('loadCampList returns camps with dates and role', async () => {
    const api = createDevCampApi()
    const list = await loadCampList(api.apiGet, '/api/users/dac7116e02ed')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: '70ca971c992f',
      title: 'Auf in die Berge',
      start: '2031-01-24',
      end: '2031-01-30',
      role: 'manager',
    })
    const guest = await loadCampList(api.apiGet, '/api/users/9145944210a7')
    expect(guest[0].role).toBe('guest')
  })

  it('writes / matches the CampFacts fixture for the rules tests', async () => {
    const { facts } = await load()
    const stable: CampFacts = { ...facts, loadedAt: FIXED_NOW }
    const json = JSON.stringify(stable, null, 2) + '\n'
    if (!existsSync(FACTS_FILE) || process.env.UPDATE_FACTS_FIXTURE) {
      mkdirSync(dirname(FACTS_FILE), { recursive: true })
      writeFileSync(FACTS_FILE, json)
    }
    expect(JSON.parse(readFileSync(FACTS_FILE, 'utf8'))).toEqual(JSON.parse(json))
  })
})

function cat(short: string, name = short): CategoryFact {
  return { iri: `/api/categories/${short}`, short, name, color: '#000', numberingStyle: '1' }
}

describe('guessCategories', () => {
  const g = (short: string, name?: string) => guessCategories([cat(short, name)], [])[0]
  it('uses exact short codes', () => {
    expect(g('LS', 'x')).toMatchObject({ guess: 'LS', confidence: 'high', reason: 'short:LS' })
    expect(g('la')).toMatchObject({ guess: 'LA', confidence: 'high' })
    expect(g('LP')).toMatchObject({ guess: 'LP' })
    expect(g('ES')).toMatchObject({ guess: 'ES' })
  })
  it('uses names', () => {
    expect(g('X', 'Lagersport')).toMatchObject({ guess: 'LS', confidence: 'high' })
    expect(g('X', 'Lageraktivität')).toMatchObject({ guess: 'LA', confidence: 'high' })
    expect(g('X', 'Lagerprogramm')).toMatchObject({ guess: 'LP' })
    expect(g('Es', 'Essen')).toMatchObject({ guess: 'ES' })
    expect(g('Z', 'Zmorge')).toMatchObject({ guess: 'ES' })
    expect(g('Ski')).toMatchObject({ guess: 'LS', confidence: 'low' })
    expect(g('F', 'Freizeit')).toMatchObject({ guess: 'NONE' })
  })
  it('falls back to YS characteristics, then LP', () => {
    const c = cat('Q', 'Quatsch')
    const act = {
      iri: '/a',
      title: '',
      location: null,
      categoryIri: c.iri,
      progressLabelIri: null,
      rootContentNodeIri: null,
      responsibleIris: [],
      scheduleEntryIris: [],
      content: { ysCharacteristics: ['x'], ysPhysicalActivityDurationMinutes: null },
    } as never
    expect(guessCategories([c], [act])[0]).toMatchObject({ guess: 'LS', reason: 'ys-characteristics', confidence: 'low' })
    expect(guessCategories([c], [])[0]).toMatchObject({ guess: 'LP', reason: 'default' })
  })
  it('builds mapping and resolves classes', () => {
    const guesses = guessCategories([cat('LS'), cat('ES')], [])
    const m = mappingFromGuesses('/api/camps/1', guesses, new Date(FIXED_NOW))
    expect(m.confirmed).toBe(false)
    expect(classOf(m, '/api/categories/LS')).toBe('LS')
    expect(classOf(m, '/api/categories/unknown')).toBe('NONE')
    expect(classOf(m, null)).toBe('NONE')
    expect(classOf(null, '/api/categories/LS')).toBe('NONE')
  })
  it('guesses the dev camp categories', async () => {
    const { facts } = await load()
    const guesses = guessCategories(facts.categories, facts.activities)
    expect(guesses.map((x) => x.guess)).toEqual(['LS', 'LS'])
  })
})

describe('emptyCoachInputs', () => {
  it('is all null/false', () => {
    const i = emptyCoachInputs('/api/camps/1', new Date(FIXED_NOW))
    expect(i.participantsCount).toBeNull()
    expect(i.ndsRegistered).toBe(false)
    expect(i.updatedAt).toBe(FIXED_NOW)
  })
})
