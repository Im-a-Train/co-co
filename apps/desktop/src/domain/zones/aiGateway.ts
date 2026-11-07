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
import type { AiFeature, AiModel, Iri, Zoned } from '../types'

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
  model: AiModel
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
const RED_DERIVED_MARKER = /"zone"\s*:\s*"red-derived"|Quelle:\s*(MiData|NDS)|"offerBusinessId"|"campBusinessId"/

/** Pure validation of zone rules; throws AiRefusedError. Exported for tests. */
export function assertSendable(request: AiGatewayRequest): void {
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

async function writeLog(request: AiGatewayRequest, model: AiModel, inT: number, outT: number, error: string | null) {
  try {
    await getDb().aiLog.add({
      at: new Date().toISOString(),
      feature: request.feature,
      model,
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
  const model = request.model ?? settings.ai.model
  if (!AI_MODELS.includes(model)) throw new AiRefusedError('Unbekanntes KI-Modell.')
  assertSendable(request)
  const maxTokens = Math.min(Math.max(1, Math.floor(request.maxTokens)), MAX_TOKENS_LIMIT)
  try {
    const res = await aiComplete({
      model,
      system: request.system.value,
      prompt: request.parts.map((p) => p.value).join('\n\n'),
      maxTokens,
    })
    await writeLog(request, model, res.inputTokens, res.outputTokens, null)
    return { text: res.text, model, inputTokens: res.inputTokens, outputTokens: res.outputTokens }
  } catch (e) {
    await writeLog(request, model, 0, 0, e instanceof Error ? e.message : String(e))
    throw e
  }
}
