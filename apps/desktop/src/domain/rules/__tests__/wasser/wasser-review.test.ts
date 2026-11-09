/** Review regressions: LST-WASSER-04 qualMapping + legacy aggregates, evidence labels, J+S gate. */
import { describe, expect, it } from 'vitest'
import type { AppSettings, CoachInputs, MidataQualKey } from '@/domain/types'
import { DEFAULT_APP_SETTINGS } from '@/domain/types'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCoachInputs, makeCtx, makeMidata, msg } from '../factory'

function ctxOf(title: string, md: ReturnType<typeof makeMidata>, qualMapping: Record<string, MidataQualKey[]> = {}, coachInputs: CoachInputs | null = null) {
  const b = new FactsBuilder({ start: '2031-07-12', days: 5 })
  const a = b.activity(title, CAT_LS, { responsible: false })
  b.entry(a, 2, '14:00', '16:00')
  const settings: AppSettings = { ...DEFAULT_APP_SETTINGS, midata: { ...DEFAULT_APP_SETTINGS.midata, qualMapping } }
  return makeCtx(b.facts, { midata: md, settings, coachInputs })
}
const kind = (label: string, keys: MidataQualKey[], validLeaders = 1) => ({ label, keys, validLeaders, expiredLeaders: 0 })

describe('LST-WASSER-04 review fixes', () => {
  it('uses the coach override of a label', () => {
    const md = makeMidata({ qualificationsReadable: true, qualificationKinds: [kind('Seeretter', []), kind('Anderes', ['waterBath'], 0)] })
    expect(p['LST-WASSER-04'](ctxOf('Baden im Bielersee', md))).toHaveLength(1)
    expect(p['LST-WASSER-04'](ctxOf('Baden im Bielersee', md, { Seeretter: ['waterLake'] }))).toEqual([])
  })
  it('an override that drops the key makes the setting missing', () => {
    const md = makeMidata({ qualificationsReadable: true, qualificationKinds: [kind('Modul See', ['waterLake']), kind('Basis', ['waterBath'])] })
    expect(p['LST-WASSER-04'](ctxOf('Baden im Bielersee', md))).toEqual([])
    expect(p['LST-WASSER-04'](ctxOf('Baden im Bielersee', md, { 'Modul See': [] }))).toHaveLength(1)
  })
  it('aggregate stored before v2 (no v2 key anywhere) -> hint unknown', () => {
    const md = makeMidata({ qualificationsReadable: true, qualificationKinds: [kind('Leiter LS/T', ['leiterLsT'])] })
    const [hit] = p['LST-WASSER-04'](ctxOf('Baden im Bielersee', md))
    expect(hit).toMatchObject({ variant: 'unknown', severity: 'hint' })
    expect(msg(hit)).toContain('MiData neu laden')
  })
  it('evidence snippets carry no hard-coded German label', () => {
    const md = makeMidata({ qualificationsReadable: true, qualificationKinds: [kind('x', ['waterBath'], 0)] })
    const ctx = ctxOf('Baden im Bielersee', md)
    const hits = [...p['LST-WASSER-04'](ctx), ...p['LST-WASSER-01'](ctx)]
    expect(hits.length).toBeGreaterThan(0)
    for (const h of hits) for (const e of h.evidence ?? []) expect(e.snippet ?? '').not.toMatch(/Stichwort|Setting:/)
  })
})

describe('J+S gate for J+S-specific water rules', () => {
  it('LST-WASSER-04 is silent for non-J+S camps, generic LST-WASSER-01 still runs', () => {
    const md = makeMidata({ qualificationsReadable: true, qualificationKinds: [kind('x', ['waterBath'], 0)] })
    const ctx = ctxOf('Baden im Bielersee', md, {}, makeCoachInputs({ isJsCamp: false }))
    expect(p['LST-WASSER-04'](ctx)).toEqual([])
    expect(p['LST-WASSER-01'](ctx)).toHaveLength(1)
  })
})
