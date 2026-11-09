/** Module lst-wasser: LST-WASSER-01..10 (catalog v2 §5.6). */
import { describe, expect, it } from 'vitest'
import type { ActivityContent, ActivityTag, MidataAggregate, MidataQualKey } from '@/domain/types'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, makeMidata, msg } from '../factory'

interface Opts {
  title: string
  responsible?: boolean
  content?: Partial<ActivityContent>
  tags?: ActivityTag[]
  midata?: MidataAggregate
}

function setup(o: Opts) {
  const b = new FactsBuilder({ start: '2031-07-12', days: 5 })
  const a = b.activity(o.title, CAT_LS, { responsible: o.responsible, content: o.content })
  b.entry(a, 2, '14:00', '16:00')
  const ctx = makeCtx(b.facts, { campConfig: { activityTags: o.tags ? { [a.iri]: o.tags } : {} }, midata: o.midata })
  return { ctx, a }
}
const run = (id: string, o: Opts) => p[id](setup(o).ctx)
const safe = { safetyText: 'Aufsicht und Rettungskonzept besprochen' }

/** Aggregate with one qualification kind per key group (validLeaders as given). */
const kinds = (...rows: [label: string, keys: MidataQualKey[], valid: number][]) =>
  makeMidata({ qualificationsReadable: true, qualificationKinds: rows.map(([label, keys, validLeaders]) => ({ label, keys, validLeaders, expiredLeaders: 0 })) })

describe('LST-WASSER-01', () => {
  it('fires without responsible and without safety text', () => {
    const [hit] = run('LST-WASSER-01', { title: 'Baden im See', responsible: false })
    expect(msg(hit)).toContain('verantwortliche Leitungsperson')
    expect(msg(hit)).toContain(' und Sicherheitsüberlegungen')
  })
  it('is silent with both', () => {
    expect(run('LST-WASSER-01', { title: 'Baden im See', content: safe })).toEqual([])
  })
  it('ignores Trinkwasser', () => {
    expect(run('LST-WASSER-01', { title: 'Trinkwasser holen', responsible: false })).toEqual([])
  })
})

describe('LST-WASSER-02', () => {
  it('fires for Kajak mit Spritzdecke and hints when tagged ebb-a', () => {
    const [hit] = run('LST-WASSER-02', { title: 'Kajak mit Spritzdecke' })
    expect(msg(hit)).toContain('Spritzdecke')
    expect(run('LST-WASSER-02', { title: 'Kajak mit Spritzdecke', tags: ['ebb-a'] })[0].severity).toBe('hint')
  })
  it('fires for Gerätetauchen, not for Kanadier or Schnorcheln', () => {
    expect(run('LST-WASSER-02', { title: 'Gerätetauchen' })).toHaveLength(1)
    expect(run('LST-WASSER-02', { title: 'Kanadier' })).toEqual([])
    expect(run('LST-WASSER-02', { title: 'Schnorcheln im See' })).toEqual([])
  })
})

describe('LST-WASSER-03', () => {
  it('hints for Flossbau and is silent with a Bewilligung', () => {
    expect(run('LST-WASSER-03', { title: 'Flossbau und Fahrt' })).toHaveLength(1)
    expect(run('LST-WASSER-03', { title: 'Flossbau und Fahrt', content: { safetyText: 'Bewilligung Schifffahrtsamt liegt vor' } })).toEqual([])
  })
})

