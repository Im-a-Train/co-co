/**
 * MCP tool implementations (ADR 0012). Pure domain code: everything impure goes through McpContext.
 *
 * Data zones: handlers never touch MiData/NDS data. Every free text that comes from eCamp or from the
 * coach passes the camp's redactor before it is returned; collaborator names, user IRIs, e-mails and
 * addresses are never returned. Write tools de-redact incoming text locally before storing it.
 * The dispatcher additionally runs every serialized result through assertMcpSendable().
 */
import { findingsForActivity } from '../cockpit'
import { findingStatus } from '../triage'
import { allowedTransitions, canTransition } from '../rounds'
import { countFindings } from '../rules/engine'
import { deadlineStatus } from '../rules/lib/deadlines'
import { categoryClassOf, computeJsDays } from '../rules/lib/jsDays'
import { findingsForAi } from '../zones/features'
import { redactorForFacts } from '../zones/mcpZone'
import type { Redactor } from '../zones/redact'
import type { CampFacts, FeedbackItem, FeedbackKind, Finding, Iri, ReviewStatus } from '../types'
import { normalizeActivityIri, normalizeCampIri } from './ids'
import { isRedFeedback } from './sanitize'
import {
  McpToolError,
  type McpConfirmBuilder,
  type McpConfirmRequest,
  type McpContext,
  type McpHandler,
  type McpToolName,
} from './types'
import { RED_DERIVED_MARKER } from '../zones/aiGateway'
import {
  confirmUpdateResource,
  confirmUpdateRule,
  get_resource,
  list_resources,
  search_resources,
  update_resource,
  update_rule,
} from './resourceHandlers'

const TRUNC_LIST = 1500
const TRUNC_DETAIL = 4000

