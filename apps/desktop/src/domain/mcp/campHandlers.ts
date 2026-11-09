/**
 * MCP tools for manual findings, structured feedback, documents, review progress and review guidance
 * (ADR 0014). Same rules as handlers.ts: no red data (MiData/NDS), every free text passes the camp's
 * redactor, writes de-redact incoming text, documents only with `aiAllowed` and never the file path.
 */
import { reviewProgress, isDocumentReviewed } from '../cockpit/progress'
import { GENERAL_POINTS, generalPointById } from '../feedback/defaults'
import { tr } from '../feedback/i18n'
import { groupFeedback } from '../feedback/structure'
import { MANUAL_COMMENT_MAX, anchorLabel, isManualCategory, isManualFindingId, manualToFinding, newManualFinding } from '../manualFindings'
import { aiGuidanceRules, guidanceText } from '../rules/aiGuidance'
import { progressOf, statusesOf } from '../triage'
import { RED_DERIVED_MARKER } from '../zones/aiGateway'
import { findingsForAi } from '../zones/features'
import { redactorForFacts } from '../zones/mcpZone'
import type { Redactor } from '../zones/redact'
import type {
  CampFacts,
  DocumentAnchor,
  DocumentRecord,
  FeedbackItem,
  Finding,
  Iri,
  ManualFinding,
  ManualFindingCategory,
} from '../types'
import { normalizeActivityIri, normalizeCampIri } from './ids'
import { isRedFeedback } from './sanitize'
import { McpToolError, type McpConfirmBuilder, type McpConfirmRequest, type McpContext, type McpHandler, type McpToolName } from './types'

const DOC_TEXT_PAGE = 20_000
const GUIDANCE_MAX_CHARS = 22_000

// ---- helpers ----------------------------------------------------------------------------------

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' ? v : undefined
}
function reqStr(args: Record<string, unknown>, key: string): string {
  const v = str(args, key)
  if (v === undefined) throw new McpToolError(`Argument «${key}» fehlt.`)
  return v
}
function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key]
  return typeof v === 'number' ? v : undefined
}
const campArg = (args: Record<string, unknown>): Iri => normalizeCampIri(args.campId)

async function factsAndRedactor(ctx: McpContext, campIri: Iri): Promise<{ facts: CampFacts; r: Redactor }> {
  const facts = await ctx.loadFacts(campIri)
  return { facts, r: redactorForFacts(facts) }
}

const redactText = (r: Redactor, text: string | null | undefined): string => (text ? r.redact(text).text : '')

function assertNotRedText(text: string): void {
  if (RED_DERIVED_MARKER.test(text)) throw new McpToolError('Der Text enthält MiData-/NDS-Angaben und kann nicht gespeichert werden.')
}

/** Documents of the camp that may reach MCP (the context already drops red ones; checked again here). */
async function mcpDocuments(ctx: McpContext, campIri: Iri): Promise<DocumentRecord[]> {
  return (await ctx.listDocuments(campIri)).filter((d) => d.zone !== 'red')
}

/** Manual findings whose comment does not quote MiData/NDS. */
async function mcpManualFindings(ctx: McpContext, campIri: Iri): Promise<ManualFinding[]> {
  return (await ctx.listManualFindings(campIri)).filter((m) => !RED_DERIVED_MARKER.test(m.comment))
}

function anchorView(a: DocumentAnchor | undefined, r: Redactor) {
  if (!a) return null
  return {
    page: a.page ?? null,
    sheet: a.sheet ? redactText(r, a.sheet) : null,
    cell: a.cell ?? null,
    km: a.km ?? null,
    label: anchorLabel(a),
  }
}

function manualView(m: ManualFinding, facts: CampFacts, docs: DocumentRecord[], r: Redactor) {
  const activity = m.activityIri ? facts.activities.find((a) => a.iri === m.activityIri) : undefined
  const doc = m.documentId ? docs.find((d) => d.id === m.documentId) : undefined
  return {
    id: m.id,
    scope: m.scope,
    activityId: m.activityIri ?? null,
    activityTitle: activity ? redactText(r, activity.title) : null,
    documentId: m.documentId ?? null,
    documentName: doc ? redactText(r, doc.name) : null,
    anchor: anchorView(m.anchor, r),
    category: m.category,
    comment: redactText(r, m.comment),
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }
}

