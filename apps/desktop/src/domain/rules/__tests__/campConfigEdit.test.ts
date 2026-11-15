import { describe, expect, it } from 'vitest'
import { defaultCampRuleConfig } from '../lib/campRuleConfig'
import {
  groupOfTag,
  isGroupVisible,
  TAG_GROUPS,
  tagsInGroup,
  withActivityTags,
  withGroupChoice,
  withTagToggled,
} from '../lib/campConfigEdit'
import { ACTIVITY_TAGS, type ActivityTag } from '@/domain/types'

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

describe('TAG_GROUPS (shared by the editor and the resolver)', () => {
  it('every activity tag belongs to exactly one group', () => {
    for (const tag of ACTIVITY_TAGS) {
      expect(TAG_GROUPS.filter((g) => g.tags.includes(tag) || g.none === tag).length, tag).toBe(1)
      expect(groupOfTag(tag), tag).toBeDefined()
    }
  })
  const g = (id: string) => TAG_GROUPS.find((x) => x.id === id)!
  it('withGroupChoice replaces the exclusive choice; null means Automatisch', () => {
    expect(withGroupChoice(['unternehmung', 'ef1'], g('unternehmung'), 'keine-unternehmung')).toEqual(['ef1', 'keine-unternehmung'])
    expect(withGroupChoice(['ebb-a', 'ef1'], g('ebb'), null)).toEqual(['ef1'])
    expect(withGroupChoice([], g('ebb'), 'kein-ebb')).toEqual(['kein-ebb'])
  })
  it('withTagToggled adds and removes; the resolver drops kein-sb when an area is added', () => {
    expect(withTagToggled(['sb-berg'], 'sb-berg')).toEqual([])
    expect(tagsOf(withActivityTags(c0, 'a1', withTagToggled(['kein-sb'], 'sb-winter')))).toEqual(['sb-winter'])
    expect(tagsOf(withActivityTags(c0, 'a1', withTagToggled(['sb-berg', 'ef2'], 'kein-sb')))).toEqual(['ef2', 'kein-sb'])
  })
  it('tagsInGroup includes the none tag', () => {
    expect(tagsInGroup(g('sb'), ['kein-sb', 'ef1'])).toEqual(['kein-sb'])
  })
  it('the Gewässer row shows only with the Wasser area or an existing water tag', () => {
    expect(isGroupVisible(g('wasser'), [])).toBe(false)
    expect(isGroupVisible(g('wasser'), ['sb-wasser'])).toBe(true)
    expect(isGroupVisible(g('wasser'), ['wasser-see'])).toBe(true)
    expect(isGroupVisible(g('ebb'), [])).toBe(true)
  })
})
