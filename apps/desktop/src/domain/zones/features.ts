/**
 * AI features (M5). Each feature builds a request (preview first), then calls send().
 * Two-step API so the UI can show the exact payload before anything leaves the device.
 */
import type { ActivityFact, CampFacts, DocumentRecord, FeedbackItem, Finding, Severity } from '../types'
import { send, type AiGatewayRequest } from './aiGateway'
import { REPHRASE_SYSTEM, SAFETY_SYSTEM, SUMMARY_SYSTEM } from './prompts'
import { buildRedactor, type Redactor } from './redact'

export interface AiPreview {
  request: AiGatewayRequest
  /** Exactly what will be sent (system + parts, after redaction). */
  previewText: string
  /** Number of replacements made by redaction. */
  redactionCount: number
  /** Restores real names in results (local display only). */
  deredact: (text: string) => string
}

const DOC_MAX_CHARS = 12000
const KIND_LABEL: Record<FeedbackItem['kind'], string> = {
  kudos: 'Lob',
  must: 'Auflage (muss)',
  suggestion: 'Anregung',
  question: 'Frage',
}

function redactor(facts: CampFacts | null): Redactor {
  return buildRedactor(facts?.collaborators ?? [])
}

function build(
  base: Pick<AiGatewayRequest, 'feature' | 'campIri' | 'maxTokens'>,
  system: string,
  parts: { label: string; text: string; zone: 'green' | 'yellow' }[],
  r: Redactor,
): AiPreview {
  let count = 0
  const out = parts.map((p) => {
    const z = r.redactZoned({ zone: p.zone, value: p.text })
    count += z.redactions.length
    return { zone: z.zone, value: `${p.label}\n${z.value}`, redacted: z.redacted } as AiGatewayRequest['parts'][number]
  })
  const request: AiGatewayRequest = {
    ...base,
    system: { zone: 'green', value: system },
    parts: out,
    redactions: count,
    confirmed: false,
  }
  return {
    request,
    previewText: `${system}\n\n---\n\n${out.map((p) => p.value).join('\n\n')}`,
    redactionCount: count,
    deredact: (t) => r.deredact(t),
  }
}

async function run(preview: AiPreview): Promise<string> {
  const res = await send({ ...preview.request, confirmed: true })
  return res.text.trim()
}

/** Rephrase in Feedback-Kultur tone. Returns the preview; call runRephrase(preview) after confirmation. */
export function rephraseFeedback(item: FeedbackItem, facts: CampFacts): AiPreview {
  if (item.redDerived || /Quelle:\s*(MiData|NDS)/.test(item.text))
    throw new Error('Dieser Text enthält MiData-/NDS-Angaben (rote Zone) und darf nicht an die KI gesendet werden.')
  const activity = item.activityIri ? facts.activities.find((a) => a.iri === item.activityIri) : undefined
  const parts = [
    { label: `Art: ${KIND_LABEL[item.kind]}`, text: '', zone: 'green' as const },
    ...(activity ? [{ label: 'Aktivität:', text: activity.title, zone: 'yellow' as const }] : []),
    { label: 'Text:', text: item.text, zone: 'yellow' as const },
  ]
  return build({ feature: 'rephrase', campIri: item.campIri, maxTokens: 700 }, REPHRASE_SYSTEM, parts, redactor(facts))
}

export async function runRephrase(preview: AiPreview): Promise<string> {
  return preview.deredact(await run(preview))
}

/** Only if doc.aiAllowed; throws otherwise. */
export function summariseDocument(doc: DocumentRecord, facts: CampFacts): AiPreview {
  if (!doc.aiAllowed || doc.zone === 'red') throw new Error('Für dieses Dokument ist die KI-Nutzung nicht erlaubt.')
  if (!doc.text.trim()) throw new Error('Das Dokument enthält keinen Text.')
  const text = doc.text.length > DOC_MAX_CHARS ? doc.text.slice(0, DOC_MAX_CHARS) + ' [gekürzt]' : doc.text
  return build(
    { feature: 'summarise', campIri: doc.campIri, maxTokens: 800 },
    SUMMARY_SYSTEM,
    [{ label: 'Dokument:', text, zone: 'yellow' }],
    redactor(facts),
  )
}

export async function runSummary(preview: AiPreview): Promise<string> {
  return preview.deredact(await run(preview))
}

/** Soft review of an activity's safety considerations. */
export function reviewActivitySafety(activity: ActivityFact, facts: CampFacts): AiPreview {
  const c = activity.content
  const parts = [
    { label: 'Aktivität:', text: activity.title, zone: 'yellow' as const },
    ...(activity.location ? [{ label: 'Ort:', text: activity.location, zone: 'yellow' as const }] : []),
    { label: 'Programm:', text: c.storyboardText.slice(0, 3000) || '(leer)', zone: 'yellow' as const },
    { label: 'Sicherheitsüberlegungen:', text: c.safetyText.slice(0, 4000) || '(leer)', zone: 'yellow' as const },
    {
      label: `Verantwortliche: ${activity.responsibleIris.length}`,
      text: '',
      zone: 'green' as const,
    },
  ]
  return build({ feature: 'safetyReview', campIri: facts.camp.iri, maxTokens: 900 }, SAFETY_SYSTEM, parts, redactor(facts))
}

/** Findings with origin 'ai', tags ['KI-Einschätzung'], severity never 'must', confidence 'heuristic'. */
export async function runSafetyReview(preview: AiPreview, activity: ActivityFact): Promise<Finding[]> {
  const text = await run(preview)
  return parseSafetyFindings(preview.deredact(text), activity)
}

/** Defensive extraction of a JSON array from model output (fences, prose around it). */
export function extractJsonArray(text: string): unknown[] {
  const stripped = text.replace(/```(?:json)?/gi, '')
  const start = stripped.indexOf('[')
  const end = stripped.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  try {
    const v: unknown = JSON.parse(stripped.slice(start, end + 1))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function parseSafetyFindings(text: string, activity: ActivityFact): Finding[] {
  const seen = new Set<string>()
  const findings: Finding[] = []
  for (const raw of extractJsonArray(text)) {
    if (typeof raw !== 'object' || raw === null) continue
    const o = raw as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim().slice(0, 120) : ''
    const message = typeof o.message === 'string' ? o.message.trim().slice(0, 600) : ''
    if (!title && !message) continue
    const key = `${title}|${message}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    // never 'must': anything but an explicit 'should' becomes 'hint'
    const severity: Severity = o.severity === 'should' ? 'should' : 'hint'
    findings.push({
      id: `AI-SAFETY-01:${activity.iri}:${findings.length}`,
      ruleId: 'AI-SAFETY-01',
      ruleVersion: '1',
      packId: null,
      severity,
      confidence: 'heuristic',
      title: title || message.slice(0, 80),
      message: message || title,
      scope: 'activity',
      targets: [activity.iri],
      evidence: [{ kind: 'activity', iri: activity.iri, label: activity.title }],
      source: null,
      origin: 'ai',
      tags: ['KI-Einschätzung'],
      override: null,
    })
    if (findings.length >= 5) break
  }
  return findings
}
