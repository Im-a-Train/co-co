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
import type { CommentFact, CommentSyncState, FeedbackItem, Iri, IsoDateTime } from '../types'

export interface CommentSyncSummary {
  /** Items whose commentSync changed compared to the input (to persist). */
  changed: FeedbackItem[]
  resolved: number
  /** Items with at least one reply not in seenReplyIris. */
  withNewReplies: number
  missing: number
}

export function ownCommentIris(item: FeedbackItem): Iri[] {
  void item
  throw new Error('not implemented')
}

export function syncItem(
  item: FeedbackItem,
  comments: CommentFact[],
  coachUserIri: Iri | null,
  now: IsoDateTime,
  commentsLoaded = true,
): FeedbackItem {
  void [item, comments, coachUserIri, now, commentsLoaded]
  throw new Error('not implemented')
}

export function syncFeedbackWithComments(
  items: FeedbackItem[],
  comments: CommentFact[],
  coachUserIri: Iri | null,
  now: IsoDateTime,
  commentsLoaded = true,
): CommentSyncSummary {
  void [items, comments, coachUserIri, now, commentsLoaded]
  throw new Error('not implemented')
}

/** Replies not yet seen by the coach. */
export function newReplies(state: CommentSyncState | undefined): CommentSyncState['replies'] {
  void state
  throw new Error('not implemented')
}