// ---- small helpers ----------------------------------------------------------------------------

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' ? v : undefined
}
function reqStr(args: Record<string, unknown>, key: string): string {
  const v = str(args, key)
  if (v === undefined) throw new McpToolError(`Argument «${key}» fehlt.`)
  return v
}
function bool(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)} [gekürzt]` : text
}

function redactText(r: Redactor, text: string | null | undefined): string {
  return text ? r.redact(text).text : ''
}
function redactOrNull(r: Redactor, text: string | null | undefined): string | null {
  return text ? r.redact(text).text : null
}

function campArg(args: Record<string, unknown>): Iri {
  return normalizeCampIri(args.campId)
}

async function factsAndRedactor(ctx: McpContext, campIri: Iri): Promise<{ facts: CampFacts; r: Redactor }> {
  const facts = await ctx.loadFacts(campIri)
  return { facts, r: redactorForFacts(facts) }
}

const sortByStart = <T extends { start: string }>(a: T, b: T) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)

function findingView(f: Omit<Finding, 'explain'>, feedback: FeedbackItem[], r: Redactor) {
  return {
    id: f.id,
    ruleId: f.ruleId,
    severity: f.severity,
    confidence: f.confidence,
    title: redactText(r, f.title),
    message: redactText(r, f.message),
    scope: f.scope,
    targets: f.targets,
    evidence: f.evidence.map((e) => ({ label: redactText(r, e.label), snippet: redactOrNull(r, e.snippet) })),
    source: f.source ? { title: f.source.title, url: f.source.url } : null,
    status: findingStatus(f as Finding, feedback),
    ignoredReason: f.override ? redactText(r, f.override.reason) : null,
  }
}

/** Findings for MCP: red-tagged ones and `explain` are stripped, like for the AI. */
async function safeFindings(ctx: McpContext, campIri: Iri): Promise<Omit<Finding, 'explain'>[]> {
  return findingsForAi(await ctx.findings(campIri))
}

function feedbackView(item: FeedbackItem, facts: CampFacts, r: Redactor) {
  const activity = item.activityIri ? facts.activities.find((a) => a.iri === item.activityIri) : undefined
  return {
    id: item.id,
    scope: item.scope,
    activityId: item.activityIri ?? null,
    activityTitle: activity ? redactText(r, activity.title) : null,
    kind: item.kind,
    status: item.status,
    text: redactText(r, item.text),
    findingId: item.findingId ?? null,
    updatedAt: item.updatedAt,
  }
}

// ---- read tools -------------------------------------------------------------------------------

const list_camps: McpHandler = async (_args, ctx) => {
  const camps = await ctx.listCamps()
  return camps.map((c) => ({
    id: c.id,
    iri: c.iri,
    title: c.title,
    shortTitle: c.shortTitle,
    motto: c.motto,
    start: c.start,
    end: c.end,
    role: c.role,
    isPrototype: c.isPrototype,
  }))
}

const get_camp_overview: McpHandler = async (args, ctx) => {
  const campIri = campArg(args)
  const { facts, r } = await factsAndRedactor(ctx, campIri)
  const mapping = await ctx.getMapping(campIri)
  const confirmed = mapping?.confirmed ? mapping : null
  const findings = await safeFindings(ctx, campIri)
  const report = confirmed ? computeJsDays(facts, confirmed) : null
  const review = await ctx.getReview(campIri)
  const rounds = await ctx.listRounds(campIri)
  return {
    camp: {
      id: facts.camp.id,
      iri: facts.camp.iri,
      title: facts.camp.title,
      motto: facts.camp.motto,
      kind: facts.camp.kind,
      start: facts.camp.start,
      end: facts.camp.end,
    },
    periods: facts.periods.map((p) => ({ description: redactOrNull(r, p.description), start: p.start, end: p.end })),
    dayCount: facts.days.length,
    activityCount: facts.activities.length,
    categories: facts.categories.map((c) => ({
      short: c.short,
      name: c.name,
      class: confirmed ? categoryClassOf(confirmed, c.iri) : null,
    })),
    jsDays: report ? { valid: report.validDayCount, total: report.totalDayCount } : null,
    findingCounts: countFindings(findings as Finding[]),
    reviewStatus: review?.status ?? 'neu',
    roundCount: rounds.length,
  }
}

const list_activities: McpHandler = async (args, ctx) => {
  const campIri = campArg(args)
  const { facts, r } = await factsAndRedactor(ctx, campIri)
  const day = typeof args.day === 'number' ? args.day : null
  const withContent = bool(args, 'includeContent')
  const activities = new Map(facts.activities.map((a) => [a.iri, a]))
  const categories = new Map(facts.categories.map((c) => [c.iri, c]))
  return [...facts.scheduleEntries]
    .sort(sortByStart)
    .filter((e) => day === null || e.dayNumber === day)
    .map((e) => {
      const a = activities.get(e.activityIri)
      const row: Record<string, unknown> = {
        number: e.number,
        day: e.dayNumber,
        start: e.start,
        end: e.end,
        activityId: e.activityIri,
        title: a ? redactText(r, a.title) : '',
        category: a?.categoryIri ? (categories.get(a.categoryIri)?.short ?? null) : null,
        location: a ? redactOrNull(r, a.location) : null,
        responsibles: a ? a.responsibleIris.length : 0,
      }
      if (withContent && a) {
        row.storyboard = truncate(redactText(r, a.content.storyboardText), TRUNC_LIST)
        row.safety = truncate(redactText(r, a.content.safetyText), TRUNC_LIST)
      }
      return row
    })
}

const get_activity: McpHandler = async (args, ctx) => {
  const campIri = campArg(args)
  const activityIri = normalizeActivityIri(args.activityId)
  const { facts, r } = await factsAndRedactor(ctx, campIri)
  const a = facts.activities.find((x) => x.iri === activityIri)
  if (!a) throw new McpToolError('Aktivität nicht gefunden.')
  const feedback = await ctx.listFeedback(campIri)
  const categories = new Map(facts.categories.map((c) => [c.iri, c]))
  const findings = findingsForActivity(await safeFindings(ctx, campIri) as Finding[], activityIri)
  const text = (s: string) => truncate(redactText(r, s), TRUNC_DETAIL)
  return {
    activityId: a.iri,
    title: redactText(r, a.title),
    category: a.categoryIri ? (categories.get(a.categoryIri)?.short ?? null) : null,
    location: redactOrNull(r, a.location),
    responsibles: a.responsibleIris.length,
    entries: facts.scheduleEntries
      .filter((e) => e.activityIri === a.iri)
      .sort(sortByStart)
      .map((e) => ({ number: e.number, day: e.dayNumber, start: e.start, end: e.end, durationMinutes: e.durationMinutes })),
    content: {
      storyboard: text(a.content.storyboardText),
      safety: text(a.content.safetyText),
      notes: text(a.content.notesText),
      learningObjectives: text(a.content.learningObjectivesText),
      material: text(a.content.materialText),
    },
    findings: findings.map((f) => findingView(f, feedback, r)),
  }
}

const list_findings: McpHandler = async (args, ctx) => {
  const campIri = campArg(args)
  const { r } = await factsAndRedactor(ctx, campIri)
  const severity = str(args, 'severity')
  const includeIgnored = bool(args, 'includeIgnored')
  const feedback = await ctx.listFeedback(campIri)
  return (await safeFindings(ctx, campIri))
    .filter((f) => !severity || f.severity === severity)
    .filter((f) => includeIgnored || f.override == null)
    .map((f) => findingView(f, feedback, r))
}

const get_rule_catalog: McpHandler = async (args, ctx) => {
  const module = str(args, 'module')
  const packs = ctx.rulePacks()
  const edits = new Map((await ctx.listRuleEdits()).map((e) => [e.ruleId, e]))
  return {
    packs: packs.map((p) => ({ id: p.id, name: p.name, version: p.version })),
    rules: packs.flatMap((p) =>
      p.rules
        .filter((rule) => rule.meta.status !== 'retired')
        .filter((rule) => !module || rule.meta.module === module)
        .map(({ meta }) => ({
          id: meta.id,
          packId: p.id,
          module: meta.module,
          title: meta.title,
          description: meta.description,
          severity: meta.severity,
          confidence: meta.confidence,
          scope: meta.scope,
          validFrom: meta.validFrom ?? null,
          validTo: meta.validTo ?? null,
          source: { title: meta.source.title, url: meta.source.url },
          sourceKeys: meta.sources.map((s) => s.key),
          edited: edits.has(meta.id),
          updatedBy: edits.get(meta.id)?.updatedBy ?? null,
        })),
    ),
  }
}

const list_deadlines: McpHandler = async (args, ctx) => {
  const campIri = str(args, 'campId') !== undefined ? campArg(args) : null
  const today = ctx.now().toISOString().slice(0, 10)
  return (await ctx.deadlines(campIri)).map((d) => ({
    campId: d.campIri,
    campTitle: d.campTitle,
    kind: d.kind,
    title: d.title ?? null,
    due: d.due,
    status: deadlineStatus(d, today),
    source: d.source ? { title: d.source.title, url: d.source.url } : null,
  }))
}

const list_feedback: McpHandler = async (args, ctx) => {
  const campIri = campArg(args)
  const { facts, r } = await factsAndRedactor(ctx, campIri)
  return (await ctx.listFeedback(campIri)).filter((i) => !isRedFeedback(i)).map((i) => feedbackView(i, facts, r))
}

const list_rounds: McpHandler = async (args, ctx) => {
  const campIri = campArg(args)
  const { r } = await factsAndRedactor(ctx, campIri)
  const rounds = await ctx.listRounds(campIri)
  const review = await ctx.getReview(campIri)
  return {
    rounds: rounds.map((x) => ({
      number: x.number,
      startedAt: x.startedAt,
      closedAt: x.closedAt,
      note: redactText(r, x.note),
    })),
    reviewStatus: review?.status ?? 'neu',
    history: (review?.history ?? []).map((h) => ({ status: h.status, at: h.at, note: redactOrNull(r, h.note) })),
  }
}

// ---- write tools ------------------------------------------------------------------------------

function assertNotRedText(text: string): void {
  if (RED_DERIVED_MARKER.test(text)) throw new McpToolError('Der Text enthält MiData-/NDS-Angaben und kann nicht gespeichert werden.')
}

async function loadEditableFeedback(ctx: McpContext, id: string): Promise<FeedbackItem> {
  const item = await ctx.getFeedback(id)
  if (!item) throw new McpToolError('Feedback-Punkt nicht gefunden.')
  if (isRedFeedback(item)) throw new McpToolError('Dieser Feedback-Punkt ist nicht für MCP freigegeben.')
  return item
}

function findingRuleId(findingId: string): string | undefined {
  const i = findingId.indexOf(':')
  return i > 0 ? findingId.slice(0, i) : undefined
}

const add_feedback: McpHandler = async (args, ctx) => {
  const campIri = campArg(args)
  const { facts, r } = await factsAndRedactor(ctx, campIri)
  const text = r.deredact(reqStr(args, 'text')).trim()
  if (!text) throw new McpToolError('Der Text ist leer.')
  assertNotRedText(text)
  const activityIri = str(args, 'activityId') !== undefined ? normalizeActivityIri(args.activityId) : undefined
  if (activityIri && !facts.activities.some((a) => a.iri === activityIri)) throw new McpToolError('Aktivität gehört nicht zu diesem Lager.')
  const findingId = str(args, 'findingId')
  const now = ctx.now().toISOString()
  const item: FeedbackItem = {
    id: ctx.newId(),
    campIri,
    scope: activityIri ? 'activity' : 'camp',
    kind: reqStr(args, 'kind') as FeedbackKind,
    text,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
  if (activityIri) item.activityIri = activityIri
  if (findingId) {
    item.findingId = findingId
    const ruleId = findingRuleId(findingId)
    if (ruleId) item.ruleId = ruleId
  }
  await ctx.saveFeedback(item)
  return { id: item.id, status: item.status }
}

const update_feedback: McpHandler = async (args, ctx) => {
  const item = await loadEditableFeedback(ctx, reqStr(args, 'feedbackId'))
  if (item.status !== 'draft') throw new McpToolError('Nur Entwürfe können geändert werden.')
  const newText = str(args, 'text')
  const newKind = str(args, 'kind')
  if (newText === undefined && newKind === undefined) throw new McpToolError('Nichts zu ändern: «text» oder «kind» angeben.')
  const { r } = await factsAndRedactor(ctx, item.campIri)
  const next: FeedbackItem = { ...item, updatedAt: ctx.now().toISOString() }
  if (newText !== undefined) {
    const text = r.deredact(newText).trim()
    if (!text) throw new McpToolError('Der Text ist leer.')
    assertNotRedText(text)
    next.text = text
  }
  if (newKind !== undefined) next.kind = newKind as FeedbackKind
  await ctx.saveFeedback(next)
  return { id: next.id, status: next.status }
}

const ignore_finding: McpHandler = async (args, ctx) => {
  const campIri = campArg(args)
  const findingId = reqStr(args, 'findingId')
  const finding = (await safeFindings(ctx, campIri)).find((f) => f.id === findingId)
  if (!finding) throw new McpToolError('Befund nicht gefunden.')
  const { r } = await factsAndRedactor(ctx, campIri)
  const reason = r.deredact(reqStr(args, 'reason')).trim()
  if (!reason) throw new McpToolError('Der Grund ist leer.')
  assertNotRedText(reason)
  await ctx.addOverride(campIri, finding.id, finding.ruleId, reason)
  return { findingId: finding.id, ignored: true }
}

async function reviewStatusArgs(args: Record<string, unknown>, ctx: McpContext) {
  const campIri = campArg(args)
  const status = reqStr(args, 'status') as ReviewStatus
  const current: ReviewStatus = (await ctx.getReview(campIri))?.status ?? 'neu'
  return { campIri, status, current }
}

const set_review_status: McpHandler = async (args, ctx) => {
  const { campIri, status, current } = await reviewStatusArgs(args, ctx)
  if (!canTransition(current, status)) {
    const allowed = allowedTransitions(current)
    throw new McpToolError(
      `Statuswechsel von «${current}» nach «${status}» ist nicht erlaubt. Erlaubt: ${allowed.length ? allowed.join(', ') : 'keiner'}.`,
    )
  }
  const { r } = await factsAndRedactor(ctx, campIri)
  const noteRaw = str(args, 'note')
  const note = noteRaw ? r.deredact(noteRaw).trim() || null : null
  const review = await ctx.setReviewStatus(campIri, status, note)
  return { status: review.status }
}

const post_feedback_comment: McpHandler = async (args, ctx) => {
  const item = await loadEditableFeedback(ctx, reqStr(args, 'feedbackId'))
  if (item.scope !== 'activity' || !item.activityIri) throw new McpToolError('Nur Aktivitäts-Punkte können in eCamp gepostet werden.')
  if (item.status !== 'draft') throw new McpToolError('Nur Entwürfe können gepostet werden.')
  if (!item.text.trim()) throw new McpToolError('Der Text ist leer.')
  const posted = await ctx.postFeedbackComment(item.id)
  return { id: posted.id, status: posted.status, postedParts: posted.postedParts ?? 0 }
}

export const MCP_HANDLERS: Record<McpToolName, McpHandler> = {
  list_camps,
  get_camp_overview,
  list_activities,
  get_activity,
  list_findings,
  get_rule_catalog,
  list_deadlines,
  list_feedback,
  list_rounds,
  list_resources,
  search_resources,
  get_resource,
  add_feedback,
  update_feedback,
  ignore_finding,
  set_review_status,
  post_feedback_comment,
  update_resource,
  update_rule,
}

// ---- confirmation texts -----------------------------------------------------------------------

const KIND_LABEL: Record<FeedbackKind, string> = {
  kudos: 'Lob',
  must: 'Auflage (muss)',
  suggestion: 'Anregung',
  question: 'Frage',
}

function confirm(tool: McpToolName, summary: string, details: string[]): McpConfirmRequest {
  return { tool, kind: 'write', summary, details }
}

const confirmAddFeedback: McpConfirmBuilder = async (args, ctx) => {
  const campIri = campArg(args)
  const { facts, r } = await factsAndRedactor(ctx, campIri)
  const activityIri = str(args, 'activityId') !== undefined ? normalizeActivityIri(args.activityId) : null
  const activity = activityIri ? facts.activities.find((a) => a.iri === activityIri) : undefined
  return confirm('add_feedback', `Feedback-Entwurf hinzufügen (Lager «${facts.camp.title}»)`, [
    `Art: ${KIND_LABEL[reqStr(args, 'kind') as FeedbackKind] ?? reqStr(args, 'kind')}`,
    activity ? `Aktivität: ${activity.title}` : 'Ganzes Lager',
    `Text: ${r.deredact(reqStr(args, 'text'))}`,
  ])
}

const confirmUpdateFeedback: McpConfirmBuilder = async (args, ctx) => {
  const item = await loadEditableFeedback(ctx, reqStr(args, 'feedbackId'))
  const { facts, r } = await factsAndRedactor(ctx, item.campIri)
  const details = [`Bisher: ${item.text}`]
  const kind = str(args, 'kind')
  const text = str(args, 'text')
  if (kind) details.push(`Neue Art: ${KIND_LABEL[kind as FeedbackKind] ?? kind}`)
  if (text !== undefined) details.push(`Neuer Text: ${r.deredact(text)}`)
  return confirm('update_feedback', `Feedback-Entwurf ändern (Lager «${facts.camp.title}»)`, details)
}

const confirmIgnoreFinding: McpConfirmBuilder = async (args, ctx) => {
  const campIri = campArg(args)
  const { facts, r } = await factsAndRedactor(ctx, campIri)
  const findingId = reqStr(args, 'findingId')
  const finding = (await safeFindings(ctx, campIri)).find((f) => f.id === findingId)
  return confirm('ignore_finding', `Befund ignorieren (Lager «${facts.camp.title}»)`, [
    `Befund: ${finding ? finding.title : findingId}`,
    `Grund: ${r.deredact(reqStr(args, 'reason'))}`,
  ])
}

const confirmSetReviewStatus: McpConfirmBuilder = async (args, ctx) => {
  const { campIri, status, current } = await reviewStatusArgs(args, ctx)
  const { facts, r } = await factsAndRedactor(ctx, campIri)
  const details = [`Neuer Status: ${status} (bisher: ${current})`]
  const note = str(args, 'note')
  if (note) details.push(`Notiz: ${r.deredact(note)}`)
  return confirm('set_review_status', `Review-Status setzen (Lager «${facts.camp.title}»)`, details)
}

const confirmPostFeedbackComment: McpConfirmBuilder = async (args, ctx) => {
  const item = await loadEditableFeedback(ctx, reqStr(args, 'feedbackId'))
  const { facts } = await factsAndRedactor(ctx, item.campIri)
  const activity = item.activityIri ? facts.activities.find((a) => a.iri === item.activityIri) : undefined
  return confirm('post_feedback_comment', `Feedback in eCamp posten (Lager «${facts.camp.title}»)`, [
    activity ? `Aktivität: ${activity.title}` : 'Aktivität: (unbekannt)',
    `Text: ${item.text}`,
    'Wird als Kommentar in eCamp gepostet (für die Lagerleitung sichtbar)',
  ])
}

export const MCP_CONFIRM: Partial<Record<McpToolName, McpConfirmBuilder>> = {
  add_feedback: confirmAddFeedback,
  update_feedback: confirmUpdateFeedback,
  ignore_finding: confirmIgnoreFinding,
  set_review_status: confirmSetReviewStatus,
  post_feedback_comment: confirmPostFeedbackComment,
  update_resource: confirmUpdateResource,
  update_rule: confirmUpdateRule,
}
