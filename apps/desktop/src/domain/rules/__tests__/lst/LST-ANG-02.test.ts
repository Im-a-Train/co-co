import { describe, expect, it } from 'vitest'
import type { ActivityTag } from '@/domain/types'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, msg } from '../factory'
import { Y2027 } from './helpers'

const empty = { content: { storyboardText: '', hasStoryboard: false } }

/** Camp with one tagged J+S activity per given Erscheinungsform. */
function camp(forms: number[]) {
  const b = new FactsBuilder({ start: Y2027, days: 4 })
  const tags: Record<string, ActivityTag[]> = {}
  for (const n of forms) {
    const a = b.activity(`Block ${n}`, CAT_LS, empty)
    b.entry(a, 2, '09:00', '11:00')
    tags[a.iri] = [`ef${n}` as ActivityTag]
  }
  return { b, tags }
}

describe('LST-ANG-02', () => {
  it('EF6 missing -> hint naming it', () => {
    const { b, tags } = camp([1, 2, 3, 4, 5])
    const hits = p['LST-ANG-02'](makeCtx(b.facts, { campConfig: { activityTags: tags } }))
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toBe('Für folgende Erscheinungsformen ist keine Aktivität erkennbar: EF6 Natur und Umwelt. Im Angebot müssen alle erlebbar werden.')
  })
  it('all six covered -> none; several missing are joined', () => {
    const all = camp([1, 2, 3, 4, 5, 6])
    expect(p['LST-ANG-02'](makeCtx(all.b.facts, { campConfig: { activityTags: all.tags } }))).toEqual([])
    const some = camp([1, 2, 3, 4])
    expect(msg(p['LST-ANG-02'](makeCtx(some.b.facts, { campConfig: { activityTags: some.tags } }))[0])).toContain('EF5 Gemeinschaft, EF6 Natur und Umwelt')
  })
  it('keywords classify activities without tag', () => {
    const b = new FactsBuilder({ start: Y2027, days: 4 })
    b.entry(b.activity('Seilbrücke bauen', CAT_LS, empty), 2, '09:00', '11:00') // EF1
    const text = msg(p['LST-ANG-02'](makeCtx(b.facts))[0])
    expect(text).not.toContain('EF1')
    expect(text).toContain('EF2')
  })
  it('efCoveredElsewhere skips the rule; no mapping -> none', () => {
    const { b } = camp([1])
    const flag = { angebot: { other4DayCamp: null, unternehmungElsewhere: null, efCoveredElsewhere: true, lastActivityDate: null } }
    expect(p['LST-ANG-02'](makeCtx(b.facts, { campConfig: flag }))).toEqual([])
    expect(p['LST-ANG-02'](makeCtx(b.facts, { mapping: null }))).toEqual([])
  })
})
