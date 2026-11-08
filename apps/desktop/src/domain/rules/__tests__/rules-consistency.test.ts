import { describe, expect, it } from 'vitest'
import { allPredicates as p } from './predicates'
import { evaluate } from '../engine'
import { loadBundledPacks } from '../packs'
import type { CollaboratorFact, MidataAggregate, MidataLeader, MidataQualKey, NdsAggregate, NdsCounts, RuleContext } from '@/domain/types'
import { CAT_LA, FactsBuilder, makeCtx, makeMidata, makeNds, msg } from './factory'

const NO_COUNTS: NdsCounts = { children: null, adolescents: null, totalParticipants: null, totalInstructors: null, jsInstructors: null, campDays: null, totalActivities: null }
const ndsWith = (planned: Partial<NdsCounts>, over: Partial<NdsAggregate> = {}) =>
  makeNds({ statistics: { planned: { ...NO_COUNTS, ...planned }, actual: { ...NO_COUNTS }, coachAuthorizedForContribution: null }, ...over })

const leader = (nickname: string, quals: Partial<Record<MidataQualKey, boolean>> = {}, main?: boolean): MidataLeader => ({
  nickname,
  roleLabel: 'Leitung',
  ...(main === undefined ? {} : { mainLeader: main }),
  qualifications: { lagerleiter: false, leiterLsT: false, wasser: false, berg: false, winter: false, slrg: false, ...quals },
})

const collab = (n: number, name: string, over: Partial<CollaboratorFact> = {}): CollaboratorFact => ({
  iri: `/api/camp_collaborations/cc${n}`, userIri: null, role: 'member', status: 'established', displayName: name,
  nickname: name, firstname: null, surname: null, abbreviation: null, isCurrentUser: false, ...over,
})

const base = () => new FactsBuilder({ start: '2031-07-12', days: 5 })
const f = base().facts
const one = (id: string, ctx: RuleContext) => p[id](ctx)

describe('CMP-CON-01', () => {
  it('hits when MiData and NDS dates differ', () => {
    const h = one('CMP-CON-01', makeCtx(f, { midata: makeMidata(), nds: makeNds({ end: '2031-07-18' }) }))
    expect(h).toHaveLength(1)
    const m = msg(h[0])
    expect(m).toContain('12.07.2031–16.07.2031')
    expect(m).toContain('12.07.2031–18.07.2031')
    expect(m).toContain('Quelle: MiData, Stand 01.01.2031')
    expect(m).toContain('Quelle: NDS, Stand 01.01.2031')
  })
  it('is silent when equal or a source is missing', () => {
    expect(one('CMP-CON-01', makeCtx(f, { midata: makeMidata(), nds: makeNds() }))).toEqual([])
    expect(one('CMP-CON-01', makeCtx(f, { midata: makeMidata() }))).toEqual([])
    expect(one('CMP-CON-01', makeCtx(f, { nds: makeNds({ end: '2031-07-18' }) }))).toEqual([])
    expect(one('CMP-CON-01', makeCtx(f, { midata: makeMidata(), nds: makeNds({ start: null }) }))).toEqual([])
  })
})

describe('CMP-CON-02', () => {
  const team = () => {
    const b = base()
    b.facts.collaborators.push(collab(1, 'A'), collab(2, 'B'), collab(3, 'G', { role: 'guest' }), collab(4, 'I', { status: 'invited' }))
    return b.facts
  }
  it('hits listing every present source', () => {
    const h = one('CMP-CON-02', makeCtx(team(), { midata: makeMidata({ leadersCount: 3 }), nds: ndsWith({ totalInstructors: 4 }) }))
    expect(h).toHaveLength(1)
    expect(msg(h[0])).toContain('eCamp 2, MiData 3, NDS 4')
  })
  it('falls back to supervisorCounts', () => {
    const h = one('CMP-CON-02', makeCtx(team(), { nds: makeNds({ supervisorCounts: { INSTRUCTOR: 2, ASSISTANT_INSTRUCTOR: 1 } }) }))
    expect(msg(h[0])).toContain('NDS 3')
  })
  it('is silent when equal or fewer than two sources', () => {
    expect(one('CMP-CON-02', makeCtx(team(), { midata: makeMidata({ leadersCount: 2 }), nds: ndsWith({ totalInstructors: 2 }) }))).toEqual([])
    expect(one('CMP-CON-02', makeCtx(team()))).toEqual([])
    expect(one('CMP-CON-02', makeCtx(f, { midata: makeMidata({ leadersCount: 2 }) }))).toEqual([])
    expect(one('CMP-CON-02', makeCtx(team(), { nds: makeNds() }))).toEqual([])
  })
})

