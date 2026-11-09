/**
 * Manual findings (ADR 0014): pure helpers. A coach writes a finding (category + comment) on the camp, an
 * activity or a document; it is stored in `manualFindings` and shown next to rule/AI findings as a regular
 * `Finding` with origin 'manual'. Coach findings are human judgement: they never carry a rule source.
 */
import type {
  CampFacts,
  DocumentAnchor,
  FeedbackKind,
  Finding,
  Iri,
  IsoDateTime,
  ManualFinding,
  ManualFindingCategory,
  Severity,
} from '../types'
import { MANUAL_FINDING_CATEGORIES } from '../types'

export const MANUAL_ID_PREFIX = 'manual:'
/** Pseudo rule id of all manual findings (Finding.ruleId); the category is in the tags. */
export const MANUAL_RULE_ID = 'MANUAL'
/** Max length of a manual comment (fits one eCamp comment). */
export const MANUAL_COMMENT_MAX = 1000

export function isManualFindingId(id: string): boolean {
  return id.startsWith(MANUAL_ID_PREFIX)
}

export function isManualCategory(v: unknown): v is ManualFindingCategory {
  return typeof v === 'string' && (MANUAL_FINDING_CATEGORIES as readonly string[]).includes(v)
}

/** Feedback kind a manual finding becomes when it is refined into feedback. */
export function feedbackKindOf(category: ManualFindingCategory): FeedbackKind {
  if (category === 'positive') return 'kudos'
  if (category === 'question') return 'question'
  return 'suggestion'
}

/** Severity shown in the findings list: praise, questions and "other" are hints, everything else 'should'. */
export function severityOf(category: ManualFindingCategory): Severity {
  return category === 'positive' || category === 'question' || category === 'other' ? 'hint' : 'should'
}

export interface NewManualFindingInput {
  campIri: Iri
  scope: ManualFinding['scope']
  activityIri?: Iri
  documentId?: string
  anchor?: DocumentAnchor
  category: ManualFindingCategory
  comment: string
}

/** Validates the input and builds a new record. Throws a German message on invalid input. */
export function newManualFinding(input: NewManualFindingInput, uuid: string, now: IsoDateTime): ManualFinding {
  const comment = input.comment.trim()
  if (!comment) throw new Error('Kommentar fehlt')
  if (comment.length > MANUAL_COMMENT_MAX) throw new Error(`Kommentar ist länger als ${MANUAL_COMMENT_MAX} Zeichen`)
  if (!isManualCategory(input.category)) throw new Error('Unbekannte Kategorie')
  if (input.scope === 'activity' && !input.activityIri) throw new Error('Aktivität fehlt')
  if (input.scope === 'document' && !input.documentId) throw new Error('Dokument fehlt')
  const rec: ManualFinding = {
    id: `${MANUAL_ID_PREFIX}${uuid}`,
    campIri: input.campIri,
    scope: input.scope,
    category: input.category,
    comment,
    createdAt: now,
    updatedAt: now,
  }
  if (input.activityIri) rec.activityIri = input.activityIri
  if (input.documentId) rec.documentId = input.documentId
  if (input.anchor && Object.keys(input.anchor).length) rec.anchor = { ...input.anchor }
  return rec
}

/** Short German anchor label ("S. 3", "Budget, B4", "km 4.2"); null when there is no anchor. */
export function anchorLabel(anchor: DocumentAnchor | undefined): string | null {
  if (!anchor) return null
  const parts: string[] = []
  if (anchor.page != null) parts.push(`S. ${anchor.page}`)
  if (anchor.sheet) parts.push(anchor.cell ? `${anchor.sheet}, ${anchor.cell}` : anchor.sheet)
  else if (anchor.cell) parts.push(anchor.cell)
  if (anchor.km != null) parts.push(`km ${anchor.km.toFixed(1)}`)
  if (anchor.label) parts.push(anchor.label)
  return parts.length ? parts.join(' · ') : null
}

export interface ManualFindingContext {
  facts: CampFacts | null
  /** Document id -> file name (for labels); optional. */
  documentNames?: Record<string, string>
  /** German category labels (i18n `findings.manual.category.<category>`). */
  categoryLabel: (c: ManualFindingCategory) => string
}

/** Maps a stored manual finding to a regular Finding (origin 'manual', id = record id). */
export function manualToFinding(mf: ManualFinding, ctx: ManualFindingContext): Finding {
  const evidence: Finding['evidence'] = []
  const targets: string[] = []
  let scope: Finding['scope'] = 'camp'
  if (mf.scope === 'activity' && mf.activityIri) {
    scope = 'activity'
    targets.push(mf.activityIri)
    const act = ctx.facts?.activities.find((a) => a.iri === mf.activityIri)
    evidence.push({ kind: 'activity', iri: mf.activityIri, label: act?.title ?? mf.activityIri })
  } else if (mf.scope === 'document' && mf.documentId) {
    scope = 'document'
    targets.push(mf.documentId)
    const name = ctx.documentNames?.[mf.documentId] ?? mf.documentId
    const where = anchorLabel(mf.anchor)
    evidence.push({
      kind: 'document',
      documentId: mf.documentId,
      label: where ? `${name} (${where})` : name,
      ...(mf.anchor ? { anchor: mf.anchor } : {}),
    })
  } else {
    targets.push(mf.campIri)
  }
  return {
    id: mf.id,
    ruleId: MANUAL_RULE_ID,
    ruleVersion: '1',
    packId: null,
    module: null,
    severity: severityOf(mf.category),
    confidence: 'verified',
    title: ctx.categoryLabel(mf.category),
    message: mf.comment,
    scope,
    targets,
    evidence,
    source: null,
    origin: 'manual',
    tags: ['Coach', `kategorie:${mf.category}`],
    override: null,
  }
}
