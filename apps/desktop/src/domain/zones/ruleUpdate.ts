/**
 * AI feature «Regel mit KI aktualisieren» (ADR 0013). Rules and Hilfsmittel are public reference material
 * (zone green): the request contains no camp data, so no redaction is needed. The coach still sees the
 * exact prompt and confirms before it is sent (the gateway demands `confirmed`), and the result is only a
 * proposal: it is validated with origin 'ai' (never `must`, never `verified`) and applied only by the coach.
 *
 * Response format (JSON object, nothing else):
 *   { "patch": { <RuleEditPatch fields> }, "reason": "<kurze Begründung>", "resourceKeys": ["<KEY>", ...] }
 * `patch` = {} means «keine Änderung nötig».
 */
import { applyRulePatch, diffPatch, validateRuleEditPatch } from '../rules/edits'
import { searchResources } from '../resources'
import type { EditOrigin, ResourceRecord, RuleEditPatch, RuleMeta } from '../types'
import { MAX_PROMPT_CHARS, send, type AiGatewayRequest } from './aiGateway'
import { green } from './index'

export const RULE_UPDATE_SYSTEM = `Du hilfst einem J+S-/PBS-Coach, eine Regel seines Regelbuchs an aktualisierte Hilfsmittel (Handbücher, Merkblätter) anzupassen.
Du erhältst die Regel (Metadaten) und Auszüge aus Hilfsmitteln. Prüfe, ob die Regel (Titel, Beschreibung, Meldung, Meldungsvarianten, Gewichtung, Gültigkeit, Quellen) noch zu den Hilfsmitteln passt.
Ändere nur, was die Auszüge klar belegen. Erfinde nichts. Behalte Platzhalter wie {days} unverändert bei und verwende keine neuen. Schweizer Rechtschreibung (ss statt ß).
Antworte AUSSCHLIESSLICH mit einem JSON-Objekt:
{"patch": {...}, "reason": "kurze Begründung auf Deutsch mit Fundstelle", "resourceKeys": ["SCHLÜSSEL"]}
Erlaubte Felder in "patch": title, description, message, messageVariants (nur bestehende Schlüssel), severity (should oder hint), confidence (heuristic, best-practice oder unverified), status (active oder retired), validFrom, validTo (JJJJ-MM-TT oder null), sources (Liste von {"key","page","quote"}, key nur aus den mitgelieferten Hilfsmitteln oder den bisherigen Quellen), tags.
Setze weder severity "must" noch confidence "verified": das entscheidet nur der Coach. Nimm in "patch" nur geänderte Felder auf. Wenn nichts zu ändern ist, antworte {"patch": {}, "reason": "...", "resourceKeys": []}.`

/** Budget (characters) of all resource excerpts together; the rest of MAX_PROMPT_CHARS is system + rule. */
export const RULE_UPDATE_EXCERPT_BUDGET = 13000
const PER_RESOURCE_MAX = 6000
const STOP = new Set(['dass', 'eine', 'einen', 'einer', 'nicht', 'oder', 'sind', 'wird', 'werden', 'nach', 'über', 'sich', 'auch', 'ohne', 'ihre', 'dies', 'diese', 'dieser', 'wenn', 'muss', 'mindestens'])

function terms(meta: RuleMeta): string[] {
  const words = `${meta.title} ${meta.description} ${(meta.tags ?? []).join(' ')}`
    .toLowerCase()
    .split(/[^a-zäöüéèàß0-9+]+/)
    .filter((w) => w.length >= 5 && !STOP.has(w))
  return [...new Set(words)]
}