function feedbackView(item: FeedbackItem, r: Redactor) {
  return {
    id: item.id,
    scope: item.scope,
    kind: item.kind,
    status: item.status,
    text: redactText(r, item.text),
    findingId: item.findingId ?? null,
    documentId: item.documentId ?? null,
    documentAnchor: anchorView(item.documentAnchor, r),
    generalPointId: item.generalPointId ?? null,
    manualFindingId: item.manualFindingId ?? null,
    updatedAt: item.updatedAt,
  }
}

// ---- read tools -------------------------------------------------------------------------------

export const list_manual_findings: McpHandler = async (args, ctx) => {
  const campIri = campArg(args)
  const { facts, r } = await factsAndRedactor(ctx, campIri)
  const activityIri = str(args, 'activityId') !== undefined ? normalizeActivityIri(args.activityId) : null
  const docs = await mcpDocuments(ctx, campIri)
  return (await mcpManualFindings(ctx, campIri))
    .filter((m) => !activityIri || m.activityIri === activityIri)
    .map((m) => manualView(m, facts, docs, r))
}

export const get_feedback_structure: McpHandler = async (args, ctx) => {
  const campIri = campArg(args)
  const { facts, r } = await factsAndRedactor(ctx, campIri)
  const items = (await ctx.listFeedback(campIri)).filter((i) => !isRedFeedback(i))
  const docs = await mcpDocuments(ctx, campIri)
  const structure = groupFeedback(items, facts, docs)
  return {
    general: structure.general.map((i) => feedbackView(i, r)),
    days: structure.days.map((d) => ({
      dayId: d.dayIri,
      dayNumber: d.dayNumber,
      date: d.date,
      label: d.label,
      activities: d.activities.map((a) => ({
        activityId: a.activityIri,
        number: a.number,
        title: redactText(r, a.title),
        items: a.items.map((i) => feedbackView(i, r)),
      })),
    })),
  }
}

export const list_general_feedback_points: McpHandler = async (args, ctx) => {
  const campIri = campArg(args)
  await ctx.loadFacts(campIri)
  const items = (await ctx.listFeedback(campIri)).filter((i) => !isRedFeedback(i))
  return GENERAL_POINTS.map((p) => {
    const used = items.filter((i) => i.generalPointId === p.id)
    return {
      id: p.id,
      title: tr(p.titleKey),
      prompt: tr(p.promptKey),
      checks: p.checks.map((k) => tr(k)),
      ruleIds: p.ruleIds ?? [],
      checklistIds: p.checklistIds ?? [],
      used: used.length > 0,
      feedbackIds: used.map((i) => i.id),
    }
  })
}

/** Triage input: rule findings plus the coach's manual findings (like the Befunde view), overrides attached. */
async function triageFindings(ctx: McpContext, campIri: Iri, facts: CampFacts): Promise<Finding[]> {
  const rule = findingsForAi(await ctx.findings(campIri)) as Finding[]
  const overrides = new Map((await ctx.listOverrides(campIri)).map((o) => [o.findingId, o]))
  const manual = (await mcpManualFindings(ctx, campIri)).map((m) => {
    const f = manualToFinding(m, { facts, categoryLabel: (c) => c })
    const o = overrides.get(f.id)
    return o ? { ...f, override: o } : f
  })
  return [...rule, ...manual]
}

export const get_camp_progress: McpHandler = async (args, ctx) => {
  const campIri = campArg(args)
  const facts = await ctx.loadFacts(campIri)
  const mapping = await ctx.getMapping(campIri)
  const review = await ctx.getReview(campIri)
  const rounds = await ctx.listRounds(campIri)
  const rc = await ctx.reviewContext(campIri)
  const fb = (await ctx.listFeedback(campIri)).filter((i) => !isRedFeedback(i))
  const findings = await triageFindings(ctx, campIri, facts)
  const tri = progressOf(statusesOf(findings, fb))
  const docs = await mcpDocuments(ctx, campIri)
  const manual = await mcpManualFindings(ctx, campIri)
  const manualByDoc = new Map<string, number>()
  for (const m of manual) if (m.documentId) manualByDoc.set(m.documentId, (manualByDoc.get(m.documentId) ?? 0) + 1)
  const progress = reviewProgress({
    reviewStatus: review?.status ?? null,
    mappingConfirmed: mapping?.confirmed === true,
    coachInputsPresent: rc.coachInputsPresent,
    triage: { done: tri.done, total: tri.total },
    manualFindingCount: manual.length,
    documents: { total: docs.length, reviewed: docs.filter((d) => isDocumentReviewed(d, manualByDoc.get(d.id) ?? 0)).length },
    checklist: rc.checklist,
    feedback: {
      total: fb.length,
      draft: fb.filter((i) => i.status === 'draft').length,
      posted: fb.filter((i) => i.status === 'posted').length,
      sent: fb.filter((i) => i.status === 'sent').length,
    },
    rounds: rounds.length,
  })
  return {
    percent: progress.percent,
    steps: progress.steps.map((s) => ({
      key: s.key,
      label: tr(s.labelKey),
      done: s.done,
      value: s.value,
      total: s.total,
      hint: s.hintKey ? tr(s.hintKey) : null,
    })),
  }
}