describe('LST-WASSER-04', () => {
  const rule = 'LST-WASSER-04'
  it('fires for Baden im Bielersee with waterLake 0, silent with 1', () => {
    const [hit] = run(rule, { title: 'Baden im Bielersee', midata: kinds(['Kanu', ['waterBath'], 1], ['x', ['waterLake'], 0]) })
    expect(hit.severity).toBeUndefined()
    expect(msg(hit)).toContain('(See)')
    expect(hit.redKeys).toContain('validLeaders')
    expect(run(rule, { title: 'Baden im Bielersee', midata: kinds(['Modul See', ['waterLake'], 1]) })).toEqual([])
  })
  it('does not count Modul Wasser LS/T as missing for the lake (maps to waterLake)', () => {
    expect(run(rule, { title: 'Baden im Bielersee', midata: kinds(['Modul Wasser LS/T', ['waterBath', 'waterPoolUnsupervised', 'waterLake'], 1]) })).toEqual([])
  })
  it('Baden im Seebad is a supervised bath: requires waterBath, not waterLake', () => {
    const [hit] = run(rule, { title: 'Baden im Seebad', midata: kinds(['a', ['waterBath'], 0], ['b', ['waterLake'], 1]) })
    expect(msg(hit)).toContain('beaufsichtigtes Bad')
    expect(hit.inputs?.requiredKey).toBe('waterBath')
    expect(run(rule, { title: 'Baden im Seebad', midata: kinds(['a', ['waterBath'], 1], ['b', ['waterLake'], 0]) })).toEqual([])
  })
  it('a Seebad text that also names the open lake resolves to see', () => {
    const [hit] = run(rule, { title: 'Seebad, danach Schwimmen im offenen See', midata: kinds(['a', ['waterBath'], 1], ['b', ['waterLake'], 0]) })
    expect(hit.inputs?.setting).toBe('see')
  })
  it('Flussschwimmen Aare with only a Kanu leader fires (river)', () => {
    const [hit] = run(rule, { title: 'Flussschwimmen Aare', midata: kinds(['J+S Kanusport', ['waterBath', 'waterPoolUnsupervised', 'waterLake'], 1]) })
    expect(hit.inputs?.setting).toBe('fluss')
    expect(run(rule, { title: 'Flussschwimmen Aare', midata: kinds(['Modul Fluss', ['waterRiver'], 1]) })).toEqual([])
  })
  it('unsupervised pool needs waterPoolUnsupervised', () => {
    const [hit] = run(rule, { title: 'Baden im Schwimmbad, unbeaufsichtigt', midata: kinds(['Basis Pool', ['waterBath'], 1]) })
    expect(hit.inputs?.setting).toBe('pool')
  })
  it('skips am-Wasser activities', () => {
    expect(run(rule, { title: 'Wasserrad am Bach bauen', midata: kinds(['x', ['waterRiver'], 0]) })).toEqual([])
    expect(run(rule, { title: 'Füsse baden im See', midata: kinds(['x', ['waterLake'], 0]) })).toEqual([])
  })
  it('tags override keyword detection; external supervision suppresses', () => {
    const md = kinds(['x', ['waterLake'], 0])
    expect(run(rule, { title: 'Wasserspiele', tags: ['wasser-see'], midata: md })).toHaveLength(1)
    expect(run(rule, { title: 'Baden im Bielersee', tags: ['wasser-bad-beaufsichtigt'], midata: kinds(['x', ['waterBath'], 1]) })).toEqual([])
    expect(run(rule, { title: 'Baden im Bielersee', tags: ['externe-wasseraufsicht'], midata: md })).toEqual([])
  })
  it('falls back to counting leaders when kinds are absent', () => {
    const leader = (water: boolean) => ({ nickname: 'x', roleLabel: 'Leitung', qualifications: { lagerleiter: false, leiterLsT: false, wasser: false, berg: false, winter: false, slrg: false, waterLake: water } })
    expect(run(rule, { title: 'Baden im Bielersee', midata: makeMidata({ leaders: [leader(false)] }) })).toHaveLength(1)
    expect(run(rule, { title: 'Baden im Bielersee', midata: makeMidata({ leaders: [leader(true)] }) })).toEqual([])
  })
  it('hints «nicht prüfbar» without MiData or with unreadable qualifications', () => {
    for (const midata of [undefined, makeMidata({ qualificationsReadable: false })]) {
      const [hit] = run(rule, { title: 'Baden im Bielersee', midata })
      expect(hit.severity).toBe('hint')
      expect(msg(hit)).toContain('nicht prüfbar')
    }
  })
  it('ignores non-water texts', () => {
    expect(run(rule, { title: 'Geländespiel', midata: kinds(['x', ['waterLake'], 0]) })).toEqual([])
  })
})

describe('LST-WASSER-05 Bachtrekking', () => {
  it('lists the missing points', () => {
    const [hit] = run('LST-WASSER-05', { title: 'Bachtrekking', content: { safetyText: 'Ausstieg markiert, Reko gemacht, Kraftwerk angefragt' } })
    const text = msg(hit)
    expect(text).toContain('Wetterbericht')
    expect(text).not.toContain('Rekognoszierung')
  })
  it('is silent when all four are present', () => {
    expect(run('LST-WASSER-05', { title: 'Bachtrekking', content: { safetyText: 'Wetterbericht, Ausstieg, Reko, Kraftwerk Schwall' } })).toEqual([])
  })
})

describe('LST-WASSER-06', () => {
  it('fires for Seeüberquerung, silent with Begleitboot', () => {
    expect(run('LST-WASSER-06', { title: 'Seeüberquerung' })).toHaveLength(1)
    expect(run('LST-WASSER-06', { title: 'Seeüberquerung mit Begleitboot' })).toEqual([])
  })
})

describe('LST-WASSER-07', () => {
  it('hints for Brückensprung in die Aare, not for Sprungturm im Hallenbad', () => {
    expect(run('LST-WASSER-07', { title: 'Brückensprung in die Aare' })).toHaveLength(1)
    expect(run('LST-WASSER-07', { title: 'Sprungturm Hallenbad' })).toEqual([])
  })
})

describe('LST-WASSER-08', () => {
  it('fires for Abseilen in die Schlucht, not for Schluchtwanderung alone', () => {
    expect(run('LST-WASSER-08', { title: 'Abseilen in die Schlucht' })).toHaveLength(1)
    expect(run('LST-WASSER-08', { title: 'Schluchtwanderung' })).toEqual([])
  })
})

describe('LST-WASSER-09', () => {
  it('hints without Rettungsfolie, silent with it, silent for supervised baths', () => {
    expect(run('LST-WASSER-09', { title: 'Baden im See' })).toHaveLength(1)
    expect(run('LST-WASSER-09', { title: 'Baden im See', content: { materialText: 'Rettungsfolie' } })).toEqual([])
    expect(run('LST-WASSER-09', { title: 'Baden im Hallenbad' })).toEqual([])
  })
})

describe('LST-WASSER-10', () => {
  it('fires for Kanadiertour without Weste, silent with Schwimmwesten', () => {
    expect(run('LST-WASSER-10', { title: 'Kanadiertour' })).toHaveLength(1)
    expect(run('LST-WASSER-10', { title: 'Kanadiertour', content: { safetyText: 'Schwimmwesten für alle' } })).toEqual([])
  })
})
