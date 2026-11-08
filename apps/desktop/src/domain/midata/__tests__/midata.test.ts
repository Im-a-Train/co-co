import { describe, expect, it } from 'vitest'
import type { CampFacts, CoachInputs, MidataAggregate, MidataLeader, MidataQualKey, MidataRecord } from '../../types'
import {
  adoptFields,
  buildQualificationMatrix,
  compareWithInputs,
  datesDiffer,
  leadersByNormName,
  locationDiffers,
  dropEditedMidataFields,
  midataSourceOf,
  midataValueFor,
  normalizeName,
  resolveEventLink,
  type SafetyArea,
} from '../index'

const noQual: MidataLeader['qualifications'] = { lagerleiter: false, leiterLsT: false, wasser: false, berg: false, winter: false, slrg: false }
const leader = (nickname: string, q: Partial<Record<MidataQualKey, boolean>> = {}): MidataLeader => ({
  nickname,
  roleLabel: 'Leitung',
  mainLeader: false,
  qualifications: { ...noQual, ...q },
})

function agg(over: Partial<MidataAggregate> = {}): MidataAggregate {
  return {
    zone: 'red-derived',
    baseUrl: 'https://db.example.test',
    eventId: '42',
    eventName: 'Testlager',
    eventDates: [{ startAt: '2026-07-11', finishAt: '2026-07-18' }],
    location: null,
    maximumParticipants: null,
    participantsCount: 20,
    participantsJsAgeCount: 18,
    participantsWithoutBirthday: 0,
    minAge: 8,
    maxAge: 15,
    ageBands: [],
    leadersCount: 3,
    leaders: [{ ...leader('Fuchs', { lagerleiter: true, slrg: true }), mainLeader: true }, leader('Bär'), leader('Luchs', { slrg: true })],
    coachMatch: null,
    fetchedAt: '2026-06-01T10:00:00.000Z',
    ...over,
  }
}

