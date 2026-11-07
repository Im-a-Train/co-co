import { describe, expect, it } from 'vitest'
import { predicates as p } from '../packs/basis/predicates'
import { evaluate } from '../engine'
import { loadBundledPacks } from '../packs'
import { CAT_ES, CAT_LA, CAT_LS, FactsBuilder, makeCoachInputs, makeCtx, mappingOf } from './factory'

const ids = (hits: { targets: string[] }[]) => hits.map((h) => h.targets.join('|'))

describe('JS-CAMP-01', () => {
  it('passes with 4 consecutive days, fails with 3', () => {
    expect(p['JS-CAMP-01'](makeCtx(new FactsBuilder({ days: 4 }).facts))).toEqual([])
    const hits = p['JS-CAMP-01'](makeCtx(new FactsBuilder({ days: 3 }).facts))
    expect(hits).toHaveLength(1)
    expect(hits[0].params?.days).toBe(3)
  })
  it('breaks the run on date gaps and ignores non-J+S camps', () => {
    const b = new FactsBuilder({ days: 6 })
    b.facts.days.splice(3, 1) // remove day 4 -> runs of 3 and 2
    expect(p['JS-CAMP-01'](makeCtx(b.facts))).toHaveLength(1)
    const ctx = makeCtx(new FactsBuilder({ days: 2 }).facts, { coachInputs: makeCoachInputs({ isJsCamp: false }) })
    expect(p['JS-CAMP-01'](ctx)).toEqual([])
  })
})

describe('JS-CAMP-02', () => {
  const f = new FactsBuilder().facts
  it('asks for input when missing (hint), fails below 12, passes at 12', () => {
    expect(p['JS-CAMP-02'](makeCtx(f))[0].severity).toBe('hint')
    expect(p['JS-CAMP-02'](makeCtx(f, { coachInputs: makeCoachInputs({ participantsCount: 11 }) }))[0].params?.detail).toMatch(/11/)
    expect(p['JS-CAMP-02'](makeCtx(f, { coachInputs: makeCoachInputs({ participantsCount: 12 }) }))).toEqual([])
  })
  it('prefers the J+S-age count', () => {
    const c = makeCoachInputs({ participantsCount: 20, participantsJsAgeCount: 10 })
    expect(p['JS-CAMP-02'](makeCtx(f, { coachInputs: c }))).toHaveLength(1)
  })
})

describe('JS-DAY-01', () => {
  it('flags middle days with units but too little time; skips edge days and empty days', () => {
    const b = new FactsBuilder({ days: 5 })
    b.entry(b.activity('x', CAT_LS), 1, '09:00', '11:00') // edge
    b.entry(b.activity('a', CAT_LS), 2, '09:00', '11:00') // 1 unit
    b.validDay(3)
    // day 4: nothing (free day), day 5: edge
    expect(ids(p['JS-DAY-01'](makeCtx(b.facts)))).toEqual([b.dayIri(2)])
  })
  it('hints when no category is mapped to LS/LA and is silent without mapping', () => {
    const b = new FactsBuilder({ days: 3 })
    const hits = p['JS-DAY-01'](makeCtx(b.facts, { mapping: mappingOf({ [CAT_ES]: 'ES' }) }))
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBe('hint')
    expect(p['JS-DAY-01'](makeCtx(b.facts, { mapping: null }))).toEqual([])
  })
  it('judges a single-day camp itself', () => {
    const b = new FactsBuilder({ days: 1 })
    b.entry(b.activity('a', CAT_LS), 1, '09:00', '10:00')
    expect(p['JS-DAY-01'](makeCtx(b.facts))).toHaveLength(1)
  })
})

describe('JS-DAY-02', () => {
  it('flags units under 30 minutes', () => {
    const b = new FactsBuilder({ days: 3 })
    const e = b.entry(b.activity('Kurz', CAT_LS), 2, '09:00', '09:29')
    b.entry(b.activity('Genau', CAT_LS), 2, '12:00', '12:30')
    const hits = p['JS-DAY-02'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([e.iri])
    expect(hits[0].params).toMatchObject({ title: 'Kurz', minutes: 29 })
  })
})

describe('JS-DAY-03', () => {
  it('flags days with Sozialzeit gaps under 30 minutes (one hit per day)', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('a', CAT_LS), 2, '09:00', '11:00')
    b.entry(b.activity('b', CAT_LS), 2, '11:20', '12:00')
    b.entry(b.activity('c', CAT_LS), 2, '12:10', '13:00')
    const hits = p['JS-DAY-03'](makeCtx(b.facts))
    expect(ids(hits)).toEqual([b.dayIri(2)])
    expect(hits[0].params).toMatchObject({ count: 2, minutes: 10 })
  })
  it('accepts exactly 30 minutes', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('a', CAT_LS), 2, '09:00', '11:00')
    b.entry(b.activity('b', CAT_LS), 2, '11:30', '13:00')
    expect(p['JS-DAY-03'](makeCtx(b.facts))).toEqual([])
  })
})

