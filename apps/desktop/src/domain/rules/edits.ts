/**
 * Rule edits (ADR 0013): coach overrides of bundled rule metadata. Pure, no Dexie.
 *
 * Policy (on top of the engine's): `must` needs `confidence: verified`; edits with origin 'ai' or 'mcp'
 * may never set severity `must` nor confidence `verified` (only a manual edit can); predicates,
 * scope, inputs, params and keyword wiring are never editable.
 *
 * Patch semantics: scalar fields replace; `messageVariants` replaces per key (only existing keys);
 * `validFrom`/`validTo` null removes the bundled bound; `sources` and `tags` replace as a whole.
 */
import type { EditOrigin, RuleEditPatch, RuleEditRecord, RuleMeta, RulePack, SourceRef } from '../types'
import { CONFIDENCES_LIST, SEVERITIES_LIST, STATUSES_LIST } from './editsConst'
import { primarySource } from './lib/sources'
import { getSourceRegistry } from './packs/registry'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const PATCH_KEYS = ['title', 'description', 'message', 'messageVariants', 'severity', 'confidence', 'status', 'validFrom', 'validTo', 'sources', 'tags'] as const
const MAX = { title: 200, description: 2000, message: 1000, variant: 1000, quote: 1000, page: 60, tag: 60, tags: 20, sources: 12 }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** German validation errors; [] = ok. `knownSourceKeys` = effective registry keys. */
export function validateRuleEditPatch(
  meta: RuleMeta,
  patch: RuleEditPatch,
  origin: EditOrigin,
  knownSourceKeys: ReadonlySet<string>,
): string[] {
  const errors: string[] = []
  if (!isRecord(patch)) return ['Die Änderung ist kein Objekt.']
  const raw = patch as Record<string, unknown>
  for (const k of Object.keys(raw)) {
    if (!(PATCH_KEYS as readonly string[]).includes(k)) errors.push(`Das Feld «${k}» kann nicht geändert werden.`)
  }
  const text = (field: 'title' | 'description' | 'message', label: string) => {
    const v = raw[field]
    if (v === undefined) return
    if (typeof v !== 'string' || !v.trim()) errors.push(`${label} darf nicht leer sein.`)
    else if (v.length > MAX[field]) errors.push(`${label} ist zu lang (höchstens ${MAX[field]} Zeichen).`)
  }
  text('title', 'Der Titel')
  text('description', 'Die Beschreibung')
  text('message', 'Die Meldung')

  const known = new Set<string>(placeholders(meta.message))
  for (const v of Object.values(meta.messageVariants ?? {})) placeholders(v).forEach((p) => known.add(p))
  const checkPlaceholders = (label: string, v: string) => {
    for (const p of placeholders(v)) if (!known.has(p)) errors.push(`${label}: Der Platzhalter {${p}} gibt es in dieser Regel nicht.`)
  }
  if (typeof raw.message === 'string') checkPlaceholders('Meldung', raw.message)

  if (raw.messageVariants !== undefined) {
    if (!isRecord(raw.messageVariants)) errors.push('Meldungsvarianten müssen ein Objekt sein.')
    else {
      for (const [k, v] of Object.entries(raw.messageVariants)) {
        if (!meta.messageVariants || !(k in meta.messageVariants)) errors.push(`Die Meldungsvariante «${k}» gibt es in dieser Regel nicht.`)
        else if (typeof v !== 'string' || !v.trim()) errors.push(`Die Meldungsvariante «${k}» darf nicht leer sein.`)
        else if (v.length > MAX.variant) errors.push(`Die Meldungsvariante «${k}» ist zu lang.`)
        else checkPlaceholders(`Variante «${k}»`, v)
      }
    }
  }
  if (raw.severity !== undefined && !(SEVERITIES_LIST as readonly unknown[]).includes(raw.severity)) errors.push('Die Gewichtung ist ungültig (must, should oder hint).')
  if (raw.confidence !== undefined && !(CONFIDENCES_LIST as readonly unknown[]).includes(raw.confidence)) errors.push('Die Verlässlichkeit ist ungültig.')
  if (raw.status !== undefined && !(STATUSES_LIST as readonly unknown[]).includes(raw.status)) errors.push('Der Status ist ungültig (active oder retired).')
  for (const f of ['validFrom', 'validTo'] as const) {
    const v = raw[f]
    if (v !== undefined && v !== null && (typeof v !== 'string' || !DATE_RE.test(v))) errors.push(`${f === 'validFrom' ? 'Gültig ab' : 'Gültig bis'} muss ein Datum (JJJJ-MM-TT) sein.`)
  }
  if (raw.sources !== undefined) {
    if (!Array.isArray(raw.sources) || raw.sources.length === 0) errors.push('Mindestens eine Quelle ist nötig.')
    else if (raw.sources.length > MAX.sources) errors.push(`Höchstens ${MAX.sources} Quellen sind erlaubt.`)
    else {
      for (const s of raw.sources as unknown[]) {
        if (!isRecord(s) || typeof s.key !== 'string' || !s.key) errors.push('Eine Quelle hat keinen Schlüssel.')
        else {
          if (!knownSourceKeys.has(s.key)) errors.push(`Die Quelle «${s.key}» ist nicht in den Hilfsmitteln vorhanden.`)
          if (s.page !== undefined && (typeof s.page !== 'string' || s.page.length > MAX.page)) errors.push(`Quelle «${s.key}»: Seitenangabe ungültig.`)
          if (s.quote !== undefined && (typeof s.quote !== 'string' || s.quote.length > MAX.quote)) errors.push(`Quelle «${s.key}»: Zitat ungültig oder zu lang.`)
        }
      }
    }
  }
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || raw.tags.length > MAX.tags || raw.tags.some((t) => typeof t !== 'string' || !t.trim() || t.length > MAX.tag)) errors.push('Die Schlagwörter sind ungültig.')
  }

  // Origin policy: only a manual edit may raise a rule to `must` or claim `verified`.
  if (origin !== 'manual') {
    if (raw.severity === 'must') errors.push('Eine KI-/MCP-Änderung darf die Gewichtung nicht auf «muss» setzen.')
    if (raw.confidence === 'verified') errors.push('Eine KI-/MCP-Änderung darf die Verlässlichkeit nicht auf «geprüft» setzen.')
  }

  if (errors.length) return [...new Set(errors)]
  // Checks on the effective rule.
  const eff = applyRulePatch(meta, patch)
  if (eff.severity === 'must' && eff.confidence !== 'verified') errors.push('Die Gewichtung «muss» verlangt die Verlässlichkeit «geprüft».')
  if (eff.validFrom && eff.validTo && eff.validFrom > eff.validTo) errors.push('«Gültig ab» liegt nach «Gültig bis».')
  return errors
}

