import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, msg } from '../factory'
import type { ActivityTag } from '@/domain/types'

const build = (title: string, opts: { safety?: string; tags?: ActivityTag[]; responsible?: boolean } = {}) => {
  const b = new FactsBuilder()
  const a = b.activity(title, CAT_LS, { content: { safetyText: opts.safety ?? '' }, responsible: opts.responsible })
  b.entry(a, 2, '09:00', '12:00')
  const ctx = makeCtx(b.facts, { campConfig: opts.tags ? { activityTags: { [a.iri]: opts.tags } } : null })
  return { a, ctx }
}

describe('LST-EBB-01', () => {
  it('untitled Seilpark -> should (EBB B)', () => {
    const hits = p['LST-EBB-01'](build('Seilpark').ctx)
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('vermutlich ein EBB B («seilpark»)')
  })
  it('«EBB Seilpark» without provider -> incomplete', () => {
    const hits = p['LST-EBB-01'](build('EBB Seilpark').ctx)
    expect(hits[0].variant).toBe('incomplete')
    expect(msg(hits[0])).toContain('nennt aber den Anbieter')
  })
  it('EBB A without sport term -> incomplete (tag)', () => {
    const hits = p['LST-EBB-01'](build('EBB Nachmittag', { tags: ['ebb-a'] }).ctx)
    expect(msg(hits[0])).toContain('nennt aber die J+S-Sportart')
  })
  it('complete titles and kein-ebb -> none', () => {
    expect(p['LST-EBB-01'](build('EBB ‹Firma Musterseil› – Seilpark').ctx)).toEqual([])
    expect(p['LST-EBB-01'](build('EBB ‹J+S-Skifahren› – LS Pistenmorgen').ctx)).toEqual([])
    expect(p['LST-EBB-01'](build('Seilpark', { tags: ['kein-ebb'] }).ctx)).toEqual([])
    expect(p['LST-EBB-01'](build('Geländespiel').ctx)).toEqual([])
  })
})

describe('LST-EBB-02', () => {
  const ALL5 = 'Instruktion durch Anbieter, Begleitung durch Leitende, qualifizierter Anbieter, Fähigkeit der Gruppe beachten, Wohlergehen vor Abbruch'
  it('EBB B without Instruktion -> should, names the group', () => {
    const hits = p['LST-EBB-02'](build('Seilpark', { safety: 'Begleitung durch Leitende, qualifizierter Anbieter, Fähigkeit der Gruppe, Wohlergehen' }).ctx)
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('keine Angaben zu: Sicherheitsinstruktion')
  })
  it('EBB with empty safety text -> should (A and B)', () => {
    expect(p['LST-EBB-02'](build('Seilpark').ctx)).toHaveLength(1)
    expect(p['LST-EBB-02'](build('EBB ‹J+S-Skifahren›').ctx)).toHaveLength(1)
  })
  it('all five groups, or EBB A with any safety text -> none', () => {
    expect(p['LST-EBB-02'](build('Seilpark', { safety: ALL5 }).ctx)).toEqual([])
    expect(p['LST-EBB-02'](build('Pistenmorgen', { safety: 'Helm' }).ctx)).toEqual([])
  })
})

describe('LST-EBB-03', () => {
  it('EBB A -> hint', () => {
    const hits = p['LST-EBB-03'](build('EBB ‹J+S-Skifahren› Pistenmorgen').ctx)
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('ist ein EBB A')
  })
  it('Geländespiel or EBB B -> none', () => {
    expect(p['LST-EBB-03'](build('Geländespiel').ctx)).toEqual([])
    expect(p['LST-EBB-03'](build('Seilpark').ctx)).toEqual([])
  })
})

describe('LST-EBB-04', () => {
  it('tagged without responsible -> should', () => expect(p['LST-EBB-04'](build('Seilpark', { tags: ['ebb-b'], responsible: false }).ctx)).toHaveLength(1))
  it('one responsible, or untagged -> none', () => {
    expect(p['LST-EBB-04'](build('Seilpark', { tags: ['ebb-b'] }).ctx)).toEqual([])
    expect(p['LST-EBB-04'](build('Seilpark', { responsible: false }).ctx)).toEqual([])
  })
})
