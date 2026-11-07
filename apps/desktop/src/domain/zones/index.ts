/**
 * Data zones (ADR 0005) + optional AI (M5).
 * Only ./aiGateway.ts may import '@/lib/tauriAi' (enforced by src/__tests__/contracts/aiGuard.test.ts).
 */
import type { Zone, Zoned } from '../types'

export function zoned<T>(zone: Zone, value: T): Zoned<T> {
  return { zone, value }
}

export const green = <T>(value: T): Zoned<T> => zoned('green', value)
export const yellow = <T>(value: T): Zoned<T> => zoned('yellow', value)
export const red = <T>(value: T): Zoned<T> => zoned('red', value)

export { buildRedactor, type Redactor, type Redaction, type RedactionResult } from './redact'
export { send, type AiGatewayRequest, type AiGatewayResponse } from './aiGateway'
export { rephraseFeedback, summariseDocument, reviewActivitySafety } from './features'
export { parseSafetyFindings, extractJsonArray, runRephrase, runSummary, runSafetyReview, type AiPreview } from './features'
export { AiRefusedError, assertSendable, MAX_PROMPT_CHARS } from './aiGateway'
