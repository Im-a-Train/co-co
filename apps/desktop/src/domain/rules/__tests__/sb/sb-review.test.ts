/** Review regressions: SB approvals per area, qualMapping overrides, aggregates without v2 keys. */
import { describe, expect, it } from 'vitest'
import type { AppSettings, CampRuleConfig, MidataQualKey } from '@/domain/types'
import { DEFAULT_APP_SETTINGS } from '@/domain/types'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, makeMidata, msg } from '../factory'

const settingsWith = (qualMapping: Record<string, MidataQualKey[]>): AppSettings => ({
  ...DEFAULT_APP_SETTINGS,
  midata: { ...DEFAULT_APP_SETTINGS.midata, qualMapping },
})

function camp(start: string) {
  const b = new FactsBuilder({ start, days: 5 })
  const a = b.activity('Tour', CAT_LS)
  b.entry(a, 1, '09:00', '12:00')
  return { b, a }
}
const winterNoAccess: Partial<CampRuleConfig> = { camp: { region: null, campForm: null, winterSafeAccess: false, abroad: null } }

describe('LST-SB-02: Bergführer exception only for Berg', () => {
  const run = (tag: 'sb-berg' | 'sb-wasser' | 'sb-winter') => {
    const { b, a } = camp('2027-07-12')
    return p['LST-SB-02'](makeCtx(b.facts, { campConfig: { activityTags: { [a.iri]: [tag] }, sbApprovals: { [a.iri]: { approvedOn: null, kind: 'bergfuehrer' } } } }))
  }
  it('satisfies sb-berg only', () => {
    expect(run('sb-berg')).toEqual([])
    expect(run('sb-wasser')).toHaveLength(1)
    expect(run('sb-winter')).toHaveLength(1)
  })
  it('does not satisfy the camp-level winter case', () => {
    const { b } = camp('2027-02-08')
    const campConfig = { ...winterNoAccess, sbApprovals: { camp: { approvedOn: null, kind: 'bergfuehrer' as const } } }
    expect(p['LST-SB-02'](makeCtx(b.facts, { campConfig }))).toHaveLength(1)
  })
})

describe('LST-SB-03: qualMapping and legacy aggregates', () => {
  const { b, a } = camp('2027-07-12')
  const campConfig: Partial<CampRuleConfig> = { activityTags: { [a.iri]: ['sb-berg'] } }
  it('honours the coach override of a label', () => {
    const md = makeMidata({
      qualificationsReadable: true,
      qualificationKinds: [
        { label: 'Bergkurs', keys: [], validLeaders: 1, expiredLeaders: 0 },
        { label: 'Zusatz Wasser', keys: ['sbWasser'], validLeaders: 1, expiredLeaders: 0 },
      ],
    })
    expect(p['LST-SB-03'](makeCtx(b.facts, { campConfig, midata: md }))).toHaveLength(1)
    expect(p['LST-SB-03'](makeCtx(b.facts, { campConfig, midata: md, settings: settingsWith({ Bergkurs: ['sbBerg'] }) }))).toEqual([])
  })
  it('an override removing the key makes the area missing', () => {
    const md = makeMidata({
      qualificationsReadable: true,
      qualificationKinds: [
        { label: 'Zusatz Berg', keys: ['sbBerg'], validLeaders: 1, expiredLeaders: 0 },
        { label: 'Zusatz Wasser', keys: ['sbWasser'], validLeaders: 1, expiredLeaders: 0 },
      ],
    })
    const ctx = makeCtx(b.facts, { campConfig, midata: md, settings: settingsWith({ 'Zusatz Berg': [] }) })
    const hits = p['LST-SB-03'](ctx)
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('Berg')
  })
  it('aggregate without any v2 key -> hint unknown (MiData neu laden), never must/should', () => {
    const md = makeMidata({
      qualificationsReadable: true,
      qualificationKinds: [{ label: 'J+S-Leiter/in LS/T', keys: ['leiterLsT'], validLeaders: 2, expiredLeaders: 0 }],
      leaders: [{ nickname: 'A', roleLabel: 'Leitung', qualifications: { lagerleiter: false, leiterLsT: true, wasser: false, berg: false, winter: false, slrg: false } }],
    })
    const h = p['LST-SB-03'](makeCtx(b.facts, { campConfig, midata: md }))
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ variant: 'unknown', severity: 'hint' })
    expect(msg(h[0])).toContain('MiData neu laden')
  })
})

describe('LST-SB-04: no birth-year data', () => {
  it('stays silent without participantsByBirthYear', () => {
    const { b, a } = camp('2027-07-12')
    const campConfig: Partial<CampRuleConfig> = { activityTags: { [a.iri]: ['sb-berg'] } }
    expect(p['LST-SB-04'](makeCtx(b.facts, { campConfig, midata: makeMidata() }))).toEqual([])
  })
})
