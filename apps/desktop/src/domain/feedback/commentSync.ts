/**
 * Comment sync: reads resolved / answered eCamp comments back into posted feedback items. Pure.
 *
 * Input is `CampFacts.comments` (already loaded with every camp load) — no extra API calls.
 * Matching: an item's own comments are `postedCommentIris ?? [postedCommentIri]`.
 * - resolvedAt: latest `resolvedAt` among own comments (null when none resolved).
 * - missing: the item has own IRIs but none of them is present in `comments` (deleted in eCamp).
 *   Comments are fetched best-effort, so pass `commentsLoaded=false` to skip missing detection.
 * - replies: comments whose `parentIri` is one of the own IRIs (inferred=false), plus — for activity
 *   items — later comments on the same activity by another author (authorIri !== coach userIri),
 *   created after the first own comment and not themselves own comments (inferred=true).
 *   Text is plain text via campFacts `htmlToText`. Sorted by createTime.
 * - Items that are not `status === 'posted'` or have no own IRIs are returned unchanged.
 * - `seenReplyIris` from the previous state is kept.
 */
import { htmlToText } from '../campFacts'
import type { CommentFact, CommentReply, CommentSyncState, FeedbackItem, Iri, IsoDateTime } from '../types'

export interface CommentSyncSummary {
  /** Items whose commentSync changed compared to the input (to persist). */
  changed: FeedbackItem[]
  resolved: number
  /** Items with at least one reply not in seenReplyIris. */
  withNewReplies: number
  missing: number
}

export function ownCommentIris(item: FeedbackItem): Iri[] {
  if (item.postedCommentIris && item.postedCommentIris.length > 0) return item.postedCommentIris
  return item.postedCommentIri ? [item.postedCommentIri] : []
}

function stateKey(state: CommentSyncState): string {
  const { syncedAt, ...rest } = state
  void syncedAt
  return JSON.stringify(rest)
}

export function syncItem(
  item: FeedbackItem,
  comments: CommentFact[],
  coachUserIri: Iri | null,
  now: IsoDateTime,
  commentsLoaded = true,
): FeedbackItem {
  const own = ownCommentIris(item)
  if (item.status !== 'posted' || own.length === 0) return item
  const ownSet = new Set(own)
  const ownFound = comments.filter((c) => ownSet.has(c.iri))

  // Comments could not be fetched: do not wipe what we already know.
  if (!commentsLoaded && ownFound.length === 0 && item.commentSync) return item

  let resolvedAt: IsoDateTime | null = null
  for (const c of ownFound) if (c.resolvedAt && (!resolvedAt || c.resolvedAt > resolvedAt)) resolvedAt = c.resolvedAt
  const missing = commentsLoaded && ownFound.length === 0

  const replies: CommentReply[] = []
  const seen = new Set<Iri>()
  const add = (c: CommentFact, inferred: boolean) => {
    if (seen.has(c.iri)) return
    seen.add(c.iri)
    replies.push({
      iri: c.iri,
      authorDisplayName: c.authorDisplayName,
      text: htmlToText(c.textHtml),
      createTime: c.createTime,
      inferred,
    })
  }
  for (const c of comments) if (c.parentIri && ownSet.has(c.parentIri) && !ownSet.has(c.iri)) add(c, false)
  if (item.activityIri && ownFound.length > 0) {
    const firstOwn = ownFound.map((c) => c.createTime ?? '').sort()[0] ?? ''
    for (const c of comments) {
      if (ownSet.has(c.iri) || c.parentIri || c.activityIri !== item.activityIri) continue
      if (coachUserIri && c.authorIri === coachUserIri) continue
      if (!c.createTime || c.createTime <= firstOwn) continue
      add(c, true)
    }
  }
  replies.sort((a, b) => (a.createTime ?? '').localeCompare(b.createTime ?? ''))

  const next: CommentSyncState = { syncedAt: now, resolvedAt, missing, replies }
  if (item.commentSync?.seenReplyIris) next.seenReplyIris = item.commentSync.seenReplyIris
  if (item.commentSync && stateKey(item.commentSync) === stateKey(next)) return item
  return { ...item, commentSync: next }
}

export function syncFeedbackWithComments(
  items: FeedbackItem[],
  comments: CommentFact[],
  coachUserIri: Iri | null,
  now: IsoDateTime,
  commentsLoaded = true,
): CommentSyncSummary {
  const summary: CommentSyncSummary = { changed: [], resolved: 0, withNewReplies: 0, missing: 0 }
  for (const item of items) {
    const next = syncItem(item, comments, coachUserIri, now, commentsLoaded)
    if (next !== item) summary.changed.push(next)
    const st = next.commentSync
    if (!st) continue
    if (st.resolvedAt) summary.resolved++
    if (st.missing) summary.missing++
    if (newReplies(st).length > 0) summary.withNewReplies++
  }
  return summary
}

/** Replies not yet seen by the coach. */
export function newReplies(state: CommentSyncState | undefined): CommentSyncState['replies'] {
  if (!state) return []
  const seen = new Set(state.seenReplyIris ?? [])
  return state.replies.filter((r) => !seen.has(r.iri))
}
