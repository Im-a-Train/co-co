/** Sport `ski`: module states, LS/T-only staffing rules and the LS/T-only 2027 Bewegungszeit-per-day criterion. */
import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCoachInputs, makeCtx, makeMidata } from '../factory'

const states = (ctx: ReturnType<typeof makeCtx>) =>
  Object.fromEntries(Object.entries(ctx.campConfig.moduleStates).map(([id, r]) => [id, r!.state]))

describe('sport ski', () => {
  it('module states: js, js-lager, ski on; lst and lst-* off; pbs per organizer', () => {
    const s = states(makeCtx(new FactsBuilder().facts, { campConfig: { sport: 'ski' } }))
    expect([s.js, s['js-lager'], s.ski]).toEqual(['on', 'on', 'on'])
    const lstStates = Object.entries(s).filter(([id]) => id === 'lst' || id.startsWith('lst-'))
    expect(lstStates.length).toBeGreaterThan(1)
    expect(lstStates.every(([, st]) => st === 'off')).toBe(true)
    expect(s.pbs).toBe('on')
    const b = new FactsBuilder()
    b.facts.camp.organizer = 'Cevi Region Bern'
    expect(states(makeCtx(b.facts, { campConfig: { sport: 'ski' } })).pbs).toBe('off')
  })

  it('lst camp: ski off, js-lager on', () => {
    const s = states(makeCtx(new FactsBuilder().facts))
    expect([s.ski, s['js-lager']]).toEqual(['off', 'on'])
  })

  it('JS-STAFF-02 ignores MiData LS/T recognitions for ski, uses them for lst', () => {
    const f = new FactsBuilder({ start: '2027-07-12' }).facts
    const over = { midata: makeMidata({ qualificationKinds: [] }), coachInputs: makeCoachInputs({ jsLeadersCount: 2 }) }
    expect(p['JS-STAFF-02'](makeCtx(f, { ...over, campConfig: { sport: 'ski' } }))).toEqual([])
    expect(p['JS-STAFF-02'](makeCtx(f, { ...over, campConfig: { sport: 'lst' } }))).toHaveLength(1)
  })

  it('JS-STAFF-03 only checks sport lst', () => {
    const f = new FactsBuilder({ start: '2027-07-12' }).facts
    const over = {
      midata: makeMidata({ participantsJsAgeCount: 60 }),
      coachInputs: makeCoachInputs({ jsLeadersCount: 1, participantsJsAgeCount: 60 }),
    }
    expect(p['JS-STAFF-03'](makeCtx(f, { ...over, campConfig: { sport: 'ski' } }))).toEqual([])
  })

  it('2027 day with 4 h J+S but BWZ < 120 is valid for ski, invalid for lst', () => {
    const mk = (sport: 'ski' | 'lst') => {
      const b = new FactsBuilder({ start: '2027-07-12', days: 3 })
      b.entry(b.activity('V', CAT_LS), 2, '09:00', '11:00', { ys: 50 })
      b.entry(b.activity('N', CAT_LS), 2, '14:00', '16:00', { ys: 50 })
      return makeCtx(b.facts, { campConfig: { sport } }).js.days[1]
    }
    expect(mk('ski')).toMatchObject({ jsMinutes: 240, isJsDay: true })
    expect(mk('lst')).toMatchObject({ isJsDay: false })
  })
})
