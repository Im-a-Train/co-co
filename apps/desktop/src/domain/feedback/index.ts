/**
 * Feedback domain. Pure (store in ./store.ts).
 * Feedback-Kultur order: kudos -> must -> suggestion -> question.
 */
import { feedbackTemplates } from '../../locales/messages'
import { anchorLabel, feedbackKindOf, isManualCategory } from '../manualFindings'
import type { CampFacts, DocumentRecord, FeedbackChannel, FeedbackItem, FeedbackKind, FeedbackTemplateId, Finding, Iri } from '../types'
import { tr } from './i18n'
import { KIND_ORDER, orderItems } from './order'
import { groupFeedback } from './structure'

export { KIND_ORDER, orderItems }
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
  /** Camp facts: needed to group activity items by day (without them: no day headings). */
  facts?: CampFacts | null
  /** Documents (names for document items, first linked activity for placement). */
  documents?: Pick<DocumentRecord, 'id' | 'name' | 'activityIris'>[]
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

// --- rendering ------------------------------------------------------------------------------------
// Layout: "Allgemein" first, then one section per day with one sub-heading per activity. Every item line
// carries its kind (WhatsApp: emoji, others: "- Auflage: ..."). Items stay in Feedback-Kultur order.

const WHATSAPP_EMOJI: Record<FeedbackKind, string> = {
  kudos: '🌟',
  must: '⚠️',
  suggestion: '💡',
  question: '❓',
}

interface RenderGroup {
  /** "{block numbers} {title}" of the activity; '' for general / unknown. */
  title: string
  url?: string
  shortUrl?: string
  items: FeedbackItem[]
}
interface RenderSection {
  heading: string | null
  groups: RenderGroup[]
}

function singleLine(text: string): string {
  return text.trim().replace(/\n+/g, ' ')
}

function buildSections(items: FeedbackItem[], ctx: RenderContext): RenderSection[] {
  const structure = groupFeedback(
    items.filter((i) => i.text.trim() !== ''),
    ctx.facts ?? null,
    ctx.documents ?? [],
  )
  const sections: RenderSection[] = []
  if (structure.general.length > 0) {
    sections.push({ heading: tr('feedback.structure.general'), groups: [{ title: '', items: structure.general }] })
  }
  for (const day of structure.days) {
    const groups = day.activities.map((a): RenderGroup => {
      const known = ctx.activityTitles[a.activityIri] ?? (a.title !== a.activityIri ? a.title : '')
      const nr = ctx.activityNumbers ? ctx.activityNumbers[a.activityIri] : a.number
      const urls = ctx.includeLinks === false
        ? {}
        : { url: ctx.activityUrls?.[a.activityIri], shortUrl: ctx.activityShortUrls?.[a.activityIri] }
      return { title: known ? (nr ? `${nr} ${known}` : known) : '', ...urls, items: a.items }
    })
    // Without camp facts there is no day information: skip the (only) "Ohne Termin" heading.
    sections.push({ heading: ctx.facts ? day.label : null, groups })
  }
  return sections
}

/** "(Dokument «name», S. 3) " for document items, else ''. */
function documentPrefix(item: FeedbackItem, ctx: RenderContext): string {
  if (!item.documentId) return ''
  const name = ctx.documents?.find((d) => d.id === item.documentId)?.name
  if (!name) return ''
  const where = anchorLabel(item.documentAnchor)
  return `(${tr('feedback.structure.documentPrefix', { name })}${where ? `, ${where}` : ''}) `
}

function itemLine(item: FeedbackItem, channel: FeedbackChannel, ctx: RenderContext): string {
  const body = `${documentPrefix(item, ctx)}${singleLine(item.text)}`
  if (channel === 'whatsapp') return `${WHATSAPP_EMOJI[item.kind]} ${body}`
  return `- ${tr(`feedback.kind.${item.kind}`)}: ${body}`
}

function groupHeading(g: RenderGroup, channel: FeedbackChannel): string | null {
  if (channel === 'whatsapp') return g.title ? `_${g.title}_` : null // WhatsApp cannot hide URLs: no link
  const url = g.shortUrl ?? g.url
  if (!g.title && !url) return null
  return `${g.title}${url ? `${g.title ? ' ' : ''}(${tr('feedback.linkLabel')}: ${url})` : ''}`
}