/** Rule meta with the patch applied (re-derives `source`, `group`). Does not validate. */
export function applyRulePatch(meta: RuleMeta, patch: RuleEditPatch): RuleMeta {
  const next: RuleMeta = { ...meta }
  if (patch.title !== undefined) next.title = patch.title
  if (patch.description !== undefined) next.description = patch.description
  if (patch.message !== undefined) next.message = patch.message
  if (patch.messageVariants !== undefined) next.messageVariants = { ...(meta.messageVariants ?? {}), ...patch.messageVariants }
  if (patch.severity !== undefined) next.severity = patch.severity
  if (patch.confidence !== undefined) next.confidence = patch.confidence
  if (patch.status !== undefined) next.status = patch.status
  if (patch.validFrom === null) delete next.validFrom
  else if (patch.validFrom !== undefined) next.validFrom = patch.validFrom
  if (patch.validTo === null) delete next.validTo
  else if (patch.validTo !== undefined) next.validTo = patch.validTo
  if (patch.tags !== undefined) next.tags = [...patch.tags]
  if (patch.sources !== undefined) {
    next.sources = patch.sources.map((s) => ({ ...s, page: s.page ?? '' }))
    const registry = getSourceRegistry()
    next.source = primarySource(next.sources.map((s) => registry.resolve(s)))
  }
  next.group = next.module
  return next
}