describe('JS-DAY-04', () => {
  it('passes when combined >= 240, fails when too short, hints when nothing planned', () => {
    const ok = new FactsBuilder({ days: 3 })
    ok.entry(ok.activity('an', CAT_LS), 1, '15:00', '17:00')
    ok.entry(ok.activity('ab', CAT_LS), 3, '09:00', '11:00')
    expect(p['JS-DAY-04'](makeCtx(ok.facts))).toEqual([])

    const bad = new FactsBuilder({ days: 3 })
    bad.entry(bad.activity('an', CAT_LS), 1, '15:00', '16:00')
    bad.entry(bad.activity('ab', CAT_LS), 3, '09:00', '10:00')
    const hits = p['JS-DAY-04'](makeCtx(bad.facts))
    expect(hits[0]).toMatchObject({ targets: [bad.dayIri(1), bad.dayIri(3)], params: { minutes: 120 } })
    expect(hits[0].severity).toBeUndefined()

    const nothing = new FactsBuilder({ days: 3 })
    nothing.validDay(2)
    expect(p['JS-DAY-04'](makeCtx(nothing.facts))[0].severity).toBe('hint')
  })
  it('passes when both edge days are valid alone', () => {
    const b = new FactsBuilder({ days: 3 }).validDay(1).validDay(3)
    expect(p['JS-DAY-04'](makeCtx(b.facts))).toEqual([])
  })
})

