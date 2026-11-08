/**
 * The ONLY module allowed to call the AI command (lib/tauriAi.ts -> Rust ai_complete).
 *
 * send() refuses when AI is disabled, any 'red' part, any 'yellow' part that is not `redacted: true`,
 * unconfirmed requests and oversized prompts. It writes an AiLogEntry (counts only, never text).
 */
import { aiComplete } from '@/lib/tauriAi'
import { containsPii } from './redact'
import { getDb } from '../storage/db'
import { getAppSettings } from '../storage/settings'
import type { AiFeature, AiModel, AiProvider, Iri, Zoned } from '../types'

export const MAX_PROMPT_CHARS = 24000
export const MAX_TOKENS_LIMIT = 4096
export const AI_MODELS: AiModel[] = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']

export interface AiGatewayRequest {
  feature: AiFeature
  campIri: Iri | null
  /** System prompt (green, written by co-co). */
  system: Zoned<string>
  /** Prompt parts, joined with blank lines. */
  parts: Zoned<string>[]
  maxTokens: number
  /** Overrides AppSettings.ai.model. */
  model?: AiModel
  /** Number of redactions applied (for the log). */
  redactions: number
  /** Must be true: the user saw the preview dialog and confirmed. */
  confirmed: boolean
}

export interface AiGatewayResponse {
  text: string
  /** AiModel (Anthropic) or the free model name (OpenAI-compatible). */
  model: string
  inputTokens: number
  outputTokens: number
}

export class AiRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiRefusedError'
  }
}

/** Marker of a serialized MiData/NDS aggregate (JSON, any whitespace). */
export const RED_DERIVED_MARKER = /"zone"\s*:\s*"red-derived"|Quelle:\s*(MiData|NDS)|"offerBusinessId"|"campBusinessId"|"redKeys"|"evaluatedFor"/

/** True when `v` (deep) carries the red-zone `__red` brand of the Personen types (ADR 0009). */
export function containsRedBrand(v: unknown, seen = new Set<object>()): boolean {
  if (typeof v !== 'object' || v === null) return false
  if (seen.has(v)) return false
  seen.add(v)
  if (Object.prototype.hasOwnProperty.call(v, '__red')) return true
  return Object.values(v).some((x) => containsRedBrand(x, seen))
}

/** Pure validation of zone rules; throws AiRefusedError. Exported for tests. */
export function assertSendable(request: AiGatewayRequest): void {
  if (containsRedBrand(request)) throw new AiRefusedError('Rote Daten dürfen nie an die KI gesendet werden.')
  if (!request.confirmed) throw new AiRefusedError('Die Vorschau wurde nicht bestätigt.')
  if (request.system.zone !== 'green') throw new AiRefusedError('Der System-Prompt muss grün sein.')
  for (const p of [request.system, ...request.parts]) {
    if (p.zone === 'red') throw new AiRefusedError('Rote Daten dürfen nie an die KI gesendet werden.')
    if (p.zone === 'yellow' && p.redacted !== true)
      throw new AiRefusedError('Gelbe Daten müssen vor dem Senden anonymisiert werden.')
  }
  // Defensive: a serialized MidataAggregate must never be sent, whatever zone a caller claims.
  for (const p of [request.system, ...request.parts]) {
    if (RED_DERIVED_MARKER.test(p.value)) throw new AiRefusedError('Rote Daten dürfen nie an die KI gesendet werden.')
  }
  for (const p of request.parts) {
    if (p.zone === 'yellow' && containsPii(p.value))
      throw new AiRefusedError('Der Text enthält noch personenbezogene Muster (E-Mail, Telefon, AHV).')
  }
  const size = request.system.value.length + request.parts.reduce((n, p) => n + p.value.length, 0)
  if (size > MAX_PROMPT_CHARS) throw new AiRefusedError('Der Text ist zu lang für die KI-Anfrage.')
  if (request.parts.length === 0 || request.parts.every((p) => !p.value.trim()))
    throw new AiRefusedError('Es gibt nichts zu senden.')
}

async function writeLog(request: AiGatewayRequest, provider: AiProvider, model: string, inT: number, outT: number, error: string | null) {
  try {
    await getDb().aiLog.add({
      at: new Date().toISOString(),
      feature: request.feature,
      model,
      provider,
      campIri: request.campIri,
      inputTokens: inT,
      outputTokens: outT,
      redactions: request.redactions,
      ok: error === null,
      error,
    })
  } catch {
    // logging must never break the flow
  }
}

export async function send(request: AiGatewayRequest): Promise<AiGatewayResponse> {
  const settings = await getAppSettings()
  if (!settings.ai.enabled) throw new AiRefusedError('KI ist in den Einstellungen deaktiviert.')
  const provider: AiProvider = settings.ai.provider ?? 'anthropic'
  let model: string
  let baseUrl: string | undefined
  if (provider === 'openai') {
    model = settings.ai.openai?.model?.trim() ?? ''
    if (!model) throw new AiRefusedError('Für den OpenAI-kompatiblen Anbieter ist kein Modell eingestellt.')
    baseUrl = settings.ai.openai?.baseUrl?.trim() ?? ''
    if (!baseUrl) throw new AiRefusedError('Für den OpenAI-kompatiblen Anbieter ist keine Basis-URL eingestellt.')
  } else {
    const anthropicModel = request.model ?? settings.ai.model
    if (!AI_MODELS.includes(anthropicModel)) throw new AiRefusedError('Unbekanntes KI-Modell.')
    model = anthropicModel
  }
  assertSendable(request)
  const maxTokens = Math.min(Math.max(1, Math.floor(request.maxTokens)), MAX_TOKENS_LIMIT)
  try {
    const prompt = request.parts.map((p) => p.value).join('\n\n')
    const system = request.system.value
    const res = await aiComplete(
      provider === 'openai' ? { provider, baseUrl, model, system, prompt, maxTokens } : { model, system, prompt, maxTokens },
    )
    await writeLog(request, provider, model, res.inputTokens, res.outputTokens, null)
    return { text: res.text, model, inputTokens: res.inputTokens, outputTokens: res.outputTokens }
  } catch (e) {
    await writeLog(request, provider, model, 0, 0, e instanceof Error ? e.message : String(e))
    throw e
  }
}
