import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, msg } from '../factory'
import type { ActivityTag } from '@/domain/types'

const build = (title: string, opts: { safety?: string; tags?: ActivityTag[] } = {}) => {
  const b = new FactsBuilder()
  const a = b.activity(title, CAT_LS, { content: { safetyText: opts.safety ?? '' } })
  b.entry(a, 2, '09:00', '12:00')
  return makeCtx(b.facts, { campConfig: opts.tags ? { activityTags: { [a.iri]: opts.tags } } : null })
}

const noPlaceholder = (m: string) => expect(m).not.toMatch(/\{[A-Za-z]+\}/)

describe('ski detection', () => {
  it('«Skigruppe Rot» is detected as ski (SKI-01 hit)', () => {
    expect(p['SKI-01'](build('Skigruppe Rot'))).toHaveLength(1)
  })
})

describe('SKI-01', () => {
  it('empty safety text lists all four items', () => {
    const hits = p['SKI-01'](build('Skinachmittag'))
    expect(hits).toHaveLength(1)
    const m = msg(hits[0])
    for (const t of ['Helm', 'FIS-Regeln', 'Erste Hilfe', 'Material- und Bindungskontrolle']) expect(m).toContain(t)
    noPlaceholder(m)
  })
  it('lists exactly the missing items', () => {
    const hits = p['SKI-01'](build('Skinachmittag', { safety: 'Alle tragen einen Helm. FIS-Regeln besprochen. Rettungsdecke dabei.' }))
    const m = msg(hits[0])
    expect(m).toContain('Material- und Bindungskontrolle')
    expect(m).not.toContain('Helm')
    expect(m).not.toContain('FIS-Regeln')
    expect(m).not.toContain('Erste Hilfe')
  })
  it('complete safety text, non-ski, kein-ebb -> none', () => {
    const full = 'Helm Pflicht, FIS-Regeln, Rettungsdecke, Bindungen kontrollieren'
    expect(p['SKI-01'](build('Skinachmittag', { safety: full }))).toEqual([])
    expect(p['SKI-01'](build('Geländespiel'))).toEqual([])
    expect(p['SKI-01'](build('Skinachmittag', { tags: ['kein-ebb'] }))).toEqual([])
  })
})

describe('SKI-02', () => {
  it('Freeride without plan -> hit with both slopes', () => {
    const hits = p['SKI-02'](build('Freeride am Nachmittag'))
    expect(hits).toHaveLength(1)
    const m = msg(hits[0])
    expect(m).toContain('30°')
    expect(m).toContain('35°')
    noPlaceholder(m)
  })
  it('plan in safety text, kein-ebb, plain ski -> none', () => {
    expect(p['SKI-02'](build('Freeride am Nachmittag', { safety: 'pistennah, Absprache Pisten- und Rettungsdienst' }))).toEqual([])
    expect(p['SKI-02'](build('Freeride am Nachmittag', { tags: ['kein-ebb'] }))).toEqual([])
    expect(p['SKI-02'](build('Skinachmittag'))).toEqual([])
  })
})
