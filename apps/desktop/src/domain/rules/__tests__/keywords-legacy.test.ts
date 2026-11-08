import { describe, expect, it } from 'vitest'
import { FactsBuilder, makeCtx } from './factory'

const keywords = makeCtx(new FactsBuilder().facts).keywords
const hasKeyword = (text: string, set: string) => keywords.match(set, text).length > 0
const matchKeywords = (text: string, set: string) => keywords.match(set, text).map((m) => m.term)
const [WATER, MOUNTAIN, ROPE, NIGHT] = ['WATER', 'MOUNTAIN', 'ROPE', 'NIGHT']


describe('keyword matcher', () => {
  it('matches German stems and compounds, honours exclusions', () => {
    expect(hasKeyword('Baden im Aaresee', WATER)).toBe(true)
    expect(hasKeyword('Kanufahrt auf der Aare', WATER)).toBe(true)
    expect(hasKeyword('Schlauchboot-Rennen', WATER)).toBe(true)
    expect(hasKeyword('Trinkwasser nachfüllen', WATER)).toBe(false)
    expect(hasKeyword('Seeland und Seelen', WATER)).toBe(false)
    expect(hasKeyword('Skills und Skizzen', MOUNTAIN)).toBe(false)
    expect(hasKeyword('Skitour am Pass', MOUNTAIN)).toBe(true)
    expect(hasKeyword('Passwort', MOUNTAIN)).toBe(false)
    expect(hasKeyword('Seilziehen', ROPE)).toBe(false)
    expect(hasKeyword('Seilbrücke bauen', ROPE)).toBe(true)
    expect(hasKeyword('Nachtessen', NIGHT)).toBe(false)
    expect(hasKeyword('Nachtwanderung', NIGHT)).toBe(true)
    expect(matchKeywords('Gipfelsturm', MOUNTAIN)).toEqual(['gipfel'])
  })
})
