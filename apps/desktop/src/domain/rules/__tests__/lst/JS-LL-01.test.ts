import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { FactsBuilder, makeCoachInputs, makeCtx, msg } from '../factory'

describe('JS-LL-01', () => {
  const f = new FactsBuilder().facts
  const stand = '2031-01-01T10:00:00.000Z'
  it('hints when unknown, must when denied, passes when attested', () => {
    expect(p['JS-LL-01'](makeCtx(f))[0].severity).toBe('hint')
    const denied = p['JS-LL-01'](makeCtx(f, { coachInputs: makeCoachInputs({ lagerleiterAttested: false }) }))
    expect(denied).toHaveLength(1)
    expect(denied[0].severity).toBeUndefined()
    expect(p['JS-LL-01'](makeCtx(f, { coachInputs: makeCoachInputs({ lagerleiterAttested: true }) }))).toEqual([])
  })
  it('is silent for non-J+S camps', () => {
    expect(p['JS-LL-01'](makeCtx(f, { coachInputs: makeCoachInputs({ isJsCamp: false, lagerleiterAttested: false }) }))).toEqual([])
  })
  it('says no Lagerleiter was found in MiData', () => {
    const inputs = makeCoachInputs({ lagerleiterAttested: false, midataFields: { lagerleiterAttested: stand } })
    const detail = msg(p['JS-LL-01'](makeCtx(f, { coachInputs: inputs }))[0])
    expect(detail).toContain('in MiData wurde keine Leitung mit «Zusatz Lagerleiter» gefunden')
    expect(detail).toContain('Stand 01.01.2031')
  })
  it('stays «nicht bestätigt» without MiData origin', () => {
    const inputs = makeCoachInputs({ lagerleiterAttested: false })
    expect(msg(p['JS-LL-01'](makeCtx(f, { coachInputs: inputs }))[0])).toBe('Zusatz Lagerleiter: nicht bestätigt')
  })
})