/** Renders the grouped items (Allgemein, days, activities) without template. */
export function renderItemsBlock(items: FeedbackItem[], channel: FeedbackChannel, ctx: RenderContext): string {
  const blocks: string[] = []
  for (const section of buildSections(items, ctx)) {
    const lines: string[] = []
    if (section.heading) lines.push(channel === 'whatsapp' ? `*${section.heading}*` : `${section.heading}:`)
    for (const g of section.groups) {
      const h = groupHeading(g, channel)
      if (h) lines.push(h)
      for (const i of g.items) lines.push(itemLine(i, channel, ctx))
    }
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n')
}

/** HTML items block (bold headings, linked activity titles); `linked` = any activity has a link. */
function renderItemsHtml(items: FeedbackItem[], ctx: RenderContext): { html: string; linked: boolean } {
  let linked = false
  const blocks: string[] = []
  for (const section of buildSections(items, ctx)) {
    const lines: string[] = []
    if (section.heading) lines.push(`<b>${escapeHtml(`${section.heading}:`)}</b>`)
    for (const g of section.groups) {
      if (g.url) {
        linked = true
        const label = g.title ? escapeHtml(g.title) : escapeHtml(tr('feedback.openInEcamp'))
        lines.push(`<a href="${escapeHtml(g.url)}">${label}</a>`)
      } else if (g.title) lines.push(escapeHtml(g.title))
      for (const i of g.items) {
        lines.push(`- ${escapeHtml(tr(`feedback.kind.${i.kind}`))}: ${htmlText(`${documentPrefix(i, ctx)}${singleLine(i.text)}`)}`)
      }
    }
    blocks.push(lines.join('<br>'))
  }
  return { html: blocks.join('<br><br>'), linked }
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

/** Document findings: the item keeps the document and the anchor (page / cell / point). */
function applyDocumentTarget(item: FeedbackItem, finding: Finding): void {
  if (finding.scope !== 'document' || !finding.targets[0]) return
  item.documentId = finding.targets[0]
  const anchor = finding.evidence.find((e) => e.kind === 'document' && e.anchor)?.anchor
  if (anchor) item.documentAnchor = { ...anchor }
}

/** Manual (coach) finding: the coach's comment is the text, the kind follows the category. */
function itemFromManualFinding(finding: Finding, campIri: Iri, now: Date): FeedbackItem {
  const cat = (finding.tags ?? []).find((t) => t.startsWith('kategorie:'))?.slice('kategorie:'.length)
  const activityIri = finding.scope === 'activity' ? finding.targets[0] : undefined
  const iso = now.toISOString()
  const item: FeedbackItem = {
    id: uuid(),
    campIri,
    scope: activityIri ? 'activity' : 'camp',
    kind: isManualCategory(cat) ? feedbackKindOf(cat) : 'suggestion',
    text: finding.message.trim(),
    ruleId: finding.ruleId,
    findingId: finding.id,
    manualFindingId: finding.id,
    status: 'draft',
    createdAt: iso,
    updatedAt: iso,
  }
  if (activityIri) item.activityIri = activityIri
  applyDocumentTarget(item, finding)
  return item
}

/** New draft item prefilled from a finding (kind 'must' for must findings, else 'suggestion'). */
export function itemFromFinding(finding: Finding, campIri: Iri, now: Date = new Date()): FeedbackItem {
  if (finding.origin === 'manual') return itemFromManualFinding(finding, campIri, now)
  const isMust = finding.severity === 'must'
  // Rule messages often lack final punctuation; the template appends a question right after it.
  const message = finding.message.trim()
  const params = { title: finding.title, message: /[.!?…:)]$/.test(message) ? message : `${message}.` }
  const text = finding.feedbackText?.trim() || tr(isMust ? 'feedback.fromFinding.must' : 'feedback.fromFinding.other', params)
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
  applyDocumentTarget(item, finding)
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