/** Packs with all valid edits applied; invalid edits are skipped and reported. Input packs untouched. */
export function applyRuleEdits(
  packs: readonly RulePack[],
  edits: readonly RuleEditRecord[],
  knownSourceKeys: ReadonlySet<string>,
): { packs: RulePack[]; errors: Array<{ ruleId: string; errors: string[] }> } {
  const errors: Array<{ ruleId: string; errors: string[] }> = []
  const byRule = new Map<string, RuleEditRecord>()
  for (const e of edits) byRule.set(e.ruleId, e)
  const handled = new Set<string>()
  const out = packs.map((pack) => ({
    ...pack,
    rules: pack.rules.map((rule) => {
      const edit = byRule.get(rule.meta.id)
      if (!edit) return rule
      handled.add(edit.ruleId)
      const errs = validateRuleEditPatch(rule.meta, edit.patch, edit.updatedBy, knownSourceKeys)
      if (errs.length) {
        errors.push({ ruleId: edit.ruleId, errors: errs })
        return rule
      }
      return { ...rule, meta: applyRulePatch(rule.meta, edit.patch) }
    }),
  }))
  for (const e of edits) if (!handled.has(e.ruleId)) errors.push({ ruleId: e.ruleId, errors: ['Die Regel gibt es nicht mehr.'] })
  return { packs: out, errors }
}

const sourceKey = (s: SourceRef) => JSON.stringify([s.key, s.page ?? '', s.quote ?? '', s.binding ?? null])

/** Minimal patch: only fields that differ from the bundled meta (used before saving). */
export function diffPatch(bundled: RuleMeta, patch: RuleEditPatch): RuleEditPatch {
  const out: RuleEditPatch = {}
  if (patch.title !== undefined && patch.title !== bundled.title) out.title = patch.title
  if (patch.description !== undefined && patch.description !== bundled.description) out.description = patch.description
  if (patch.message !== undefined && patch.message !== bundled.message) out.message = patch.message
  if (patch.severity !== undefined && patch.severity !== bundled.severity) out.severity = patch.severity
  if (patch.confidence !== undefined && patch.confidence !== bundled.confidence) out.confidence = patch.confidence
  if (patch.status !== undefined && patch.status !== bundled.status) out.status = patch.status
  for (const f of ['validFrom', 'validTo'] as const) {
    const v = patch[f]
    if (v === undefined) continue
    if (v === null ? bundled[f] !== undefined : v !== bundled[f]) out[f] = v
  }
  if (patch.messageVariants) {
    const changed: Record<string, string> = {}
    for (const [k, v] of Object.entries(patch.messageVariants)) if (bundled.messageVariants?.[k] !== v) changed[k] = v
    if (Object.keys(changed).length) out.messageVariants = changed
  }
  if (patch.sources && !same(patch.sources.map(sourceKey), bundled.sources.map(sourceKey))) out.sources = patch.sources.map((s) => ({ ...s, page: s.page ?? '' }))
  if (patch.tags && !same(patch.tags, bundled.tags ?? [])) out.tags = [...patch.tags]
  return out
}

/** Patch `next` on top of `base` (same result as applying both in sequence). */
export function mergePatches(base: RuleEditPatch, next: RuleEditPatch): RuleEditPatch {
  const merged: RuleEditPatch = { ...base, ...next }
  if (base.messageVariants || next.messageVariants) merged.messageVariants = { ...base.messageVariants, ...next.messageVariants }
  for (const k of Object.keys(merged) as Array<keyof RuleEditPatch>) if (merged[k] === undefined) delete merged[k]
  return merged
}

export type { SourceRef }
