/**
 * Feedback items of one camp (Dexie CRUD, post as eCamp comment, mark sent).
 */
import { computed, ref, toValue, watch, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'
import { commands } from '@/lib/tauri'
import { toCommentHtmlParts, orderItems, lintItems, type FeedbackLint } from '@/domain/feedback'
import { deleteFeedback, listFeedback, saveFeedback } from '@/domain/feedback/store'
import { newId, nowIso } from '@/domain/storage/db'
import type { FeedbackItem, FeedbackKind, FeedbackScope, Iri } from '@/domain/types'

export interface NewFeedback {
  scope: FeedbackScope
  kind: FeedbackKind
  text: string
  activityIri?: Iri
  ruleId?: string
  findingId?: string
  roundId?: string
}

export interface FeedbackHandle {
  items: Ref<FeedbackItem[]>
  ordered: ComputedRef<FeedbackItem[]>
  lint: ComputedRef<FeedbackLint[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  reload(): Promise<void>
  add(input: NewFeedback): Promise<FeedbackItem>
  update(id: string, patch: Partial<Pick<FeedbackItem, 'text' | 'kind' | 'scope' | 'activityIri' | 'status' | 'roundId'>>): Promise<void>
  remove(id: string): Promise<void>
  /** Posts an activity item as eCamp comment(s). Rejects with a readable message on failure. */
  postAsComment(id: string): Promise<void>
  markSent(id: string, sent: boolean): Promise<void>
}

function commentIri(res: unknown): string | undefined {
  const self = (res as { _links?: { self?: { href?: unknown } } } | null)?._links?.self?.href
  return typeof self === 'string' ? self : undefined
}

export function useFeedback(campIri: MaybeRefOrGetter<Iri>): FeedbackHandle {
  const items = ref<FeedbackItem[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function reload(): Promise<void> {
    loading.value = true
    try {
      items.value = await listFeedback(toValue(campIri))
      error.value = null
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  watch(() => toValue(campIri), () => void reload(), { immediate: true })

  function find(id: string): FeedbackItem {
    const item = items.value.find((i) => i.id === id)
    if (!item) throw new Error('Feedback-Punkt nicht gefunden')
    return item
  }

  async function persist(item: FeedbackItem): Promise<void> {
    await saveFeedback(item)
    const idx = items.value.findIndex((i) => i.id === item.id)
    if (idx >= 0) items.value.splice(idx, 1, item)
    else items.value.push(item)
  }

  async function add(input: NewFeedback): Promise<FeedbackItem> {
    const now = nowIso()
    const item: FeedbackItem = {
      id: newId(),
      campIri: toValue(campIri),
      scope: input.scope,
      kind: input.kind,
      text: input.text,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }
    if (input.scope === 'activity' && input.activityIri) item.activityIri = input.activityIri
    if (input.ruleId) item.ruleId = input.ruleId
    if (input.findingId) item.findingId = input.findingId
    if (input.roundId) item.roundId = input.roundId
    await persist(item)
    return item
  }

  async function update(id: string, patch: Parameters<FeedbackHandle['update']>[1]): Promise<void> {
    const next: FeedbackItem = { ...find(id), ...patch, updatedAt: nowIso() }
    if (next.scope === 'camp') delete next.activityIri
    await persist(next)
  }

  async function remove(id: string): Promise<void> {
    await deleteFeedback(id)
    items.value = items.value.filter((i) => i.id !== id)
  }

  const posting = new Set<string>()

  async function postAsComment(id: string): Promise<void> {
    const item = find(id)
    if (item.scope !== 'activity' || !item.activityIri) throw new Error('Nur Aktivitäts-Punkte können gepostet werden')
    const parts = toCommentHtmlParts(item.text)
    if (parts.length === 0) throw new Error('Der Text ist leer')
    if (item.status === 'posted') throw new Error('Dieser Punkt wurde bereits gepostet')
    if (posting.has(id)) return
    posting.add(id)
    try {
      let current: FeedbackItem = item
      for (let i = item.postedParts ?? 0; i < parts.length; i++) {
        const res = await commands.apiPostComment(item.campIri, item.activityIri, parts[i])
        current = { ...current, postedParts: i + 1, updatedAt: nowIso() }
        const iri = commentIri(res)
        if (iri && !current.postedCommentIri) current.postedCommentIri = iri
        if (i + 1 === parts.length) current.status = 'posted'
        await persist(current)
      }
    } finally {
      posting.delete(id)
    }
  }

  async function markSent(id: string, sent: boolean): Promise<void> {
    await update(id, { status: sent ? 'sent' : 'draft' })
  }

  return {
    items,
    ordered: computed(() => orderItems(items.value)),
    lint: computed(() => lintItems(items.value)),
    loading,
    error,
    reload,
    add,
    update,
    remove,
    postAsComment,
    markSent,
  }
}