describe('CMP-CON-03', () => {
  const team = (...names: string[]) => {
    const b = base()
    names.forEach((n, i) => b.facts.collaborators.push(collab(i + 1, n)))
    return b.facts
  }
  it('lists unmatched people on both sides', () => {
    const h = one('CMP-CON-03', makeCtx(team('Blitz', 'Funke'), { midata: makeMidata({ leaders: [leader('blitz'), leader('Rakete')] }) }))
    expect(h).toHaveLength(1)
    const m = msg(h[0])
    expect(m).toContain('In eCamp, aber nicht in MiData: «Funke»')
    expect(m).toContain('In MiData, aber nicht in eCamp: «Rakete»')
  })
  it('caps names at 10 with +n', () => {
    const many = Array.from({ length: 13 }, (_, i) => `Mi${i}x`)
    const h = one('CMP-CON-03', makeCtx(team('Blitz'), { midata: makeMidata({ leaders: [leader('Blitz'), ...many.map((n) => leader(n))] }) }))
    expect(msg(h[0])).toContain('+3')
  })
  it('is silent when all match, nothing matches, or MiData is missing', () => {
    expect(one('CMP-CON-03', makeCtx(team('Blitz'), { midata: makeMidata({ leaders: [leader('Blitz')] }) }))).toEqual([])
    expect(one('CMP-CON-03', makeCtx(team('Blitz'), { midata: makeMidata({ leaders: [leader('Anderer')] }) }))).toEqual([])
    expect(one('CMP-CON-03', makeCtx(team('Blitz')))).toEqual([])
  })
})

describe('CMP-CON-04', () => {
  const md = (leaders: MidataLeader[], over: Partial<MidataAggregate> = {}) => makeMidata({ leaders, ...over })
  it('hits when NDS plans more J+S leaders than qualified in MiData', () => {
    const h = one('CMP-CON-04', makeCtx(f, { midata: md([leader('A', { leiterLsT: true }), leader('B')]), nds: ndsWith({ jsInstructors: 3 }) }))
    expect(h).toHaveLength(1)
    expect(msg(h[0])).toContain('In der NDS sind 3 J+S-Leitende geplant, in MiData haben nur 1 eine über die ganze Lagerdauer gültige Anerkennung')
  })
  it('is silent when enough, unreadable, or a source is missing', () => {
    const ok = md([leader('A', { lagerleiter: true }), leader('B', { leiterLsT: true })])
    expect(one('CMP-CON-04', makeCtx(f, { midata: ok, nds: ndsWith({ jsInstructors: 2 }) }))).toEqual([])
    expect(one('CMP-CON-04', makeCtx(f, { midata: md([leader('A')], { qualificationsReadable: false }), nds: ndsWith({ jsInstructors: 3 }) }))).toEqual([])
    expect(one('CMP-CON-04', makeCtx(f, { midata: ok, nds: ndsWith({ jsInstructors: null }) }))).toEqual([])
    expect(one('CMP-CON-04', makeCtx(f, { midata: ok }))).toEqual([])
    expect(one('CMP-CON-04', makeCtx(f, { nds: ndsWith({ jsInstructors: 3 }) }))).toEqual([])
  })
})