describe('JS-DAY-05', () => {
  it('flags J+S units without warm-up keyword at the start of the storyboard', () => {
    const b = new FactsBuilder({ days: 3 })
    const bad = b.activity('Ohne', CAT_LS, { content: { storyboardText: 'Hauptteil: Postenlauf.' + ' x'.repeat(300) + ' Am Ende Aufwärmen' } })
    const ok = b.activity('Mit', CAT_LA, { content: { storyboardText: 'Einstimmen: Kreisspiel' } })
    const empty = b.activity('Leer', CAT_LS, { content: { storyboardText: '', hasStoryboard: false } })
    for (const a of [bad, ok, empty]) b.entry(a, 2, '09:00', '11:00')
    expect(ids(p['JS-DAY-05'](makeCtx(b.facts)))).toEqual([bad.iri])
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
    expect(String(hits[0].params?.detail)).toContain('Quelle: NDS, Stand 14.06.2031')
    expect(hits[0].evidence?.[0].label).toBe('Quelle: NDS, Stand 14.06.2031')
    const found = evaluate(loadBundledPacks(), at('2031-06-20T00:00:00Z', inputs)).find((f) => f.ruleId === 'JS-DL-01')
    expect(found?.tags).toContain('nds-quelle')
  })
  it('JS-DL-01 without NDS badge has no NDS source and no nds-quelle tag', () => {
    const hits = p['JS-DL-01'](at('2031-06-13T00:00:00Z'))
    expect(String(hits[0].params?.detail)).not.toContain('NDS')
    const found = evaluate(loadBundledPacks(), at('2031-06-13T00:00:00Z')).find((f) => f.ruleId === 'JS-DL-01')
    expect(found?.tags).not.toContain('nds-quelle')
  })
  it('JS-DL-02 cites Quelle: NDS for an adopted closed flag closed late', () => {
    const inputs = makeCoachInputs({ ndsClosed: true, ndsClosedOn: '2031-08-16', ndsFields: { ndsClosed: '2031-09-01T10:00:00.000Z' } })
    const hits = p['JS-DL-02'](at('2031-09-02T00:00:00Z', inputs))
    expect(String(hits[0].params?.detail)).toContain('Quelle: NDS, Stand 01.09.2031')
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

describe('JS-LL-01', () => {
  const f = new FactsBuilder().facts
  it('hints when unknown, must when denied, passes when attested', () => {
    expect(p['JS-LL-01'](makeCtx(f))[0].severity).toBe('hint')
    const denied = p['JS-LL-01'](makeCtx(f, { coachInputs: makeCoachInputs({ lagerleiterAttested: false }) }))
    expect(denied).toHaveLength(1)
    expect(denied[0].severity).toBeUndefined()
    expect(p['JS-LL-01'](makeCtx(f, { coachInputs: makeCoachInputs({ lagerleiterAttested: true }) }))).toEqual([])
  })
})

describe('JS-STAFF-01', () => {
  const f = new FactsBuilder().facts
  const run = (participants: number | null, leaders: number | null) =>
    p['JS-STAFF-01'](makeCtx(f, { coachInputs: makeCoachInputs({ participantsCount: participants, leadersCount: leaders }) }))
  it('needs 2 leaders and 1 per 10 participants', () => {
    expect(run(null, 3)).toEqual([])
    expect(run(12, 1)[0].params?.needed).toBe(2)
    expect(run(12, 2)).toEqual([])
    expect(run(25, 2)[0].params?.needed).toBe(3)
    expect(run(25, 3)).toEqual([])
  })
})

describe('JS-FREE-01', () => {
  it('lists days without J+S units (not merged edge days)', () => {
    const b = new FactsBuilder({ days: 4 }).validDay(2)
    expect(ids(p['JS-FREE-01'](makeCtx(b.facts)))).toEqual([b.dayIri(1), b.dayIri(3), b.dayIri(4)])
  })
  it('is silent without J+S mapping', () => {
    const b = new FactsBuilder({ days: 3 })
    expect(p['JS-FREE-01'](makeCtx(b.facts, { mapping: mappingOf({ [CAT_ES]: 'ES' }) }))).toEqual([])
  })
})

describe('JS-BWZ-27', () => {
  it('is only valid from 2027 and only a hint (unverified)', () => {
    const rule = loadBundledPacks()[0].rules.find((r) => r.meta.id === 'JS-BWZ-27')!
    expect(rule.meta).toMatchObject({ validFrom: '2027-01-01', severity: 'hint', confidence: 'unverified' })
    const old = new FactsBuilder({ start: '2026-07-12', days: 4 })
    old.entry(old.activity('a', CAT_LS), 2, '09:00', '11:00', { ys: 30 })
    expect(evaluate(loadBundledPacks(), makeCtx(old.facts)).some((f) => f.ruleId === 'JS-BWZ-27')).toBe(false)
  })
  it('flags days below 120 minutes of physical activity', () => {
    const b = new FactsBuilder({ days: 3 })
    b.entry(b.activity('a', CAT_LS), 1, '09:00', '11:00', { ys: 60 })
    b.entry(b.activity('b', CAT_LS), 1, '14:00', '16:00', { ys: 60 })
    b.entry(b.activity('c', CAT_LS), 2, '09:00', '11:00', { ys: 90 })
    const hits = p['JS-BWZ-27'](makeCtx(b.facts))
    expect(hits.map((h) => h.params?.minutes)).toEqual([90, 0])
  })
  it('uses the activity-level duration for single-entry activities and hints when no data exists', () => {
    const b = new FactsBuilder({ days: 2 })
    b.entry(b.activity('a', CAT_LS, { content: { ysPhysicalActivityDurationMinutes: 150 } }), 1, '09:00', '11:00')
    expect(ids(p['JS-BWZ-27'](makeCtx(b.facts)))).toEqual([b.dayIri(2)])
    const none = new FactsBuilder({ days: 2 })
    none.entry(none.activity('a', CAT_LS), 1, '09:00', '11:00')
    expect(p['JS-BWZ-27'](makeCtx(none.facts))).toHaveLength(1)
  })
})

describe('MiData source on JS rules', () => {
  const f = new FactsBuilder().facts
  const stand = '2031-01-01T10:00:00.000Z'

  it('JS-CAMP-02 names the MiData source when the relied-on field was adopted', () => {
    const inputs = makeCoachInputs({ participantsJsAgeCount: 9, midataFields: { participantsJsAgeCount: stand } })
    const hit = p['JS-CAMP-02'](makeCtx(f, { coachInputs: inputs }))[0]
    expect(hit.params?.detail).toContain('Quelle: MiData, Stand 01.01.2031')
    expect(hit.evidence?.[0].label).toBe('Quelle: MiData, Stand 01.01.2031')
  })
  it('JS-CAMP-02 falls back to participantsCount field', () => {
    const inputs = makeCoachInputs({ participantsCount: 9, midataFields: { participantsCount: stand } })
    expect(p['JS-CAMP-02'](makeCtx(f, { coachInputs: inputs }))[0].params?.detail).toContain('Stand 01.01.2031')
  })
  it('JS-CAMP-02 has no source for manual values', () => {
    const hit = p['JS-CAMP-02'](makeCtx(f, { coachInputs: makeCoachInputs({ participantsCount: 9 }) }))[0]
    expect(hit.params?.detail).not.toContain('MiData')
    expect(hit.evidence).toBeUndefined()
  })
  it('JS-LL-01 says no Lagerleiter was found in MiData', () => {
    const inputs = makeCoachInputs({ lagerleiterAttested: false, midataFields: { lagerleiterAttested: stand } })
    const detail = p['JS-LL-01'](makeCtx(f, { coachInputs: inputs }))[0].params?.detail
    expect(detail).toContain('in MiData wurde keine Leitung mit «Zusatz Lagerleiter» gefunden')
    expect(detail).toContain('Stand 01.01.2031')
  })
  it('JS-LL-01 stays «nicht bestätigt» without MiData origin', () => {
    const inputs = makeCoachInputs({ lagerleiterAttested: false })
    expect(p['JS-LL-01'](makeCtx(f, { coachInputs: inputs }))[0].params?.detail).toBe('nicht bestätigt')
  })
})
