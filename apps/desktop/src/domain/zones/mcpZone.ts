/**
 * Last line of defence for MCP tool results (ADR 0012): an MCP client is an external AI, so every
 * serialized result goes through assertMcpSendable() before it leaves co-co. Pure.
 */
import type { CampFacts } from '../types'
import { RED_DERIVED_MARKER } from './aiGateway'
import { buildRedactor, containsPii, type Redactor } from './redact'

export const MAX_MCP_RESULT_CHARS = 200_000

export class McpRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpRefusedError'
  }
}

/** Longer unbroken runs make the PII regexes quadratic; real tool results never contain them. */
const LONG_TOKEN = /[\p{L}\p{N}._%+-]{2000,}/u

/**
 * Technical ids that can look like phone numbers to the PII regex (hyphen is a phone separator):
 * UUIDs (co-co ids) and hex ids with at least one letter (eCamp ids, also inside IRIs). Phone numbers
 * never contain letters, so masking these cannot hide real PII.
 */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const HEX_ID = /\b(?=[0-9a-f]*[a-f])[0-9a-f]{8,32}\b/gi

/** The text the PII check sees: technical ids replaced by a neutral token. Exported for tests. */
export function maskTechnicalIds(serialized: string): string {
  return serialized.replace(UUID, 'ID').replace(HEX_ID, 'ID')
}

/** Throws McpRefusedError for MiData/NDS markers (see the AI gateway), PII patterns or an oversized result. */
export function assertMcpSendable(serialized: string): void {
  if (serialized.length > MAX_MCP_RESULT_CHARS) throw new McpRefusedError('Das Ergebnis ist zu gross für MCP.')
  if (RED_DERIVED_MARKER.test(serialized)) throw new McpRefusedError('Rote Daten (MiData/NDS) dürfen nie an MCP-Clients gesendet werden.')
  if (LONG_TOKEN.test(serialized)) throw new McpRefusedError('Das Ergebnis enthält eine ungewöhnlich lange Zeichenfolge und wird nicht gesendet.')
  if (containsPii(maskTechnicalIds(serialized)))
    throw new McpRefusedError('Das Ergebnis enthält noch personenbezogene Muster (E-Mail, Telefon, AHV) und wird nicht gesendet.')
}

/** The camp's redactor (collaborator names -> «Leiter A», …). */
export function redactorForFacts(facts: CampFacts): Redactor {
  return buildRedactor(facts.collaborators)
}