export const list_documents: McpHandler = async (args, ctx) => {
  const campIri = campArg(args)
  const { r } = await factsAndRedactor(ctx, campIri)
  const docs = await mcpDocuments(ctx, campIri)
  const manual = await mcpManualFindings(ctx, campIri)
  return docs.map((d) => ({
    id: d.id,
    name: redactText(r, d.name),
    kind: d.kind,
    size: d.size,
    activityIds: d.activityIris,
    docCheck: d.docCheck
      ? { complete: d.docCheck.complete, checkedAt: d.docCheck.checkedAt, missing: d.docCheck.items.filter((i) => !i.found).map((i) => i.key) }
      : null,
    gpx: d.gpx
      ? {
          pointCount: d.gpx.pointCount,
          distanceKm: d.gpx.distanceKm,
          ascentM: d.gpx.ascentM,
          descentM: d.gpx.descentM,
          lkm: d.gpx.lkm,
          lkmWithDescent: d.gpx.lkmWithDescent,
          estimatedMinutes: d.gpx.estimatedMinutes,
          highestPointM: d.gpx.highestPointM,
          lowestPointM: d.gpx.lowestPointM,
        }
      : null,
    aiAllowed: d.aiAllowed,
    textLength: d.text.length,
    manualFindingCount: manual.filter((m) => m.documentId === d.id).length,
  }))
}

export const get_document_text: McpHandler = async (args, ctx) => {
  const campIri = campArg(args)
  const documentId = reqStr(args, 'documentId')
  const { r } = await factsAndRedactor(ctx, campIri)
  const doc = (await mcpDocuments(ctx, campIri)).find((d) => d.id === documentId)
  if (!doc) throw new McpToolError('Dokument nicht gefunden.')
  if (!doc.aiAllowed) throw new McpToolError('Der Coach hat dieses Dokument nicht für KI freigegeben.')
  const text = redactText(r, doc.text)
  const offset = Math.min(num(args, 'offset') ?? 0, text.length)
  const length = Math.min(num(args, 'length') ?? DOC_TEXT_PAGE, DOC_TEXT_PAGE)
  const end = Math.min(text.length, offset + length)
  return {
    documentId: doc.id,
    name: redactText(r, doc.name),
    offset,
    length: end - offset,
    totalLength: text.length,
    nextOffset: end < text.length ? end : null,
    content: text.slice(offset, end),
  }
}

export const get_review_guidance: McpHandler = async (args, ctx) => {
  const campIri = campArg(args)
  const facts = await ctx.loadFacts(campIri)
  const rc = await ctx.reviewContext(campIri)
  const rules = aiGuidanceRules(ctx.rulePacks(), {
    campStart: facts.camp.start ? facts.camp.start.slice(0, 10) : null,
    disabledRuleIds: new Set(rc.disabledRuleIds),
    moduleStates: rc.moduleStates,
  })
  return {
    ruleCount: rules.length,
    rules: rules.map((m) => ({ id: m.id, kind: m.kind, module: m.module, title: m.title })),
    guidance: guidanceText(rules, GUIDANCE_MAX_CHARS),
  }
}

// ---- write tools ------------------------------------------------------------------------------

function anchorFromArgs(args: Record<string, unknown>): DocumentAnchor | undefined {
  const a: DocumentAnchor = {}
  const page = num(args, 'page')
  const sheet = str(args, 'sheet')
  const cell = str(args, 'cell')
  const km = num(args, 'km')
  if (page !== undefined) a.page = page
  if (sheet) a.sheet = sheet
  if (cell) a.cell = cell
  if (km !== undefined) a.km = km
  return Object.keys(a).length ? a : undefined
}

