import { describe, expect, it } from 'vitest'
import { allPredicates as p } from '../predicates'
import { CAT_LS, FactsBuilder, makeCtx, msg, ruleMeta } from '../factory'

function run(title: string, tags: string[] = [], over: { storyboard?: string } = {}) {
  const b = new FactsBuilder()
  const a = b.activity(title, CAT_LS, { content: over.storyboard ? { storyboardText: over.storyboard } : {} })
  const ctx = makeCtx(b.facts, { campConfig: { activityTags: { [a.iri]: tags as never } } })
  return p['JS-EXCL-01'](ctx)
}

describe('JS-EXCL-01', () => {
  it('is should/heuristic', () => {
    expect(ruleMeta('JS-EXCL-01')).toMatchObject({ severity: 'should', confidence: 'heuristic', scope: 'activity' })
  })
  it('flags Canyoning', () => {
    const hits = run('Canyoning im Tessin')
    expect(hits).toHaveLength(1)
    expect(msg(hits[0])).toContain('Art. 6 Abs. 2 SpoFöV')
    expect(hits[0].severity).toBeUndefined()
  })
  it('flags Kickbox-Training and Bruchtest mit Brettern', () => {
    expect(run('Kickbox-Training')).toHaveLength(1)
    expect(run('Bruchtest mit Brettern')).toHaveLength(1)
  })
  it('flags Rafting WW III with variant ww', () => {
    const hits = run('Rafting WW III')
    expect(hits).toHaveLength(1)
    expect(hits[0].variant).toBe('ww')
    expect(msg(hits[0])).toContain('Wildwasser ab Grad III')
  })
  it('lowers a WW-only hit to hint for ebb-a tagged activities (Kanusport exception), but not other hits', () => {
    expect(run('Rafting WW III', ['ebb-a'])[0].severity).toBe('hint')
    expect(run('Canyoning', ['ebb-a'])[0].severity).toBeUndefined()
  })
  it('also reads the storyboard', () => {
    expect(run('Nachmittag', [], { storyboard: 'Wir gehen Canyoning' })).toHaveLength(1)
  })
  it('does not flag Schlucht or Kartenlesen', () => {
    expect(run('Bachtrekking durch die Schlucht')).toEqual([])
    expect(run('Kartenlesen')).toEqual([])
  })
})
