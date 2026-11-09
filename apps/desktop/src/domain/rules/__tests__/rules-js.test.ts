import { describe, expect, it } from 'vitest'
import { allPredicates as p } from './predicates'
import { evaluate } from '../engine'
import { loadBundledPacks } from '../packs'
import { FactsBuilder, makeCoachInputs, makeCtx, msg } from './factory'



describe('JS-CAMP-02', () => {
  const f = new FactsBuilder().facts
  it('asks for input when missing (hint), fails below 12, passes at 12', () => {
    expect(p['JS-CAMP-02'](makeCtx(f))[0].severity).toBe('hint')
    expect(msg(p['JS-CAMP-02'](makeCtx(f, { coachInputs: makeCoachInputs({ participantsCount: 11 }) }))[0])).toMatch(/11/)
    expect(p['JS-CAMP-02'](makeCtx(f, { coachInputs: makeCoachInputs({ participantsCount: 12 }) }))).toEqual([])
  })
  it('prefers the J+S-age count', () => {
    const c = makeCoachInputs({ participantsCount: 20, participantsJsAgeCount: 10 })
    expect(p['JS-CAMP-02'](makeCtx(f, { coachInputs: c }))).toHaveLength(1)
  })
})






describe('JS-DL-01', () => {
  const b = new FactsBuilder({ start: '2031-07-12', days: 5 })
  const at = (now: string, inputs = makeCoachInputs()) => makeCtx(b.facts, { now: new Date(now), coachInputs: inputs })
  // due = 2031-06-12
  it('is silent long before the deadline', () => expect(p['JS-DL-01'](at('2031-03-01T00:00:00Z'))).toEqual([]))
  it('hints within 14 days of the deadline', () => {
    const hits = p['JS-DL-01'](at('2031-06-01T00:00:00Z'))
    expect(hits[0].severity).toBe('hint')
  })
  it('is a must when overdue and not registered', () => {
    const hits = p['JS-DL-01'](at('2031-06-13T00:00:00Z'))
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBeUndefined()
  })
  it('passes when registered in time and fails when registered late', () => {
    const ok = makeCoachInputs({ ndsRegistered: true, ndsRegisteredOn: '2031-06-12' })
    expect(p['JS-DL-01'](at('2031-06-20T00:00:00Z', ok))).toEqual([])
    const late = makeCoachInputs({ ndsRegistered: true, ndsRegisteredOn: '2031-06-13' })
    expect(p['JS-DL-01'](at('2031-06-20T00:00:00Z', late))).toHaveLength(1)
  })
})

describe('JS-DL-01/02 NDS source', () => {
  const b = new FactsBuilder({ start: '2031-07-12', days: 5 })
  const at = (now: string, inputs = makeCoachInputs()) => makeCtx(b.facts, { now: new Date(now), coachInputs: inputs })
  it('JS-DL-01 does not conclude lateness from an NDS approval date (bewilligt am)', () => {
    const inputs = makeCoachInputs({ ndsRegistered: true, ndsRegisteredOn: '2031-06-13', ndsFields: { ndsRegistered: '2031-06-14T10:00:00.000Z', ndsRegisteredOn: '2031-06-14T10:00:00.000Z' } })
    expect(p['JS-DL-01'](at('2031-06-20T00:00:00Z', inputs))).toEqual([])
  })
  it('JS-DL-01 cites Quelle: NDS when the NDS-derived input is overdue, and the engine tags it', () => {
    const inputs = makeCoachInputs({ ndsRegistered: false, ndsFields: { ndsRegistered: '2031-06-14T10:00:00.000Z' } })
    const hits = p['JS-DL-01'](at('2031-06-20T00:00:00Z', inputs))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('Quelle: NDS, Stand 14.06.2031')
    expect(hits[0].evidence?.[0].label).toBe('Quelle: NDS, Stand 14.06.2031')
    const found = evaluate(loadBundledPacks(), at('2031-06-20T00:00:00Z', inputs)).find((f) => f.ruleId === 'JS-DL-01')
    expect(found?.tags).toContain('nds-quelle')
  })
  it('JS-DL-01 without NDS badge has no NDS source and no nds-quelle tag', () => {
    const hits = p['JS-DL-01'](at('2031-06-13T00:00:00Z'))
    expect(msg(hits[0])).not.toContain('Quelle: NDS')
    const found = evaluate(loadBundledPacks(), at('2031-06-13T00:00:00Z')).find((f) => f.ruleId === 'JS-DL-01')
    expect(found?.tags).not.toContain('nds-quelle')
  })
  it('JS-DL-02 cites Quelle: NDS for an adopted closed flag closed late', () => {
    const inputs = makeCoachInputs({ ndsClosed: true, ndsClosedOn: '2031-08-16', ndsFields: { ndsClosed: '2031-09-01T10:00:00.000Z' } })
    const hits = p['JS-DL-02'](at('2031-09-02T00:00:00Z', inputs))
    expect(msg(hits[0])).toContain('Quelle: NDS, Stand 01.09.2031')
  })
})