interface ManualAddPlan {
  campIri: Iri
  facts: CampFacts
  r: Redactor
  scope: ManualFinding['scope']
  activityIri?: Iri
  document?: DocumentRecord
  anchor?: DocumentAnchor
}

async function planManualAdd(args: Record<string, unknown>, ctx: McpContext): Promise<ManualAddPlan> {
  const campIri = campArg(args)
  const { facts, r } = await factsAndRedactor(ctx, campIri)
  const activityIri = str(args, 'activityId') !== undefined ? normalizeActivityIri(args.activityId) : undefined
  if (activityIri && !facts.activities.some((a) => a.iri === activityIri)) throw new McpToolError('Aktivität gehört nicht zu diesem Lager.')
  const documentId = str(args, 'documentId')
  let document: DocumentRecord | undefined
  if (documentId) {
    document = (await mcpDocuments(ctx, campIri)).find((d) => d.id === documentId)
    if (!document) throw new McpToolError('Dokument gehört nicht zu diesem Lager.')
  }
  const anchor = anchorFromArgs(args)
  if (anchor && !document) throw new McpToolError('Page, sheet, cell und km brauchen eine documentId.')
  return { campIri, facts, r, scope: document ? 'document' : activityIri ? 'activity' : 'camp', activityIri, document, anchor }
}

function checkComment(r: Redactor, raw: string): string {
  const comment = r.deredact(raw).trim()
  if (!comment) throw new McpToolError('Der Kommentar ist leer.')
  if (comment.length > MANUAL_COMMENT_MAX) throw new McpToolError(`Der Kommentar ist länger als ${MANUAL_COMMENT_MAX} Zeichen.`)
  assertNotRedText(comment)
  return comment
}

function checkCategory(v: string): ManualFindingCategory {
  if (!isManualCategory(v)) throw new McpToolError('Unbekannte Kategorie.')
  return v
}

export const add_manual_finding: McpHandler = async (args, ctx) => {
  const plan = await planManualAdd(args, ctx)
  const comment = checkComment(plan.r, reqStr(args, 'comment'))
  const category = checkCategory(reqStr(args, 'category'))
  let item: ManualFinding
  try {
    item = newManualFinding(
      {
        campIri: plan.campIri,
        scope: plan.scope,
        activityIri: plan.activityIri,
        documentId: plan.document?.id,
        anchor: plan.anchor,
        category,
        comment,
      },
      ctx.newId(),
      ctx.now().toISOString(),
    )
  } catch (e) {
    throw new McpToolError(e instanceof Error ? e.message : String(e))
  }
  await ctx.saveManualFinding(item)
  return { id: item.id, scope: item.scope }
}

async function loadManual(ctx: McpContext, id: string): Promise<ManualFinding> {
  if (!isManualFindingId(id)) throw new McpToolError('Ungültige Befund-ID (erwartet «manual:…»).')
  const item = await ctx.getManualFinding(id)
  if (!item) throw new McpToolError('Manueller Befund nicht gefunden.')
  if (RED_DERIVED_MARKER.test(item.comment)) throw new McpToolError('Dieser Befund ist nicht für MCP freigegeben.')
  return item
}

export const update_manual_finding: McpHandler = async (args, ctx) => {
  const item = await loadManual(ctx, reqStr(args, 'findingId'))
  const newComment = str(args, 'comment')
  const newCategory = str(args, 'category')
  if (newComment === undefined && newCategory === undefined) throw new McpToolError('Nichts zu ändern: «category» oder «comment» angeben.')
  const { r } = await factsAndRedactor(ctx, item.campIri)
  const next: ManualFinding = { ...item, updatedAt: ctx.now().toISOString() }
  if (newComment !== undefined) next.comment = checkComment(r, newComment)
  if (newCategory !== undefined) next.category = checkCategory(newCategory)
  await ctx.saveManualFinding(next)
  return { id: next.id, category: next.category }
}

export const delete_manual_finding: McpHandler = async (args, ctx) => {
  const item = await loadManual(ctx, reqStr(args, 'findingId'))
  await ctx.deleteManualFinding(item.id)
  return { id: item.id, deleted: true }
}

/** Validated links of add_feedback / update_feedback to documents, general points and manual findings. */
export interface FeedbackLinks {
  documentId?: string
  generalPointId?: string
  manualFindingId?: string
}