describe('CMP-CON-05', () => {
  const kinds = [
    { label: 'Leiter*in Lagersport', keys: ['leiterLsT' as const], validLeaders: 2, expiredLeaders: 2 },
    { label: 'Erste Hilfe', keys: [], validLeaders: 3, expiredLeaders: 1 },
    { label: 'Kurs Berg', keys: ['berg' as const], validLeaders: 1, expiredLeaders: 0 },
  ]
  it('lists expired relevant kinds in one hit', () => {
    const h = one('CMP-CON-05', makeCtx(f, { midata: makeMidata({ qualificationKinds: kinds }) }))
    expect(h).toHaveLength(1)
    const m = msg(h[0])
    expect(m).toContain('Leiter*in Lagersport: 2 Leitende')
    expect(m).not.toContain('Erste Hilfe')
  })
  it('honours the settings mapping override', () => {
    const settings = { ...makeCtx(f).settings, midata: { ...makeCtx(f).settings.midata, qualMapping: { 'Erste Hilfe': ['wasser' as const] } } }
    const h = one('CMP-CON-05', makeCtx(f, { settings, midata: makeMidata({ qualificationKinds: kinds }) }))
    expect(msg(h[0])).toContain('Erste Hilfe: 1 Leitende')
  })
  it('is silent without expiry, kinds, readable data or MiData', () => {
    expect(one('CMP-CON-05', makeCtx(f, { midata: makeMidata({ qualificationKinds: [kinds[2]] }) }))).toEqual([])
    expect(one('CMP-CON-05', makeCtx(f, { midata: makeMidata() }))).toEqual([])
    expect(one('CMP-CON-05', makeCtx(f, { midata: makeMidata({ qualificationKinds: kinds, qualificationsReadable: false }) }))).toEqual([])
    expect(one('CMP-CON-05', makeCtx(f))).toEqual([])
  })
})

describe('CMP-CON-06', () => {
  it('hits when no main leader is set', () => {
    const h = one('CMP-CON-06', makeCtx(f, { midata: makeMidata({ leaders: [leader('A', {}, false), leader('B', {}, false)] }) }))
    expect(h).toHaveLength(1)
  })
  it('is silent with a main leader, without the field, or without MiData', () => {
    expect(one('CMP-CON-06', makeCtx(f, { midata: makeMidata({ leaders: [leader('A', {}, true)] }) }))).toEqual([])
    expect(one('CMP-CON-06', makeCtx(f, { midata: makeMidata({ leaders: [leader('A')] }) }))).toEqual([])
    expect(one('CMP-CON-06', makeCtx(f))).toEqual([])
  })
})

describe('CMP-CON-07', () => {
  it('hits when camp days differ', () => {
    const h = one('CMP-CON-07', makeCtx(f, { nds: ndsWith({ campDays: 4 }) }))
    expect(h).toHaveLength(1)
    expect(msg(h[0])).toContain('4 Lagertage geplant, in eCamp 5')
  })
  it('uses the date range when no days are loaded', () => {
    const g = { ...f, days: [] }
    expect(one('CMP-CON-07', makeCtx(g, { nds: ndsWith({ campDays: 5 }) }))).toEqual([])
    expect(one('CMP-CON-07', makeCtx(g, { nds: ndsWith({ campDays: 6 }) }))).toHaveLength(1)
  })
  it('is silent when equal, null or without NDS', () => {
    expect(one('CMP-CON-07', makeCtx(f, { nds: ndsWith({ campDays: 5 }) }))).toEqual([])
    expect(one('CMP-CON-07', makeCtx(f, { nds: makeNds() }))).toEqual([])
    expect(one('CMP-CON-07', makeCtx(f))).toEqual([])
  })
})