function inputs(over: Partial<CoachInputs> = {}): CoachInputs {
  return {
    campIri: '/api/camps/1',
    isJsCamp: true,
    participantsCount: 10,
    participantsJsAgeCount: null,
    minAge: null,
    maxAge: null,
    stufe: null,
    leadersCount: null,
    slrgCount: null,
    lagerleiterAttested: null,
    ndsRegistered: false,
    ndsRegisteredOn: null,
    ndsClosed: false,
    ndsClosedOn: null,
    leihmaterialOrdered: false,
    landeskartenOrdered: false,
    lagerbewilligungDone: false,
    notes: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

describe('midataValueFor', () => {
  it('derives each field', () => {
    const a = agg()
    expect(midataValueFor(a, 'participantsCount')).toBe(20)
    expect(midataValueFor(a, 'participantsJsAgeCount')).toBe(18)
    expect(midataValueFor(a, 'minAge')).toBe(8)
    expect(midataValueFor(a, 'maxAge')).toBe(15)
    expect(midataValueFor(a, 'leadersCount')).toBe(3)
    expect(midataValueFor(a, 'slrgCount')).toBe(2)
    expect(midataValueFor(a, 'lagerleiterAttested')).toBe(true)
  })
  it('lagerleiterAttested: false without holder, null without leaders', () => {
    expect(midataValueFor(agg({ leaders: [{ ...leader('Bär'), mainLeader: true }] }), 'lagerleiterAttested')).toBe(false)
    // an assistant with the qualification does not count; no main leader known -> null
    expect(midataValueFor(agg({ leaders: [leader('Bär', { lagerleiter: true })] }), 'lagerleiterAttested')).toBeNull()
    expect(
      midataValueFor(agg({ leaders: [{ ...leader('Bär'), mainLeader: true }, leader('Luchs', { lagerleiter: true })] }), 'lagerleiterAttested'),
    ).toBe(false)
    expect(midataValueFor(agg({ leaders: [] }), 'lagerleiterAttested')).toBeNull()
    expect(midataValueFor(agg({ leaders: [], minAge: null }), 'minAge')).toBeNull()
  })
})

describe('compareWithInputs', () => {
  it('compares all fields; null inputs are empty', () => {
    const diffs = compareWithInputs(agg(), null)
    expect(diffs).toHaveLength(7)
    expect(diffs.every((d) => d.currentValue === null && !d.same && !d.fromMidata)).toBe(true)
  })
  it('detects same and fromMidata', () => {
    const diffs = compareWithInputs(agg(), inputs({ participantsCount: 20, midataFields: { participantsCount: 'x' } }))
    const d = diffs.find((x) => x.field === 'participantsCount')!
    expect(d).toMatchObject({ same: true, fromMidata: true, midataValue: 20, currentValue: 20 })
    expect(diffs.find((x) => x.field === 'minAge')!.same).toBe(false)
  })
  it('null equals null', () => {
    const d = compareWithInputs(agg({ minAge: null }), inputs()).find((x) => x.field === 'minAge')!
    expect(d.same).toBe(true)
  })
})

describe('adoptFields', () => {
  it('copies only the listed fields and sets badges', () => {
    const before = inputs({ minAge: 5, midataFields: { maxAge: 'old' } })
    const out = adoptFields(before, agg(), ['participantsCount', 'slrgCount'], '2026-06-02T00:00:00.000Z')
    expect(out.participantsCount).toBe(20)
    expect(out.slrgCount).toBe(2)
    expect(out.minAge).toBe(5)
    expect(out.midataFields).toEqual({ maxAge: 'old', participantsCount: '2026-06-01T10:00:00.000Z', slrgCount: '2026-06-01T10:00:00.000Z' })
    expect(out.updatedAt).toBe('2026-06-02T00:00:00.000Z')
    expect(before.participantsCount).toBe(10)
    expect(before.midataFields).toEqual({ maxAge: 'old' })
  })
  it('ignores unknown fields', () => {
    const out = adoptFields(inputs(), agg(), ['notes' as never, 'isJsCamp' as never], 'n')
    expect(out.notes).toBe('')
    expect(out.isJsCamp).toBe(true)
    expect(out.midataFields).toEqual({})
  })
})

describe('dropEditedMidataFields', () => {
  it('drops badges of edited fields only', () => {
    const prev = inputs({ participantsCount: 20, minAge: 8, midataFields: { participantsCount: 't', minAge: 't' } })
    const next = { ...prev, participantsCount: 21 }
    expect(dropEditedMidataFields(prev, next).midataFields).toEqual({ minAge: 't' })
  })
  it('keeps {} when all badges are dropped', () => {
    const prev = inputs({ participantsCount: 20, midataFields: { participantsCount: 't' } })
    expect(dropEditedMidataFields(prev, { ...prev, participantsCount: null }).midataFields).toEqual({})
  })
  it('leaves inputs without badges and null prev alone', () => {
    const n = inputs()
    expect(dropEditedMidataFields(inputs(), n)).toBe(n)
    const b = inputs({ midataFields: { minAge: 't' } })
    expect(dropEditedMidataFields(null, b).midataFields).toEqual({ minAge: 't' })
  })
})

describe('midataSourceOf', () => {
  it('returns the timestamp or null', () => {
    expect(midataSourceOf(inputs({ midataFields: { minAge: 't' } }), 'minAge')).toBe('t')
    expect(midataSourceOf(inputs(), 'minAge')).toBeNull()
    expect(midataSourceOf(null, 'minAge')).toBeNull()
  })
})

describe('resolveEventLink', () => {
  const rec = (eventId: string | null, eventSource: 'ecamp' | 'manual' | null): MidataRecord => ({
    campIri: 'c',
    zone: 'red-derived',
    eventId,
    eventSource,
    aggregate: null,
    updatedAt: 'x',
  })
  it('eCamp link wins', () => {
    expect(resolveEventLink({ hitobitoEventId: '7', hitobitoProvider: null }, rec('9', 'manual'))).toEqual({ eventId: '7', source: 'ecamp' })
    expect(resolveEventLink({ hitobitoEventId: '7', hitobitoProvider: 'PBS' }, null)).toEqual({ eventId: '7', source: 'ecamp' })
    expect(resolveEventLink({ hitobitoEventId: '7', hitobitoProvider: 'MiData' }, null)?.source).toBe('ecamp')
  })
  it('ignores foreign provider and falls back to stored', () => {
    expect(resolveEventLink({ hitobitoEventId: '7', hitobitoProvider: 'other' }, rec('9', null))).toEqual({ eventId: '9', source: 'manual' })
    expect(resolveEventLink({ hitobitoEventId: '7', hitobitoProvider: 'other' }, null)).toBeNull()
  })
  it('stored source and null cases', () => {
    expect(resolveEventLink({}, rec('9', 'ecamp'))).toEqual({ eventId: '9', source: 'manual' })
    expect(resolveEventLink({ hitobitoEventId: '  ' }, rec(null, null))).toBeNull()
    expect(resolveEventLink({ hitobitoEventId: null, hitobitoProvider: null }, null)).toBeNull()
  })
})

describe('normalizeName', () => {
  it('lowercases, folds diacritics, strips punctuation, collapses spaces', () => {
    expect(normalizeName('  Bär-Chen  “Ünü” ')).toBe('bar chen unu')
    expect(normalizeName('Jean-Luc')).toBe(normalizeName('Jean Luc'))
    expect(normalizeName('Strauß')).toBe(normalizeName('Strauss'))
    expect(normalizeName('Fuchs   Rot')).toBe('fuchs rot')
    expect(normalizeName('?!')).toBe('')
  })
})

describe('locationDiffers / midataDateRange', () => {
  it('compares places loosely', () => {
    expect(locationDiffers('Pfadiheim Beispiel, Bern', ['bern'])).toBe(false)
    expect(locationDiffers('Zürich', [null, 'Zurich'])).toBe(false)
    expect(locationDiffers('Chur', ['Bern'])).toBe(true)
    expect(locationDiffers(null, ['Bern'])).toBe(false)
    expect(locationDiffers('Chur', [null])).toBe(false)
  })
  it('ignores a far-away Vorweekend date', () => {
    const a = agg({ eventDates: [{ startAt: '2026-06-01', finishAt: '2026-06-02' }, { startAt: '2026-07-11', finishAt: '2026-07-18' }] })
    expect(datesDiffer(a, '2026-07-11', '2026-07-18')).toBe(false)
  })
  it('uses startAt when finishAt is empty', () => {
    expect(datesDiffer(agg({ eventDates: [{ startAt: '2026-07-11', finishAt: '' }] }), '2026-07-11', '2026-07-11')).toBe(false)
  })
})

describe('duplicate nicknames', () => {
  it('a qualified leader is not shadowed by an unqualified namesake', () => {
    const m = leadersByNormName([leader('Anna', { slrg: true }), leader('Anna')])
    expect(m.get('anna')).toHaveLength(2)
  })
})

describe('datesDiffer', () => {
  it('compares earliest start and latest end', () => {
    const a = agg({
      eventDates: [
        { startAt: '2026-07-18', finishAt: '2026-07-19' },
        { startAt: '2026-07-11T08:00:00', finishAt: '2026-07-12' },
      ],
    })
    expect(datesDiffer(a, '2026-07-11', '2026-07-19')).toBe(false)
    expect(datesDiffer(a, '2026-07-12', '2026-07-19')).toBe(true)
    expect(datesDiffer(a, '2026-07-11', '2026-07-18')).toBe(true)
  })
  it('is false when a side is missing', () => {
    expect(datesDiffer(agg(), null, '2026-07-18')).toBe(false)
    expect(datesDiffer(agg(), '2026-07-11', null)).toBe(false)
    expect(datesDiffer(agg({ eventDates: [] }), '2026-07-11', '2026-07-18')).toBe(false)
  })
})

function facts(): CampFacts {
  const collab = (n: string, name: string) => ({
    iri: `/api/camp_collaborations/${n}`,
    userIri: null,
    role: 'member',
    status: 'established',
    displayName: name,
    nickname: name,
    firstname: null,
    surname: null,
    abbreviation: null,
    isCurrentUser: false,
  })
  const act = (n: string, title: string) => ({ iri: `/api/activities/${n}`, title })
  return {
    collaborators: [collab('1', 'Fuchs'), collab('2', 'bär'), collab('3', 'Dachs')],
    activities: [act('a', 'Schwimmen'), act('b', 'Wanderung'), act('c', 'Baden und Gletscher'), act('d', 'Spiel')],
    activityResponsibles: [
      { iri: 'r1', activityIri: '/api/activities/a', collaborationIri: '/api/camp_collaborations/1' },
      { iri: 'r2', activityIri: '/api/activities/b', collaborationIri: '/api/camp_collaborations/2' },
      { iri: 'r3', activityIri: '/api/activities/c', collaborationIri: '/api/camp_collaborations/3' },
    ],
  } as unknown as CampFacts
}
const areas: Record<string, SafetyArea[]> = {
  '/api/activities/a': ['wasser'],
  '/api/activities/b': ['berg'],
  '/api/activities/c': ['wasser', 'berg'],
}
const areaOf = (iri: string) => areas[iri] ?? []

describe('buildQualificationMatrix', () => {
  const m = buildQualificationMatrix(agg(), facts(), areaOf)
  it('columns in stable order incl. slrg with water', () => {
    expect(m.columns).toEqual(['lagerleiter', 'leiterLsT', 'wasser', 'berg', 'slrg'])
  })
  it('base columns only when no safety activities', () => {
    expect(buildQualificationMatrix(agg(), facts(), () => []).columns).toEqual(['lagerleiter', 'leiterLsT'])
    expect(buildQualificationMatrix(agg(), facts(), () => ['winter']).columns).toEqual(['lagerleiter', 'leiterLsT', 'winter'])
  })
  it('rows have all cells and ecamp matches by normalized name', () => {
    expect(m.rows).toHaveLength(3)
    expect(Object.keys(m.rows[0]!.cells).sort()).toEqual(['berg', 'lagerleiter', 'leiterLsT', 'slrg', 'wasser', 'winter'])
    expect(m.rows[0]).toMatchObject({ nickname: 'Fuchs', ecampMatches: ['Fuchs'] })
    expect(m.rows[1]!.ecampMatches).toEqual(['bär'])
    expect(m.rows[2]!.ecampMatches).toEqual([])
  })
  it('covered counts', () => {
    expect(m.covered).toMatchObject({ lagerleiter: 1, slrg: 2, berg: 0, leiterLsT: 0 })
  })
  it('activity checks per area', () => {
    expect(m.activities).toHaveLength(4)
    const a = m.activities.find((x) => x.activityIri.endsWith('/a'))!
    expect(a).toMatchObject({ area: 'wasser', required: ['wasser', 'slrg'], responsibles: ['Fuchs'], qualifiedResponsibles: ['Fuchs'], ok: true })
    const b = m.activities.find((x) => x.activityIri.endsWith('/b'))!
    expect(b).toMatchObject({ area: 'berg', responsibles: ['bär'], qualifiedResponsibles: [], ok: false })
    const cs = m.activities.filter((x) => x.activityIri.endsWith('/c'))
    expect(cs.map((x) => x.area)).toEqual(['wasser', 'berg'])
    expect(cs.every((x) => x.ok === null && x.responsibles[0] === 'Dachs')).toBe(true)
    expect(m.fetchedAt).toBe('2026-06-01T10:00:00.000Z')
  })
})
