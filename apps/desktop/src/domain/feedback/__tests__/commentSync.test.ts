import { describe, expect, it } from 'vitest'
import { newReplies, ownCommentIris, syncFeedbackWithComments, syncItem } from '../commentSync'
import type { CommentFact, FeedbackItem } from '../../types'

const COACH = '/api/users/coach'
const NOW = '2026-08-01T10:00:00+00:00'
const ACT = '/api/activities/a1'

function item(p: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: 'f1',
    campIri: '/api/camps/c1',
    scope: 'activity',
    kind: 'suggestion',
    text: 'x',
    status: 'posted',
    activityIri: ACT,
    postedCommentIri: '/api/comments/own1',
    createdAt: NOW,
    updatedAt: NOW,
    ...p,
  }
}
function comment(p: Partial<CommentFact> & { iri: string }): CommentFact {
  return {
    activityIri: ACT,
    parentIri: null,
    textHtml: '<p>text</p>',
    authorIri: '/api/camp_collaborations/other',
    authorDisplayName: 'Anna',
    createTime: '2026-07-30T10:00:00+00:00',
    resolvedAt: null,
    ...p,
  }
}
const own1 = comment({ iri: '/api/comments/own1', authorIri: COACH, authorDisplayName: 'Coach' })

describe('ownCommentIris', () => {
  it('prefers postedCommentIris, falls back to postedCommentIri', () => {
    expect(ownCommentIris(item({ postedCommentIris: ['/a', '/b'] }))).toEqual(['/a', '/b'])
    expect(ownCommentIris(item())).toEqual(['/api/comments/own1'])
    expect(ownCommentIris(item({ postedCommentIri: undefined }))).toEqual([])
  })
})

