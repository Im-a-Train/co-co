import { describe, expect, it } from 'vitest'
import { defaultCampRuleConfig } from '../lib/campRuleConfig'
import { withActivityTags } from '../lib/campConfigEdit'
import type { ActivityTag } from '@/domain/types'

const c0 = defaultCampRuleConfig('/api/camps/c1')
const tagsOf = (c: ReturnType<typeof withActivityTags>) => c.activityTags.a1 ?? []
const add = (before: ActivityTag[], tag: ActivityTag) => tagsOf(withActivityTags(withActivityTags(c0, 'a1', before), 'a1', [...before, tag]))

describe('withActivityTags: contradicting tags', () => {
  it.each<[ActivityTag[], ActivityTag, ActivityTag[]]>([
    [['js-aktivitaet'], 'keine-js-aktivitaet', ['keine-js-aktivitaet']],
    [['keine-js-aktivitaet'], 'js-aktivitaet', ['js-aktivitaet']],
    [['unternehmung'], 'keine-unternehmung', ['keine-unternehmung']],
    [['sb-berg', 'sb-wasser'], 'kein-sb', ['kein-sb']],
    [['kein-sb'], 'sb-winter', ['sb-winter']],
    [['ebb-a'], 'ebb-b', ['ebb-b']],
    [['ebb-b'], 'kein-ebb', ['kein-ebb']],
    [['kein-ebb', 'ef1'], 'ebb-a', ['ef1', 'ebb-a']],
    [['wasser-pool'], 'wasser-fluss', ['wasser-fluss']],
    [['wasser-see'], 'wasser-bad-beaufsichtigt', ['wasser-bad-beaufsichtigt']],
  ])('%j + %s -> %j (the new tag wins)', (before, tag, expected) => {
    expect(add(before, tag)).toEqual(expected)
  })
  it('several sb-* areas can combine', () => {
    expect(add(['sb-berg'], 'sb-wasser')).toEqual(['sb-berg', 'sb-wasser'])
  })
  it('an already contradictory input keeps the last listed tag', () => {
    expect(tagsOf(withActivityTags(c0, 'a1', ['ebb-a', 'ebb-b']))).toEqual(['ebb-b'])
  })
  it('switching to kein-sb removes the SB approval', () => {
    const c = withActivityTags(c0, 'a1', ['sb-berg'])
    const next = withActivityTags({ ...c, sbApprovals: { a1: { kind: 'experte', approvedOn: '2031-05-01' } } }, 'a1', ['sb-berg', 'kein-sb'])
    expect(next.sbApprovals.a1).toBeUndefined()
  })
})
