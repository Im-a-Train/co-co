/** Feedback ordering (Feedback-Kultur order: kudos -> must -> suggestion -> question). */
import type { FeedbackItem, FeedbackKind } from '../types'

export const KIND_ORDER: readonly FeedbackKind[] = ['kudos', 'must', 'suggestion', 'question'] as const

/** Stable sort by KIND_ORDER, camp scope before activity scope, then createdAt. */
export function orderItems(items: FeedbackItem[]): FeedbackItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const k = KIND_ORDER.indexOf(a.item.kind) - KIND_ORDER.indexOf(b.item.kind)
      if (k !== 0) return k
      const s = (a.item.scope === 'camp' ? 0 : 1) - (b.item.scope === 'camp' ? 0 : 1)
      if (s !== 0) return s
      if (a.item.createdAt !== b.item.createdAt) return a.item.createdAt < b.item.createdAt ? -1 : 1
      return a.index - b.index
    })
    .map((x) => x.item)
}
