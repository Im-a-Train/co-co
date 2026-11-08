/**
 * Feedback domain. Pure (store in ./store.ts).
 * Feedback-Kultur order: kudos -> must -> suggestion -> question.
 */
import { feedbackTemplates, messages, type MessageTree } from '../../locales/messages'
import type { FeedbackChannel, FeedbackItem, FeedbackKind, FeedbackTemplateId, Finding, Iri } from '../types'

export const KIND_ORDER: readonly FeedbackKind[] = ['kudos', 'must', 'suggestion', 'question'] as const
/** eCamp Comment.textHtml max length. */
export const COMMENT_MAX_LENGTH = 1024

export interface RenderContext {
  campTitle: string
  /** activityIri -> display title (e.g. "1.2 Postenlauf") */
  activityTitles: Record<Iri, string>
  /** activityIri -> eCamp web URL (see domain/ecampLinks). Missing entries render without link. */
  activityUrls?: Record<Iri, string>
  /** activityIri -> short eCamp URL (ids only); only used in the plain-text fallback of email/plain. */
  activityShortUrls?: Record<Iri, string>
  /** activityIri -> block number(s), e.g. "1.2/3.4" (see domain/ecampLinks activityBlockNumbers). */
  activityNumbers?: Record<Iri, string>
  /** Append the eCamp link to activity items (default true when activityUrls is given). */
  includeLinks?: boolean
  templateId?: FeedbackTemplateId
  coachName?: string | null
  /** Overrides the bundled template (mainly for tests). */
  template?: string
}

export interface RenderedFeedback {
  channel: FeedbackChannel
  /** Only for 'email'. */
  subject: string | null
  body: string
  /** HTML body with linked activity titles (email/plain only); null when the plain body suffices. */
  html: string | null
}

export interface FeedbackLint {
  itemId: string
  code: 'must-without-next-step' | 'empty-text' | 'too-long-for-comment'
}

// --- i18n helper (domain stays free of Vue; reads the merged German tree) -------------------------

function tr(key: string, params: Record<string, string | number> = {}): string {
  let node: string | MessageTree | undefined = messages.de as MessageTree
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return key
    node = node[part]
  }
  if (typeof node !== 'string') return key
  return node.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}

// --- ordering -------------------------------------------------------------------------------------

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

// --- rendering ------------------------------------------------------------------------------------

const WHATSAPP_EMOJI: Record<FeedbackKind, string> = {
  kudos: '🌟',
  must: '⚠️',
  suggestion: '💡',
  question: '❓',
}

function itemLine(item: FeedbackItem, channel: FeedbackChannel, ctx: RenderContext): string {
  const text = item.text.trim().replace(/\n+/g, ' ')
  const title = itemTitle(item, ctx)
  const label = title ? (channel === 'whatsapp' ? `*${title}*: ` : `${title}: `) : ''
  if (channel === 'whatsapp') {
    // No link: WhatsApp cannot hide URLs; the block number identifies the activity.
    return `${WHATSAPP_EMOJI[item.kind]} ${label}${text}`
  }
  const urls = itemUrls(item, ctx)
  const url = urls.short ?? urls.long
  return `- ${label}${text}` + (url ? ` (${tr('feedback.linkLabel')}: ${url})` : '')
}

/** "{block numbers} {title}" of an activity item (numbers optional), or undefined. */
function itemTitle(item: FeedbackItem, ctx: RenderContext): string | undefined {
  if (item.scope !== 'activity' || !item.activityIri) return undefined
  const title = ctx.activityTitles[item.activityIri]
  if (!title) return undefined
  const nr = ctx.activityNumbers?.[item.activityIri]
  return nr ? `${nr} ${title}` : title
}