/** Paragraphs of the resource ordered by relevance to the rule (keywords of title/description), cut to `max` chars. */
export function excerptOf(content: string, meta: RuleMeta, max: number): string {
  const text = content.trim()
  if (text.length <= max) return text
  const ts = terms(meta)
  const paragraphs = text.split(/\n{2,}|\r\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const scored = paragraphs.map((p, i) => {
    const low = p.toLowerCase()
    return { p, i, score: ts.reduce((n, w) => n + (low.includes(w) ? 1 : 0), 0) }
  })
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  const picked: typeof scored = []
  let used = 0
  for (const s of scored) {
    if (s.score === 0 && picked.length) break
    const piece = s.p.length > 1200 ? `${s.p.slice(0, 1200)} …` : s.p
    if (used + piece.length + 2 > max) continue
    picked.push({ ...s, p: piece })
    used += piece.length + 2
  }
  picked.sort((a, b) => a.i - b.i)
  return picked.map((s) => s.p).join('\n\n') || text.slice(0, max)
}

const q = (s: string) => JSON.stringify(s)

/** YAML-ish rendering of the editable part of a rule (no predicate, no camp data). */
export function ruleToPromptText(meta: RuleMeta): string {
  const lines = [
    `id: ${meta.id}`,
    `title: ${q(meta.title)}`,
    `description: ${q(meta.description)}`,
    `message: ${q(meta.message)}`,
  ]
  if (meta.messageVariants && Object.keys(meta.messageVariants).length) {
    lines.push('messageVariants:')
    for (const [k, v] of Object.entries(meta.messageVariants)) lines.push(`  ${k}: ${q(v)}`)
  }
  lines.push(`severity: ${meta.severity}`, `confidence: ${meta.confidence}`, `status: ${meta.status}`)
  if (meta.validFrom) lines.push(`validFrom: ${meta.validFrom}`)
  if (meta.validTo) lines.push(`validTo: ${meta.validTo}`)
  lines.push('sources:')
  for (const s of meta.sources) lines.push(`  - { key: ${s.key}, page: ${q(s.page ?? '')}${s.quote ? `, quote: ${q(s.quote)}` : ''} }`)
  if (meta.tags?.length) lines.push(`tags: [${meta.tags.map(q).join(', ')}]`)
  return lines.join('\n')
}

export interface RuleUpdatePreview {
  request: AiGatewayRequest
  /** Exactly what will be sent. */
  previewText: string
  /** Resources that contributed an excerpt. */
  usedKeys: string[]
}

/** Builds the request (confirmed: false) from the rule and the chosen resources (only those with content are used). */
export function buildRuleUpdateRequest(meta: RuleMeta, resources: readonly ResourceRecord[]): RuleUpdatePreview {
  const withContent = resources.filter((r) => (r.content ?? '').trim())
  if (!withContent.length) throw new Error('Wähle mindestens ein Hilfsmittel mit Text.')
  const perResource = Math.min(PER_RESOURCE_MAX, Math.floor(RULE_UPDATE_EXCERPT_BUDGET / withContent.length))
  const hintQuery = meta.title
  const hits = searchResources(withContent, hintQuery)
  const parts = [{ ...green(`Regel:\n${ruleToPromptText(meta)}`) }]
  const used: string[] = []
  for (const r of withContent) {
    const hint = hits.find((h) => h.key === r.key && h.in === 'content')
    const body = excerptOf(r.content ?? '', meta, perResource)
    parts.push(
      green(
        `Hilfsmittel ${r.key} – ${r.title}${r.edition ? ` (${r.edition})` : ''}:${hint ? `\nFundstelle zum Titel: ${hint.snippet}` : ''}\n${body}`,
      ),
    )
    used.push(r.key)
  }
  const request: AiGatewayRequest = {
    feature: 'ruleUpdate',
    campIri: null,
    system: green(RULE_UPDATE_SYSTEM),
    parts,
    maxTokens: 1500,
    redactions: 0,
    confirmed: false,
  }
  const size = request.system.value.length + parts.reduce((n, p) => n + p.value.length, 0)
  if (size > MAX_PROMPT_CHARS) throw new Error('Die Auszüge sind zu lang für die KI-Anfrage. Wähle weniger Hilfsmittel.')
  return { request, previewText: `${RULE_UPDATE_SYSTEM}\n\n---\n\n${parts.map((p) => p.value).join('\n\n')}`, usedKeys: used }
}

export interface RuleUpdateProposal {
  /** Minimal patch vs. the bundled rule; {} = no change proposed. */
  patch: RuleEditPatch
  reason: string
  resourceKeys: string[]
  /** German policy/validation errors (the proposal must not be applied while non-empty). */
  errors: string[]
  /** Rule as it would be after the proposal (for the diff view); null when there are errors. */
  result: RuleMeta | null
}

/** First balanced JSON object in model output (fences / prose tolerated); null if none parses. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const stripped = text.replace(/```(?:json)?/gi, '')
  for (let start = stripped.indexOf('{'); start >= 0; start = stripped.indexOf('{', start + 1)) {
    let depth = 0
    let inStr = false
    for (let i = start; i < stripped.length; i++) {
      const c = stripped[i]
      if (inStr) {
        if (c === '\\') i++
        else if (c === '"') inStr = false
      } else if (c === '"') inStr = true
      else if (c === '{') depth++
      else if (c === '}' && --depth === 0) {
        try {
          const v: unknown = JSON.parse(stripped.slice(start, i + 1))
          if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>
        } catch {
          // try the next candidate
        }
        break
      }
    }
  }
  return null
}

/**
 * Pure: parses + validates the model answer against `meta` (the rule as currently effective) with
 * origin 'ai'. The patch is reduced to real differences. Never throws.
 */
export function parseRuleUpdate(
  text: string,
  meta: RuleMeta,
  knownSourceKeys: ReadonlySet<string>,
  allowedResourceKeys: readonly string[] = [],
  origin: EditOrigin = 'ai',
): RuleUpdateProposal {
  const obj = extractJsonObject(text)
  if (!obj) return { patch: {}, reason: '', resourceKeys: [], errors: ['Die Antwort der KI war kein gültiges JSON.'], result: null }
  const rawPatch = obj.patch
  const reason = typeof obj.reason === 'string' ? obj.reason.trim().slice(0, 600) : ''
  const resourceKeys = Array.isArray(obj.resourceKeys) ? obj.resourceKeys.filter((k): k is string => typeof k === 'string' && (!allowedResourceKeys.length || allowedResourceKeys.includes(k))).slice(0, 10) : []
  if (typeof rawPatch !== 'object' || rawPatch === null || Array.isArray(rawPatch)) {
    return { patch: {}, reason, resourceKeys, errors: ['Die Antwort der KI enthält keinen «patch».'], result: null }
  }
  const errors = validateRuleEditPatch(meta, rawPatch as RuleEditPatch, origin, knownSourceKeys)
  if (errors.length) return { patch: {}, reason, resourceKeys, errors, result: null }
  const patch = diffPatch(meta, rawPatch as RuleEditPatch)
  return { patch, reason, resourceKeys, errors: [], result: applyRulePatch(meta, patch) }
}

/** Sends a confirmed request; returns the raw model text. The caller parses with parseRuleUpdate(). */
export async function runRuleUpdate(preview: RuleUpdatePreview): Promise<string> {
  const res = await send({ ...preview.request, confirmed: true })
  return res.text.trim()
}
