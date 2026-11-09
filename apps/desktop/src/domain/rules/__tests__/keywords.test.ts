/** Keyword matcher (catalog v2 §3.5) and the bundled §6 sets. */
import { describe, expect, it } from 'vitest'
import { compileKeywordSets, matchTerms, normalizeText } from '../lib/keywords'
import type { KeywordSetDef } from '@/domain/types'
import { FactsBuilder, makeCtx } from './factory'

const set = (include: KeywordSetDef['include'], exclude: KeywordSetDef['exclude'] = []): KeywordSetDef => ({ id: 'T', include, exclude })
const kw = makeCtx(new FactsBuilder().facts).keywords
const has = (id: string, text: string) => kw.match(id, text).length > 0

describe('normalisation', () => {
  it('lower-cases, strips baden-powell, splits on non-letters and folds umlauts', () => {
    expect(normalizeText('Baden-Powell-Tag: Weiss-Blau-Weiss 3×3 Übung')).toBe('tag weiss blau weiss 3 3 uebung')
    expect(normalizeText('Fußmarsch')).toBe('fussmarsch')
  })
})

describe('matcher syntax', () => {
  it('stem, =exact (+ endings), ^prefix, $suffix', () => {
    expect(matchTerms(set(['schwimm']), 'Wir gehen Schwimmen')).toEqual(['schwimm'])
    expect(matchTerms(set(['=see']), 'am Seen')).toEqual(['see'])
    expect(matchTerms(set(['=see']), 'Seeland')).toEqual([])
    expect(matchTerms(set(['^fluss']), 'Flussfahrt')).toEqual(['fluss'])
    expect(matchTerms(set(['$boot']), 'Schlauchboote')).toEqual(['boot'])
  })

  it('umlaut folding works in both directions', () => {
    expect(matchTerms(set(['aufwärm']), 'kurzes Aufwaermen')).toEqual(['aufwärm'])
    expect(matchTerms(set(['aufwärm']), 'kurzes Aufwärmen')).toEqual(['aufwärm'])
  })

  it('phrases need word boundaries on both ends (flying fox now matches)', () => {
    expect(matchTerms(set(['flying fox']), 'Wir bauen einen Flying-Fox über den Bach')).toEqual(['flying fox'])
    expect(matchTerms(set(['"plan b"']), 'Plan B bei Regen')).toEqual(['plan b'])
    expect(matchTerms(set(['plan b']), 'Plan Bern')).toEqual([])
  })

  it('regex runs on the normalised text', () => {
    expect(matchTerms(set([{ regex: '\\b(ww|wildwasser)\\s*(iii|iv|[3-6])\\b' }]), 'Kajak im Wildwasser III')).toEqual(['wildwasser iii'])
  })

  it('exclusions: token prefix and phrase spans are removed before matching', () => {
    expect(matchTerms(set(['wasser'], ['trinkwasser']), 'Trinkwasser holen')).toEqual([])
    expect(matchTerms(set(['=see'], ['see you']), 'See you later')).toEqual([])
    expect(matchTerms(set(['=see'], ['see you']), 'See you am See')).toEqual(['see'])
  })

  it('extends merges include and exclude of other sets; unknown or cyclic extends throw', () => {
    const sets = compileKeywordSets([
      { id: 'A', include: ['kanu'], exclude: ['kanuverleih'] },
      { id: 'B', include: ['floss'], extends: ['A'] },
    ])
    expect(sets.get('B')!.tokens.map((t) => t.value)).toEqual(['floss', 'kanu'])
    expect(() => compileKeywordSets([{ id: 'X', include: ['a'], extends: ['NOPE'] }])).toThrow(/NOPE/)
    expect(() =>
      compileKeywordSets([
        { id: 'X', include: ['a'], extends: ['Y'] },
        { id: 'Y', include: ['b'], extends: ['X'] },
      ]),
    ).toThrow(/zyklisch/)
  })
})

describe('bundled sets (§6)', () => {
  it('ROPE matches «flying fox», excludes Seilziehen and Seilpark', () => {
    expect(has('ROPE', 'Flying Fox bauen')).toBe(true)
    expect(has('ROPE', 'Seilziehen')).toBe(false)
    expect(has('ROPE', 'Besuch im Seilpark')).toBe(false)
  })

  it('EBB_A: «vorbereiten» does not match =reiten, «Reiten» does; Wasserpistole is no Pistole', () => {
    expect(has('EBB_A', 'Znacht vorbereiten')).toBe(false)
    expect(has('EBB_A', 'Reiten am Nachmittag')).toBe(true)
    expect(has('EBB_A', 'Wasserpistolen-Schlacht')).toBe(false)
  })

  it('WATER excludes Trinkwasser, Seeland and Suppe', () => {
    expect(has('WATER', 'Baden im See')).toBe(true)
    expect(has('WATER', 'Trinkwasser auffüllen')).toBe(false)
    expect(has('WATER', 'Ausflug ins Seeland')).toBe(false)
    expect(has('WATER', 'Suppe kochen')).toBe(false)
  })

  it('EXCLUDED contains bruchtest; WW_HIGH detects WW III', () => {
    expect(has('EXCLUDED', 'Bruchtest mit Brettern')).toBe(true)
    expect(has('WW_HIGH', 'Kanu WW 3')).toBe(true)
    expect(has('WW_HIGH', 'Kanu WW 2')).toBe(false)
  })

  it('matchActivity reports the field and is memoised per evaluation', () => {
    const b = new FactsBuilder()
    const a = b.activity('Postenlauf', null, { location: 'am Bodensee' })
    const ctx = makeCtx(b.facts)
    const first = ctx.keywords.matchActivity('WATER', a)
    expect(first).toEqual([{ term: 'see', field: 'location' }])
    expect(ctx.keywords.matchActivity('WATER', a)).toBe(first)
    expect(() => ctx.keywords.match('NOPE', 'x')).toThrow(/NOPE/)
  })
})