function itemUrls(item: FeedbackItem, ctx: RenderContext): { long?: string; short?: string } {
  if (ctx.includeLinks === false || item.scope !== 'activity' || !item.activityIri) return {}
  return { long: ctx.activityUrls?.[item.activityIri], short: ctx.activityShortUrls?.[item.activityIri] }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function htmlText(s: string): string {
  return escapeHtml(s).replace(/\r?\n/g, '<br>')
}

function itemHtml(item: FeedbackItem, ctx: RenderContext): { html: string; linked: boolean } {
  const text = htmlText(item.text.trim().replace(/\n+/g, ' '))
  const title = itemTitle(item, ctx)
  const url = itemUrls(item, ctx).long
  if (url) {
    const href = escapeHtml(url)
    if (title) return { html: `- <a href="${href}">${escapeHtml(title)}</a>: ${text}`, linked: true }
    return { html: `- ${text} <a href="${href}">${escapeHtml(tr('feedback.openInEcamp'))}</a>`, linked: true }
  }
  return { html: `- ${title ? `${escapeHtml(title)}: ` : ''}${text}`, linked: false }
}

/** HTML items block (sections in Feedback-Kultur order, bold headings); `linked` = any item has a link. */
function renderItemsHtml(items: FeedbackItem[], ctx: RenderContext): { html: string; linked: boolean } {
  const ordered = orderItems(items.filter((i) => i.text.trim() !== ''))
  const blocks: string[] = []
  let linked = false
  for (const kind of KIND_ORDER) {
    const group = ordered.filter((i) => i.kind === kind)
    if (group.length === 0) continue
    const lines = group.map((i) => {
      const r = itemHtml(i, ctx)
      linked ||= r.linked
      return r.html
    })
    blocks.push([`<b>${escapeHtml(`${tr(`feedback.section.${kind}`)}:`)}</b>`, ...lines].join('<br>'))
  }
  return { html: blocks.join('<br><br>'), linked }
}

/** Renders grouped items (sections in Feedback-Kultur order) without template. */
export function renderItemsBlock(items: FeedbackItem[], channel: FeedbackChannel, ctx: RenderContext): string {
  const ordered = orderItems(items.filter((i) => i.text.trim() !== ''))
  const blocks: string[] = []
  for (const kind of KIND_ORDER) {
    const group = ordered.filter((i) => i.kind === kind)
    if (group.length === 0) continue
    const heading = tr(`feedback.section.${kind}`)
    const head = channel === 'whatsapp' ? `*${heading}*` : `${heading}:`
    blocks.push([head, ...group.map((i) => itemLine(i, channel, ctx))].join('\n'))
  }
  return blocks.join('\n\n')
}

/** Replaces {{key}} placeholders; unknown keys become empty. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => vars[k] ?? '')
}

/** Splits a leading "Betreff: ..." line from the template body. */
export function splitTemplate(template: string): { subject: string | null; body: string } {
  const m = /^Betreff:[ \t]*(.*)\r?\n(?:\r?\n)?/.exec(template)
  if (!m) return { subject: null, body: template }
  return { subject: m[1]!.trim(), body: template.slice(m[0].length) }
}

function collapseBlankLines(s: string): string {
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const ITEMS_TOKEN = '\u0000ITEMS\u0000'

export function renderFeedback(items: FeedbackItem[], channel: FeedbackChannel, ctx: RenderContext): RenderedFeedback {
  const itemsBlock = renderItemsBlock(items, channel, ctx)
  const tpl = ctx.template ?? (ctx.templateId ? safeTemplate(ctx.templateId) : null)
  const campName = ctx.campTitle || tr('feedback.campFallback')
  const vars = { camp: campName, coach: ctx.coachName ?? '', items: itemsBlock }
  let subject: string | null = null
  let body: string
  let htmlBody: string | null = null
  const itemsHtml = channel !== 'whatsapp' && ctx.includeLinks !== false ? renderItemsHtml(items, ctx) : null
  if (tpl) {
    const parts = splitTemplate(tpl)
    subject = parts.subject !== null ? fillTemplate(parts.subject, vars).trim() : null
    body = collapseBlankLines(fillTemplate(parts.body, vars))
    if (itemsHtml?.linked) {
      // Fill with a placeholder token, escape the rest, then swap in the (already escaped) items HTML.
      const filled = collapseBlankLines(fillTemplate(parts.body, { ...vars, items: ITEMS_TOKEN }))
      htmlBody = htmlText(filled).replace(ITEMS_TOKEN, () => itemsHtml.html)
    }
  } else {
    body = itemsBlock
    if (itemsHtml?.linked) htmlBody = itemsHtml.html
  }
  if (channel === 'whatsapp') {
    // WhatsApp: the subject becomes a bold first line.
    if (subject) body = `*${subject}*\n\n${body}`
    return { channel, subject: null, body, html: null }
  }
  if (channel === 'email') return { channel, subject: subject ?? campName, body, html: htmlBody }
  if (subject) {
    body = `${subject}\n\n${body}`
    if (htmlBody !== null) htmlBody = `${htmlText(subject)}<br><br>${htmlBody}`
  }
  return { channel, subject: null, body, html: htmlBody }
}

function safeTemplate(id: FeedbackTemplateId): string | null {
  const t = feedbackTemplates[`de/${id}`]
  return t === undefined ? null : t
}

// --- lint -----------------------------------------------------------------------------------------

let nextStepRe: RegExp | null = null
function nextStep(): RegExp {
  nextStepRe ??= new RegExp(tr('feedback.nextStepWords'), 'i')
  return nextStepRe
}

export function hasNextStep(text: string): boolean {
  return text.includes('?') || nextStep().test(text)
}

export function lintItems(items: FeedbackItem[]): FeedbackLint[] {
  const out: FeedbackLint[] = []
  for (const item of items) {
    if (item.text.trim() === '') {
      out.push({ itemId: item.id, code: 'empty-text' })
      continue
    }
    if (item.kind === 'must' && !hasNextStep(item.text)) out.push({ itemId: item.id, code: 'must-without-next-step' })
    if (item.scope === 'activity' && escapeCommentText(item.text.trim()).length > COMMENT_MAX_LENGTH) {
      out.push({ itemId: item.id, code: 'too-long-for-comment' })
    }
  }
  return out
}

// --- eCamp comments -------------------------------------------------------------------------------

export function escapeCommentText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>')
}

/**
 * Converts item text to comment HTML (escaped, line breaks as <br>); splits into parts of
 * <= maxLength chars. Multi-part comments get a "(n/total) " prefix. Splits at whitespace when possible.
 */
export function toCommentHtmlParts(text: string, maxLength: number = COMMENT_MAX_LENGTH): string[] {
  const raw = text.trim()
  if (raw === '') return []
  if (escapeCommentText(raw).length <= maxLength) return [escapeCommentText(raw)]
  const reserve = tr('feedback.partPrefix', { n: 99, total: 99 }).length
  const budget = Math.max(1, maxLength - reserve)
  const chunks: string[] = []
  let rest = raw
  while (rest.length > 0) {
    if (escapeCommentText(rest).length <= budget) {
      chunks.push(rest)
      break
    }
    // Largest prefix whose escaped length fits.
    let lo = 1
    let hi = rest.length
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (escapeCommentText(rest.slice(0, mid)).length <= budget) lo = mid
      else hi = mid - 1
    }
    let cut = lo
    const ws = Math.max(rest.lastIndexOf(' ', cut), rest.lastIndexOf('\n', cut))
    if (ws > cut * 0.5 && cut < rest.length) cut = ws
    chunks.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  const total = chunks.length
  return chunks.map((c, i) => tr('feedback.partPrefix', { n: i + 1, total }) + escapeCommentText(c))
}

// --- findings -> drafts ---------------------------------------------------------------------------

function uuid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** New draft item prefilled from a finding (kind 'must' for must findings, else 'suggestion'). */
export function itemFromFinding(finding: Finding, campIri: Iri, now: Date = new Date()): FeedbackItem {
  const isMust = finding.severity === 'must'
  // Rule messages often lack final punctuation; the template appends a question right after it.
  const message = finding.message.trim()
  const params = { title: finding.title, message: /[.!?…:)]$/.test(message) ? message : `${message}.` }
  const text = tr(isMust ? 'feedback.fromFinding.must' : 'feedback.fromFinding.other', params)
  const activityIri = finding.scope === 'activity' ? finding.targets[0] : undefined
  const iso = now.toISOString()
  const item: FeedbackItem = {
    id: uuid(),
    campIri,
    scope: activityIri ? 'activity' : 'camp',
    kind: isMust ? 'must' : 'suggestion',
    text,
    ruleId: finding.ruleId,
    findingId: finding.id,
    status: 'draft',
    createdAt: iso,
    updatedAt: iso,
  }
  if (activityIri) item.activityIri = activityIri
  if ((finding.tags ?? []).includes('midata') ||
    (finding.tags ?? []).includes('nds-quelle') ||
    /Quelle:\s*(MiData|NDS)/.test(finding.message)) item.redDerived = true
  return item
}

/** Template markdown for a review moment (from src/locales/de/feedback-templates/*.md). */
export function getTemplate(id: FeedbackTemplateId): string {
  return feedbackTemplates[`de/${id}`] ?? ''
}

export const TEMPLATE_IDS: readonly FeedbackTemplateId[] = [
  'grobprogramm',
  'programmbesprechung',
  'auflagen',
  'nach-dem-lagerbesuch',
  'abschluss',
] as const
