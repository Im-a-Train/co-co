import { describe, expect, it } from 'vitest'
import {
  feedbackForFinding,
  findingStatus,
  nextOpenIndex,
  progressOf,
  recallPosition,
  rememberPosition,
  resolveIndex,
  statusesOf,
  stepIndex,
  triageLocation,
  type FindingStatus,
} from '../index'
import type { FeedbackItem, Finding } from '@/domain/types'

const finding = (id: string, over: Partial<Finding> = {}): Finding =>
  ({
    id,
    ruleId: id.split(':')[0]!,
    scope: 'activity',
    targets: [`/api/activities/${id.split(':')[1] ?? 'a'}`],
    evidence: [],
    override: null,
    ...over,
  }) as unknown as Finding

const item = (over: Partial<FeedbackItem>): FeedbackItem =>
  ({ id: 'i1', campIri: '/api/camps/c', scope: 'activity', kind: 'suggestion', text: 'x', status: 'draft', createdAt: '', updatedAt: '', ...over }) as FeedbackItem

describe('status derivation', () => {
  const f = finding('R-1:a1')
  it('open without feedback or override', () => expect(findingStatus(f, [])).toBe('open'))
  it('feedback via findingId', () => expect(findingStatus(f, [item({ findingId: 'R-1:a1' })])).toBe('feedback'))
  it('feedback via ruleId + target when no findingId', () => {
    expect(findingStatus(f, [item({ ruleId: 'R-1', activityIri: '/api/activities/a1' })])).toBe('feedback')
    expect(findingStatus(f, [item({ ruleId: 'R-1', activityIri: '/api/activities/zzz' })])).toBe('open')
    expect(findingStatus(f, [item({ ruleId: 'R-2', activityIri: '/api/activities/a1' })])).toBe('open')
  })
  it('a different findingId does not match even if rule + target do', () => {
    expect(findingStatus(f, [item({ findingId: 'R-1:other', ruleId: 'R-1', activityIri: '/api/activities/a1' })])).toBe('open')
  })
  it('camp-scoped feedback matches non-activity findings of the rule', () => {
    const day = finding('R-9:d1', { scope: 'day', targets: ['/api/days/d1'] })
    expect(feedbackForFinding(day, [item({ scope: 'camp', ruleId: 'R-9' })])).not.toBeNull()
  })
  it('ignored wins', () => {
    const ign = finding('R-1:a1', { override: { id: 'o' } as never })
    expect(findingStatus(ign, [item({ findingId: 'R-1:a1' })])).toBe('ignored')
  })
  it('statusesOf maps the list', () => {
    expect(statusesOf([f, finding('R-2:a2')], [item({ findingId: 'R-1:a1' })])).toEqual(['feedback', 'open'])
  })
})

describe('navigation', () => {
  const s = (...v: FindingStatus[]) => v
  it('next open skips done ones', () => {
    expect(nextOpenIndex(s('open', 'feedback', 'ignored', 'open'), 0)).toBe(3)
  })
  it('wraps around', () => {
    expect(nextOpenIndex(s('open', 'feedback', 'open'), 2)).toBe(0)
  })
  it('skip keeps the current one open and moves on', () => {
    expect(nextOpenIndex(s('open', 'open', 'open'), 1)).toBe(2)
  })
  it('returns -1 when nothing else is open', () => {
    expect(nextOpenIndex(s('feedback', 'feedback'), 0)).toBe(-1)
    expect(nextOpenIndex(s('open'), 0)).toBe(-1)
    expect(nextOpenIndex([], 0)).toBe(-1)
  })
  it('stepIndex wraps both ways', () => {
    expect(stepIndex(3, 2, 1)).toBe(0)
    expect(stepIndex(3, 0, -1)).toBe(2)
    expect(stepIndex(0, 0, 1)).toBe(-1)
  })
  it('progress', () => {
    expect(progressOf(s('open', 'feedback', 'ignored'))).toEqual({ done: 2, total: 3, open: 1 })
  })
  it('resolveIndex finds the key or clamps', () => {
    const list = [finding('A-1:a'), finding('B-1:b')]
    expect(resolveIndex(list, 'B-1:b')).toBe(1)
    expect(resolveIndex(list, 'gone', 5)).toBe(1)
    expect(resolveIndex(list, null)).toBe(0)
    expect(resolveIndex([], 'x')).toBe(-1)
  })
})

describe('position + routing', () => {
  it('remembers the position per camp', () => {
    rememberPosition('/api/camps/c1', 'R-1:a')
    expect(recallPosition('/api/camps/c1')).toBe('R-1:a')
    expect(recallPosition('/api/camps/c2')).toBeNull()
  })
  it('triageLocation points to the findings tab with befund (+ editor) in the query', () => {
    const loc = triageLocation('/api/camps/70ca971c992f', 'R-1:a', { editor: true })
    expect(loc.name).toBe('camp-findings')
    expect(loc.params.campId).toBe('70ca971c992f')
    expect(loc.query).toEqual({ befund: 'R-1:a', editor: '1' })
    expect(triageLocation('/api/camps/x', 'R-1:a').query).toEqual({ befund: 'R-1:a' })
  })
})