describe('JS-DL-02', () => {
  const b = new FactsBuilder({ start: '2031-07-12', days: 5 })
  // last day 2031-07-16 (no J+S entries -> camp end) -> due 2031-08-15
  const at = (now: string, inputs = makeCoachInputs()) => makeCtx(b.facts, { now: new Date(now), coachInputs: inputs })
  it('is silent while the camp is still far away', () => expect(p['JS-DL-02'](at('2031-05-01T00:00:00Z'))).toEqual([]))
  it('hints shortly before the closing deadline', () => expect(p['JS-DL-02'](at('2031-08-10T00:00:00Z'))[0].severity).toBe('hint'))
  it('is a must when overdue', () => expect(p['JS-DL-02'](at('2031-08-16T00:00:00Z'))[0].severity).toBeUndefined())
  it('passes when closed in time, fails when closed late', () => {
    expect(p['JS-DL-02'](at('2031-09-01T00:00:00Z', makeCoachInputs({ ndsClosed: true, ndsClosedOn: '2031-08-15' })))).toEqual([])
    expect(p['JS-DL-02'](at('2031-09-01T00:00:00Z', makeCoachInputs({ ndsClosed: true, ndsClosedOn: '2031-08-16' })))).toHaveLength(1)
  })
  it('uses the last J+S day for the due date', () => {
    const c = new FactsBuilder({ start: '2031-07-12', days: 5 }).validDay(2)
    // last J+S day = 2031-07-13 -> due 2031-08-12; on 08-13 it is overdue
    expect(p['JS-DL-02'](makeCtx(c.facts, { now: new Date('2031-08-13T00:00:00Z'), coachInputs: makeCoachInputs() }))).toHaveLength(1)
  })
})

describe('JS-DL-03', () => {
  const b = new FactsBuilder({ start: '2031-07-12', days: 5 })
  // Leihmaterial due 2031-06-07, Landeskarten (summer) due 2031-06-07
  it('flags missing orders after the deadline but before the camp', () => {
    const ctx = makeCtx(b.facts, { now: new Date('2031-06-10T00:00:00Z'), coachInputs: makeCoachInputs() })
    expect(p['JS-DL-03'](ctx).map((h) => h.targets[1])).toEqual(['leihmaterial', 'landeskarten'])
  })
  it('is silent before the deadline, once ordered, and after the camp start', () => {
    expect(p['JS-DL-03'](makeCtx(b.facts, { now: new Date('2031-06-01T00:00:00Z') }))).toEqual([])
    const ordered = makeCoachInputs({ leihmaterialOrdered: true, landeskartenOrdered: true })
    expect(p['JS-DL-03'](makeCtx(b.facts, { now: new Date('2031-06-10T00:00:00Z'), coachInputs: ordered }))).toEqual([])
    expect(p['JS-DL-03'](makeCtx(b.facts, { now: new Date('2031-07-20T00:00:00Z') }))).toEqual([])
  })
  it('Landeskarten only need 3 weeks outside summer', () => {
    const w = new FactsBuilder({ start: '2031-04-20', days: 5 }) // Landeskarten due 03-30, Leihmaterial 03-16
    const ctx = makeCtx(w.facts, { now: new Date('2031-03-20T00:00:00Z') })
    expect(p['JS-DL-03'](ctx).map((h) => h.targets[1])).toEqual(['leihmaterial'])
  })
})


// JS-STAFF-01 is retired (catalog v2); see __tests__/js/JS-STAFF.test.ts



describe('MiData source on JS rules', () => {
  const f = new FactsBuilder().facts
  const stand = '2031-01-01T10:00:00.000Z'

  it('JS-CAMP-02 names the MiData source when the relied-on field was adopted', () => {
    const inputs = makeCoachInputs({ participantsJsAgeCount: 9, midataFields: { participantsJsAgeCount: stand } })
    const hit = p['JS-CAMP-02'](makeCtx(f, { coachInputs: inputs }))[0]
    expect(msg(hit)).toContain('Quelle: MiData, Stand 01.01.2031')
    expect(hit.evidence?.[0].label).toBe('Quelle: MiData, Stand 01.01.2031')
  })
  it('JS-CAMP-02 falls back to participantsCount field', () => {
    const inputs = makeCoachInputs({ participantsCount: 9, midataFields: { participantsCount: stand } })
    expect(msg(p['JS-CAMP-02'](makeCtx(f, { coachInputs: inputs }))[0])).toContain('Stand 01.01.2031')
  })
  it('JS-CAMP-02 has no source for manual values', () => {
    const hit = p['JS-CAMP-02'](makeCtx(f, { coachInputs: makeCoachInputs({ participantsCount: 9 }) }))[0]
    expect(msg(hit)).not.toContain('MiData')
    expect(hit.evidence).toBeUndefined()
  })
  it('JS-LL-01 says no Lagerleiter was found in MiData', () => {
    const inputs = makeCoachInputs({ lagerleiterAttested: false, midataFields: { lagerleiterAttested: stand } })
    const detail = msg(p['JS-LL-01'](makeCtx(f, { coachInputs: inputs }))[0])
    expect(detail).toContain('in MiData wurde keine Leitung mit «Zusatz Lagerleiter» gefunden')
    expect(detail).toContain('Stand 01.01.2031')
  })
  it('JS-LL-01 stays «nicht bestätigt» without MiData origin', () => {
    const inputs = makeCoachInputs({ lagerleiterAttested: false })
    expect(msg(p['JS-LL-01'](makeCtx(f, { coachInputs: inputs }))[0])).toBe('Zusatz Lagerleiter: nicht bestätigt')
  })
})