describe('CMP-CON-08', () => {
  it('hits above the maximum', () => {
    const h = one('CMP-CON-08', makeCtx(f, { midata: makeMidata({ participantsCount: 25, maximumParticipants: 20 }) }))
    expect(h).toHaveLength(1)
  })
  it('is silent within the limit, without a limit or MiData', () => {
    expect(one('CMP-CON-08', makeCtx(f, { midata: makeMidata({ participantsCount: 20, maximumParticipants: 20 }) }))).toEqual([])
    expect(one('CMP-CON-08', makeCtx(f, { midata: makeMidata({ maximumParticipants: 0 }) }))).toEqual([])
    expect(one('CMP-CON-08', makeCtx(f, { midata: makeMidata() }))).toEqual([])
    expect(one('CMP-CON-08', makeCtx(f))).toEqual([])
  })
})

describe('CMP-CON-09', () => {
  it('hits when birthdays are missing', () => {
    const h = one('CMP-CON-09', makeCtx(f, { midata: makeMidata({ participantsWithoutBirthday: 3 }) }))
    expect(msg(h[0])).toContain('Bei 3 Teilnehmenden')
  })
  it('is silent with none missing or without MiData', () => {
    expect(one('CMP-CON-09', makeCtx(f, { midata: makeMidata() }))).toEqual([])
    expect(one('CMP-CON-09', makeCtx(f))).toEqual([])
  })
})

describe('CMP-CON-10', () => {
  it('hits above 20 % difference', () => {
    const h = one('CMP-CON-10', makeCtx(f, { midata: makeMidata({ participantsCount: 20 }), nds: makeNds({ participantCount: 30 }) }))
    expect(h).toHaveLength(1)
  })
  it('is silent when close, empty NDS list or a source missing', () => {
    expect(one('CMP-CON-10', makeCtx(f, { midata: makeMidata({ participantsCount: 20 }), nds: makeNds({ participantCount: 22 }) }))).toEqual([])
    expect(one('CMP-CON-10', makeCtx(f, { midata: makeMidata({ participantsCount: 20 }), nds: makeNds({ participantCount: 0 }) }))).toEqual([])
    expect(one('CMP-CON-10', makeCtx(f, { nds: makeNds({ participantCount: 30 }) }))).toEqual([])
    expect(one('CMP-CON-10', makeCtx(f, { midata: makeMidata() }))).toEqual([])
  })
})

describe('engine tagging of consistency findings', () => {
  const [pack] = loadBundledPacks()
  const b = base()
  b.facts.collaborators.push(collab(1, 'Blitz'), collab(2, 'Funke'))
  b.activity('Wanderung zum Gipfel', CAT_LA, { content: { safetyText: 'Aufsicht' } })
  const md = makeMidata({
    participantsCount: 30,
    maximumParticipants: 20,
    participantsWithoutBirthday: 2,
    leadersCount: 5,
    leaders: [leader('Blitz', {}, false), leader('Rakete', {}, false)],
    qualificationKinds: [{ label: 'Leiter', keys: ['leiterLsT'], validLeaders: 0, expiredLeaders: 1 }],
  })
  const nds = ndsWith({ jsInstructors: 3, campDays: 4, totalInstructors: 2 }, { end: '2031-07-18', participantCount: 10 })
  const findings = evaluate([pack], makeCtx(b.facts, { midata: md, nds }))
  const byId = (id: string) => findings.filter((x) => x.ruleId === id)

  it.each(['CMP-CON-01', 'CMP-CON-02', 'CMP-CON-03', 'CMP-CON-04', 'CMP-CON-05', 'CMP-CON-06', 'CMP-CON-08', 'CMP-CON-09', 'CMP-CON-10'])(
    '%s is tagged red-derived midata',
    (id) => {
      const fs = byId(id)
      expect(fs.length, id).toBeGreaterThan(0)
      for (const x of fs) expect(x.tags, id).toContain('midata')
    },
  )
  it.each(['CMP-CON-01', 'CMP-CON-02', 'CMP-CON-04', 'CMP-CON-07', 'CMP-CON-10'])('%s is tagged nds-quelle', (id) => {
    const fs = byId(id)
    expect(fs.length, id).toBeGreaterThan(0)
    for (const x of fs) expect(x.tags, id).toContain('nds-quelle')
  })
})
