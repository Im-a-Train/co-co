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

/** Throws McpRefusedError for MiData/NDS markers (see the AI gateway), PII patterns or an oversized result. */
export function assertMcpSendable(serialized: string): void {
  if (serialized.length > MAX_MCP_RESULT_CHARS) throw new McpRefusedError('Das Ergebnis ist zu gross für MCP.')
  if (RED_DERIVED_MARKER.test(serialized)) throw new McpRefusedError('Rote Daten (MiData/NDS) dürfen nie an MCP-Clients gesendet werden.')
  if (LONG_TOKEN.test(serialized)) throw new McpRefusedError('Das Ergebnis enthält eine ungewöhnlich lange Zeichenfolge und wird nicht gesendet.')
  if (containsPii(serialized))
    throw new McpRefusedError('Das Ergebnis enthält noch personenbezogene Muster (E-Mail, Telefon, AHV) und wird nicht gesendet.')
}

/** The camp's redactor (collaborator names -> «Leiter A», …). */
export function redactorForFacts(facts: CampFacts): Redactor {
  return buildRedactor(facts.collaborators)
}
