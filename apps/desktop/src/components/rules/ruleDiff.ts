/** Pure helpers for the rule edit UI: field diff between two rule metas, form <-> patch conversion. */
import type { RuleEditPatch, RuleMeta, SourceRef } from '@/domain/types'

export type DiffField = 'title' | 'description' | 'message' | 'feedbackText' | 'variant' | 'severity' | 'confidence' | 'status' | 'validFrom' | 'validTo' | 'sources' | 'tags'

export interface FieldDiff {
  field: DiffField
  /** Variant name for field 'variant'. */
  name?: string
  before: string
  after: string
}

const srcText = (s: SourceRef) => `${s.key}${s.page ? `, ${s.page}` : ''}${s.quote ? ` «${s.quote}»` : ''}`

function show(meta: RuleMeta, field: Exclude<DiffField, 'variant'>): string {
  switch (field) {
    case 'sources':
      return meta.sources.map(srcText).join('\n')
    case 'tags':
      return (meta.tags ?? []).join(', ')
    case 'validFrom':
    case 'validTo':
      return meta[field] ?? ''
    default:
      return String(meta[field] ?? '')
  }
}

/** Differences between two metas (editable fields only). */
export function fieldDiffs(before: RuleMeta, after: RuleMeta): FieldDiff[] {
  const out: FieldDiff[] = []
  for (const field of ['title', 'description', 'message', 'feedbackText', 'severity', 'confidence', 'status', 'validFrom', 'validTo', 'sources', 'tags'] as const) {
    const b = show(before, field)
    const a = show(after, field)
    if (a !== b) out.push({ field, before: b, after: a })
  }
  const names = new Set([...Object.keys(before.messageVariants ?? {}), ...Object.keys(after.messageVariants ?? {})])
  for (const name of names) {
    const b = before.messageVariants?.[name] ?? ''
    const a = after.messageVariants?.[name] ?? ''
    if (a !== b) out.push({ field: 'variant', name, before: b, after: a })
  }
  return out
}

/** Editable state of the form. */
export interface RuleForm {
  title: string
  description: string
  message: string
  feedbackText: string
  variants: Record<string, string>
  severity: RuleMeta['severity']
  confidence: RuleMeta['confidence']
  status: RuleMeta['status']
  validFrom: string
  validTo: string
  sources: Array<{ key: string; page: string; quote: string }>
  tags: string[]
}

export function formOf(meta: RuleMeta): RuleForm {
  return {
    title: meta.title,
    description: meta.description,
    message: meta.message,
    feedbackText: meta.feedbackText ?? '',
    variants: { ...(meta.messageVariants ?? {}) },
    severity: meta.severity,
    confidence: meta.confidence,
    status: meta.status,
    validFrom: meta.validFrom ?? '',
    validTo: meta.validTo ?? '',
    sources: meta.sources.map((s) => ({ key: s.key, page: s.page ?? '', quote: s.quote ?? '' })),
    tags: [...(meta.tags ?? [])],
  }
}

/** Full desired state as a patch (the store reduces it to the differences from the bundled rule). */
export function patchOfForm(form: RuleForm, bundled: RuleMeta): RuleEditPatch {
  const keepBinding = new Map(bundled.sources.map((s) => [s.key, s.binding]))
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    message: form.message.trim(),
    feedbackText: form.feedbackText.trim() || null,
    messageVariants: Object.fromEntries(Object.entries(form.variants).map(([k, v]) => [k, v.trim()])),
    severity: form.severity,
    confidence: form.confidence,
    status: form.status,
    validFrom: form.validFrom.trim() || null,
    validTo: form.validTo.trim() || null,
    sources: form.sources
      .filter((s) => s.key)
      .map((s) => {
        const binding = keepBinding.get(s.key)
        return { key: s.key, page: s.page.trim(), ...(s.quote.trim() ? { quote: s.quote.trim() } : {}), ...(binding !== undefined ? { binding } : {}) }
      }),
    tags: form.tags.map((t) => t.trim()).filter(Boolean),
  }
}