describe('syncItem', () => {
  it('returns non-posted items and items without own IRIs unchanged', () => {
    const draft = item({ status: 'draft' })
    expect(syncItem(draft, [own1], COACH, NOW)).toBe(draft)
    const none = item({ postedCommentIri: undefined })
    expect(syncItem(none, [own1], COACH, NOW)).toBe(none)
  })

  it('collects direct replies with plain text', () => {
    const reply = comment({ iri: '/api/comments/r1', parentIri: own1.iri, textHtml: '<p>Danke <b>dir</b><br>ok</p>', createTime: '2026-07-31T10:00:00+00:00' })
    const out = syncItem(item(), [own1, reply], COACH, NOW)
    expect(out.commentSync?.replies).toHaveLength(1)
    expect(out.commentSync?.replies[0]).toMatchObject({ iri: reply.iri, inferred: false, authorDisplayName: 'Anna' })
    expect(out.commentSync?.replies[0].text).toContain('Danke dir')
    expect(out.commentSync?.replies[0].text).not.toContain('<')
    expect(out.commentSync?.missing).toBe(false)
    expect(out.commentSync?.resolvedAt).toBeNull()
  })

  it('infers a later comment by someone else on the same activity', () => {
    const later = comment({ iri: '/api/comments/l1', createTime: '2026-08-01T00:00:00+00:00' })
    const out = syncItem(item(), [own1, later], COACH, NOW)
    expect(out.commentSync?.replies).toMatchObject([{ iri: later.iri, inferred: true }])
  })

  it("does not infer earlier comments, other activities, or the coach's own later comment", () => {
    const earlier = comment({ iri: '/api/comments/e1', createTime: '2026-07-29T00:00:00+00:00' })
    const other = comment({ iri: '/api/comments/o1', activityIri: '/api/activities/zz', createTime: '2026-08-01T00:00:00+00:00' })
    const ownLater = comment({ iri: '/api/comments/ol', authorIri: COACH, createTime: '2026-08-01T00:00:00+00:00' })
    const out = syncItem(item(), [own1, earlier, other, ownLater], COACH, NOW)
    expect(out.commentSync?.replies).toEqual([])
  })

  it('does not treat another own part as a reply (multi-part posts)', () => {
    const part2 = comment({ iri: '/api/comments/own2', authorIri: '/api/camp_collaborations/me', createTime: '2026-07-30T10:00:01+00:00' })
    const reply = comment({ iri: '/api/comments/r2', parentIri: '/api/comments/own2', createTime: '2026-07-31T00:00:00+00:00' })
    const it = item({ postedCommentIris: [own1.iri, part2.iri] })
    const out = syncItem(it, [own1, part2, reply], COACH, NOW)
    expect(out.commentSync?.replies.map((r) => r.iri)).toEqual([reply.iri])
  })

  it('uses the latest resolvedAt among own parts', () => {
    const p1 = { ...own1, resolvedAt: '2026-08-02T00:00:00+00:00' }
    const p2 = comment({ iri: '/api/comments/own2', authorIri: COACH, resolvedAt: '2026-08-03T00:00:00+00:00' })
    const out = syncItem(item({ postedCommentIris: [own1.iri, p2.iri] }), [p1, p2], COACH, NOW)
    expect(out.commentSync?.resolvedAt).toBe('2026-08-03T00:00:00+00:00')
  })

  it('flags missing when no own IRI exists, only if comments were loaded', () => {
    const out = syncItem(item(), [], COACH, NOW)
    expect(out.commentSync?.missing).toBe(true)
    const skipped = syncItem(item(), [], COACH, NOW, false)
    expect(skipped.commentSync?.missing).toBe(false)
  })

  it('keeps existing sync state when comments were not loaded', () => {
    const synced = syncItem(item(), [own1, comment({ iri: '/api/comments/l1', createTime: '2026-08-01T00:00:00+00:00' })], COACH, NOW)
    expect(syncItem(synced, [], COACH, '2026-09-01T00:00:00+00:00', false)).toBe(synced)
  })

  it('is not missing when only one of several parts exists', () => {
    const out = syncItem(item({ postedCommentIris: [own1.iri, '/api/comments/gone'] }), [own1], COACH, NOW)
    expect(out.commentSync?.missing).toBe(false)
  })

  it('returns the same object when nothing changed and preserves seenReplyIris', () => {
    const reply = comment({ iri: '/api/comments/r1', parentIri: own1.iri })
    const first = syncItem(item(), [own1, reply], COACH, NOW)
    const seen = { ...first, commentSync: { ...first.commentSync!, seenReplyIris: [reply.iri] } }
    const again = syncItem(seen, [own1, reply], COACH, '2026-09-01T00:00:00+00:00')
    expect(again).toBe(seen)
    const newer = comment({ iri: '/api/comments/r2', parentIri: own1.iri, createTime: '2026-08-05T00:00:00+00:00' })
    const changed = syncItem(seen, [own1, reply, newer], COACH, '2026-09-01T00:00:00+00:00')
    expect(changed).not.toBe(seen)
    expect(changed.commentSync?.seenReplyIris).toEqual([reply.iri])
    expect(newReplies(changed.commentSync).map((r) => r.iri)).toEqual([newer.iri])
  })

  it('sorts replies by createTime', () => {
    const a = comment({ iri: '/r/a', parentIri: own1.iri, createTime: '2026-08-02T00:00:00+00:00' })
    const b = comment({ iri: '/r/b', parentIri: own1.iri, createTime: '2026-08-01T00:00:00+00:00' })
    const out = syncItem(item(), [own1, a, b], COACH, NOW)
    expect(out.commentSync?.replies.map((r) => r.iri)).toEqual(['/r/b', '/r/a'])
  })
})

describe('syncFeedbackWithComments', () => {
  it('summarises and lists only changed items', () => {
    const reply = comment({ iri: '/api/comments/r1', parentIri: own1.iri })
    const resolvedOwn = comment({ iri: '/api/comments/own9', authorIri: COACH, activityIri: '/api/activities/a9', resolvedAt: '2026-08-02T00:00:00+00:00' })
    const a = item({ id: 'a' })
    const b = item({ id: 'b', activityIri: '/api/activities/a9', postedCommentIri: resolvedOwn.iri })
    const c = item({ id: 'c', postedCommentIri: '/api/comments/gone' })
    const d = item({ id: 'd', status: 'draft' })
    const first = syncFeedbackWithComments([a, b, c, d], [own1, reply, resolvedOwn], COACH, NOW)
    expect(first.changed.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(first).toMatchObject({ resolved: 1, withNewReplies: 1, missing: 1 })

    const synced = first.changed.concat(d)
    const second = syncFeedbackWithComments(synced, [own1, reply, resolvedOwn], COACH, '2026-09-01T00:00:00+00:00')
    expect(second.changed).toEqual([])
    expect(second).toMatchObject({ resolved: 1, withNewReplies: 1, missing: 1 })
  })
})
