import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { FactsBuilder, makeCtx, makeMidata, makeNds, msg, ruleMeta } from '../factory'
import type { NdsCounts } from '@/domain/types'

const NO_COUNTS: NdsCounts = { children: null, adolescents: null, totalParticipants: null, totalInstructors: null, jsInstructors: null, campDays: null, totalActivities: null }
const ndsPlanned = (planned: Partial<NdsCounts>, participantCount = 0) =>
  makeNds({ participantCount, statistics: { planned: { ...NO_COUNTS, ...planned }, actual: { ...NO_COUNTS }, coachAuthorizedForContribution: null } })

const f = new FactsBuilder().facts // 2031-07-12 .. 07-16

describe('metadata (catalog §4.2)', () => {
  it.each([
    ['CMP-CAMP-01', 'hint', 'unverified'],
    ['CMP-MD-01', 'hint', 'best-practice'],
    ['CMP-NDS-01', 'hint', 'best-practice'],
    ['CMP-NDS-02', 'should', 'verified'],
    ['CMP-NDS-03', 'hint', 'best-practice'],
    ['CMP-CON-05', 'should', 'conflict'],
    ['CMP-CON-09', 'hint', 'conflict'],
    ['CMP-CON-10', 'hint', 'conflict'],
  ])('%s is %s/%s', (id, severity, confidence) => {
    expect(ruleMeta(id)).toMatchObject({ severity, confidence, module: 'js' })
  })
})

describe('CMP-CAMP-01', () => {
  it('fires without coach and passes with matching name', () => {
    expect(p['CMP-CAMP-01'](makeCtx(new FactsBuilder({ coachName: null }).facts))).toHaveLength(1)
    expect(p['CMP-CAMP-01'](makeCtx(f, { userDisplayName: 'Max Muster' }))).toEqual([])
  })
})

describe('CMP-MD-01 / CMP-NDS-01', () => {
  it('CMP-MD-01 fires on different dates', () => {
    const md = makeMidata({ eventDates: [{ startAt: '2031-07-13', finishAt: '2031-07-16' }] })
    const hits = p['CMP-MD-01'](makeCtx(f, { midata: md }))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('Lagerdaten in eCamp')
    expect(p['CMP-MD-01'](makeCtx(f, { midata: makeMidata() }))).toEqual([])
  })
  it('CMP-NDS-01 fires on different dates', () => {
    expect(p['CMP-NDS-01'](makeCtx(f, { nds: makeNds({ start: '2031-07-14' }) }))).toHaveLength(1)
    expect(p['CMP-NDS-01'](makeCtx(f, { nds: makeNds() }))).toEqual([])
  })
})

describe('CMP-NDS-02', () => {
  it('fires after the camp end only', () => {
    const nds = makeNds({ activities: { total: 3, byState: {}, byType: {}, lastActivityDate: null, attendanceOpenCount: 2 } })
    expect(p['CMP-NDS-02'](makeCtx(f, { nds, now: new Date('2031-07-20T00:00:00Z') }))).toHaveLength(1)
    expect(p['CMP-NDS-02'](makeCtx(f, { nds, now: new Date('2031-07-15T00:00:00Z') }))).toEqual([])
  })
})

describe('CMP-NDS-03 / CMP-CON-10 tolerance param', () => {
  it('CMP-NDS-03 follows js.participantsDiffTolerance and prints it in percent', () => {
    const nds = ndsPlanned({ totalParticipants: 14 })
    const md = makeMidata({ participantsCount: 20 })
    const hits = p['CMP-NDS-03'](makeCtx(f, { nds, midata: md }))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('über 20 %')
    expect(p['CMP-NDS-03'](makeCtx(f, { nds, midata: md, paramValues: { 'js.participantsDiffTolerance': 0.5 } }))).toEqual([])
  })
  it('CMP-CON-10 follows js.participantsDiffTolerance', () => {
    const nds = ndsPlanned({}, 14)
    const md = makeMidata({ participantsCount: 20 })
    expect(p['CMP-CON-10'](makeCtx(f, { nds, midata: md }))).toHaveLength(1)
    expect(p['CMP-CON-10'](makeCtx(f, { nds, midata: md, paramValues: { 'js.participantsDiffTolerance': 0.5 } }))).toEqual([])
  })
})

describe('CMP-CON-05', () => {
  it('counts expired Sicherheitsbereich recognitions (sbBerg)', () => {
    const md = makeMidata({
      qualificationsReadable: true,
      qualificationKinds: [{ label: 'Sicherheitsbereich Berg', keys: ['sbBerg'], validLeaders: 0, expiredLeaders: 1 }],
    })
    const hits = p['CMP-CON-05'](makeCtx(f, { midata: md }))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('Sicherheitsbereich Berg: 1 Leitende')
  })
})

describe('CMP-CON-09', () => {
  it('mentions the Jahrgang-based J+S age', () => {
    const hits = p['CMP-CON-09'](makeCtx(f, { midata: makeMidata({ participantsWithoutBirthday: 2 }) }))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('nach Jahrgang')
  })
})
