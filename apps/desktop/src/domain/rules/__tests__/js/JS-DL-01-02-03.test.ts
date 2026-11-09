import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import type { CtxOverrides } from '../factory'
import { FactsBuilder, makeCoachInputs, makeCtx, msg, ruleMeta } from '../factory'

// Camp 2031-07-12 .. 2031-07-16
const b = new FactsBuilder({ start: '2031-07-12', days: 5 })
const at = (now: string, inputs = makeCoachInputs(), campConfig?: CtxOverrides['campConfig']) =>
  makeCtx(b.facts, { now: new Date(now), coachInputs: inputs, ...(campConfig ? { campConfig } : {}) })

describe('JS-DL-01', () => {
  it('cites WEB-C and says approval is not guaranteed when registered late', () => {
    expect(ruleMeta('JS-DL-01').sources[0].key).toBe('WEB-C')
    const late = makeCoachInputs({ ndsRegistered: true, ndsRegisteredOn: '2031-06-13' })
    const hits = p['JS-DL-01'](at('2031-06-20T00:00:00Z', late))
    expect(hits[0].variant).toBe('late')
    expect(msg(hits[0])).toContain('Bewilligung nicht garantiert')
  })
  it('due 30 days before the start: overdue on 2031-06-13, silent when registered in time', () => {
    expect(p['JS-DL-01'](at('2031-06-13T00:00:00Z'))).toHaveLength(1)
    const ok = makeCoachInputs({ ndsRegistered: true, ndsRegisteredOn: '2031-06-12' })
    expect(p['JS-DL-01'](at('2031-06-20T00:00:00Z', ok))).toEqual([])
  })
})

describe('JS-DL-02', () => {
  it('names the consequence «kein Anspruch auf Auszahlung»', () => {
    const hits = p['JS-DL-02'](at('2031-08-16T00:00:00Z'))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('kein Anspruch auf Auszahlung')
  })
  it('uses angebot.lastActivityDate before the camp end (due 2031-07-25 + 30 = 2031-08-24)', () => {
    const angebot = { other4DayCamp: null, unternehmungElsewhere: null, efCoveredElsewhere: null, lastActivityDate: '2031-07-25' }
    expect(p['JS-DL-02'](at('2031-08-20T00:00:00Z', makeCoachInputs(), { angebot }))[0].severity).toBe('hint')
    expect(p['JS-DL-02'](at('2031-08-24T00:00:00Z', makeCoachInputs(), { angebot }))[0].severity).toBe('hint')
    expect(p['JS-DL-02'](at('2031-08-25T00:00:00Z', makeCoachInputs(), { angebot }))[0].severity).toBeUndefined()
    // without the override the camp end counts (due 2031-08-15)
    expect(p['JS-DL-02'](at('2031-08-16T00:00:00Z'))[0].severity).toBeUndefined()
  })
  it('falls back to the last J+S day', () => {
    const c = new FactsBuilder({ start: '2031-07-12', days: 5 }).validDay(2) // last J+S day 07-13 -> due 08-12
    expect(p['JS-DL-02'](makeCtx(c.facts, { now: new Date('2031-08-13T00:00:00Z'), coachInputs: makeCoachInputs() }))).toHaveLength(1)
  })
})

describe('JS-DL-03', () => {
  it('uses the Leihmaterial delivery date (08-02 - 35 d = 06-28) and omits the unknown-date note', () => {
    const inputs = makeCoachInputs({ leihmaterialDeliveryDate: '2031-08-02', landeskartenOrdered: true })
    const hits = p['JS-DL-03'](at('2031-06-30T00:00:00Z', inputs))
    expect(hits).toHaveLength(1)
    expect(hits[0].targets[1]).toBe('leihmaterial')
    expect(msg(hits[0])).toContain('28.06.2031')
    expect(msg(hits[0])).toContain('Bewilligt')
    expect(msg(hits[0])).not.toContain('Lieferdatum unbekannt')
    expect(p['JS-DL-03'](at('2031-06-26T00:00:00Z', inputs))).toEqual([])
  })
  it('says «Lieferdatum unbekannt» without delivery date', () => {
    const hits = p['JS-DL-03'](at('2031-06-10T00:00:00Z'))
    expect(msg(hits[0])).toContain('Lieferdatum unbekannt')
  })
  it('Landeskarten: summer delivery month needs 35 days, otherwise 21', () => {
    // delivery in June -> 35 d: 06-20 - 35 = 05-16
    const june = makeCoachInputs({ leihmaterialOrdered: true, landeskartenDeliveryDate: '2031-06-20' })
    expect(p['JS-DL-03'](at('2031-05-17T00:00:00Z', june)).map((h) => h.targets[1])).toEqual(['landeskarten'])
    expect(p['JS-DL-03'](at('2031-05-15T00:00:00Z', june))).toEqual([])
    // delivery in May -> 21 d: 05-30 - 21 = 05-09
    const may = makeCoachInputs({ leihmaterialOrdered: true, landeskartenDeliveryDate: '2031-05-30' })
    expect(p['JS-DL-03'](at('2031-05-10T00:00:00Z', may)).map((h) => h.targets[1])).toEqual(['landeskarten'])
    expect(p['JS-DL-03'](at('2031-05-08T00:00:00Z', may))).toEqual([])
  })
  it('is silent once ordered and after the camp start', () => {
    const ordered = makeCoachInputs({ leihmaterialOrdered: true, landeskartenOrdered: true })
    expect(p['JS-DL-03'](at('2031-06-10T00:00:00Z', ordered))).toEqual([])
    expect(p['JS-DL-03'](at('2031-07-20T00:00:00Z'))).toEqual([])
  })
})