export async function feedbackLinksFromArgs(args: Record<string, unknown>, campIri: Iri, ctx: McpContext): Promise<FeedbackLinks> {
  const out: FeedbackLinks = {}
  const documentId = str(args, 'documentId')
  if (documentId) {
    if (!(await mcpDocuments(ctx, campIri)).some((d) => d.id === documentId)) throw new McpToolError('Dokument gehört nicht zu diesem Lager.')
    out.documentId = documentId
  }
  const generalPointId = str(args, 'generalPointId')
  if (generalPointId) {
    if (!generalPointById(generalPointId)) throw new McpToolError('Unbekannter allgemeiner Punkt (siehe list_general_feedback_points).')
    out.generalPointId = generalPointId
  }
  const manualFindingId = str(args, 'manualFindingId')
  if (manualFindingId) {
    const m = isManualFindingId(manualFindingId) ? await ctx.getManualFinding(manualFindingId) : null
    if (!m || m.campIri !== campIri) throw new McpToolError('Manueller Befund gehört nicht zu diesem Lager.')
    out.manualFindingId = manualFindingId
  }
  return out
}

// ---- confirmation texts -----------------------------------------------------------------------

const confirm = (tool: McpToolName, summary: string, details: string[]): McpConfirmRequest => ({ tool, kind: 'write', summary, details })

const CATEGORY_LABEL = (c: string) => tr(`findings.manual.category.${c}`)

export const confirmAddManualFinding: McpConfirmBuilder = async (args, ctx) => {
  const plan = await planManualAdd(args, ctx)
  const activity = plan.activityIri ? plan.facts.activities.find((a) => a.iri === plan.activityIri) : undefined
  const details = [
    `Kategorie: ${CATEGORY_LABEL(reqStr(args, 'category'))}`,
    activity ? `Aktivität: ${activity.title}` : 'Ganzes Lager',
  ]
  if (plan.document) {
    const where = anchorLabel(plan.anchor)
    details.push(`Dokument: ${plan.document.name}${where ? ` (${where})` : ''}`)
  }
  details.push(`Kommentar: ${plan.r.deredact(reqStr(args, 'comment'))}`)
  return confirm('add_manual_finding', `Eigenen Befund hinzufügen (Lager «${plan.facts.camp.title}»)`, details)
}

export const confirmUpdateManualFinding: McpConfirmBuilder = async (args, ctx) => {
  const item = await loadManual(ctx, reqStr(args, 'findingId'))
  const { facts, r } = await factsAndRedactor(ctx, item.campIri)
  const details = [`Bisher: ${CATEGORY_LABEL(item.category)}: ${item.comment}`]
  const category = str(args, 'category')
  const comment = str(args, 'comment')
  if (category) details.push(`Neue Kategorie: ${CATEGORY_LABEL(category)}`)
  if (comment !== undefined) details.push(`Neuer Kommentar: ${r.deredact(comment)}`)
  return confirm('update_manual_finding', `Eigenen Befund ändern (Lager «${facts.camp.title}»)`, details)
}

export const confirmDeleteManualFinding: McpConfirmBuilder = async (args, ctx) => {
  const item = await loadManual(ctx, reqStr(args, 'findingId'))
  const { facts } = await factsAndRedactor(ctx, item.campIri)
  return confirm('delete_manual_finding', `Eigenen Befund löschen (Lager «${facts.camp.title}»)`, [
    `Befund: ${CATEGORY_LABEL(item.category)}: ${item.comment}`,
    'Das Löschen kann in co-co nicht rückgängig gemacht werden',
  ])
}

/** Extra confirmation lines for add_feedback / update_feedback links. */
export async function feedbackLinkDetails(links: FeedbackLinks, campIri: Iri, ctx: McpContext): Promise<string[]> {
  const out: string[] = []
  if (links.documentId) {
    const d = (await mcpDocuments(ctx, campIri)).find((x) => x.id === links.documentId)
    out.push(`Dokument: ${d?.name ?? links.documentId}`)
  }
  if (links.generalPointId) out.push(`Allgemeiner Punkt: ${tr(generalPointById(links.generalPointId)?.titleKey ?? links.generalPointId)}`)
  if (links.manualFindingId) {
    const m = await ctx.getManualFinding(links.manualFindingId)
    out.push(`Eigener Befund: ${m ? m.comment : links.manualFindingId}`)
  }
  return out
}
