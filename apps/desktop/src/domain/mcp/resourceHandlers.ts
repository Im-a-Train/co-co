/**
 * MCP tools for the «Hilfsmittel» (resources) and rule edits (ADR 0012/0013).
 *
 * Zone: resources are public J+S / PBS reference material and rules are co-co data (green), so no camp
 * redactor is involved. Text that came from a document is still scrubbed of e-mail / phone / AHV patterns
 * (contact lines in manuals) so the dispatcher's assertMcpSendable() never refuses a whole result.
 */
import { RED_DERIVED_MARKER } from '../zones/aiGateway'
import { AHV, EMAIL, PHONE } from '../zones/redact'
import { searchResources } from '../resources'
import type { ResourcePatch } from '../resources'
import type { Confidence, ResourceRecord, RuleEditPatch, RuleMeta, RuleStatus, Severity, SourceRef } from '../types'
import { McpToolError, type McpConfirmBuilder, type McpConfirmRequest, type McpContext, type McpHandler } from './types'

export const RESOURCE_PAGE_MAX = 20_000
const SEARCH_DEFAULT = 8
const SEARCH_MAX = 20
const LONG_RUN = /[\p{L}\p{N}._%+-]{1500,}/gu

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' ? v : undefined
}
function reqStr(args: Record<string, unknown>, key: string): string {
  const v = str(args, key)
  if (v === undefined) throw new McpToolError(`Argument «${key}» fehlt.`)
  return v
}
function int(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key]
  return typeof v === 'number' && Number.isInteger(v) ? v : fallback
}

/** Removes contact patterns and absurdly long unbroken runs from document text. */
export function scrubResourceText(text: string): string {
  return text
    .replace(EMAIL, '[E-Mail entfernt]')
    .replace(AHV, '[Nummer entfernt]')
    .replace(PHONE, '[Telefon entfernt]')
    .replace(LONG_RUN, '[…]')
}

function citingRuleIds(ctx: McpContext, key: string): string[] {
  return ctx
    .rulePacks()
    .flatMap((p) => p.rules)
    .filter((r) => r.meta.sources.some((s) => s.key === key))
    .map((r) => r.meta.id)
}

function metaView(rec: ResourceRecord) {
  return {
    key: rec.key,
    title: rec.title,
    publisher: rec.publisher ?? null,
    edition: rec.edition,
    date: rec.date ?? null,
    url: rec.url,
    weight: rec.weight,
    origin: rec.origin,
    modified: rec.modified,
    updatedAt: rec.updatedAt,
    updatedBy: rec.updatedBy,
    hasContent: !!rec.content,
    contentLength: rec.content?.length ?? 0,
  }
}

// ---- read ---------------------------------------------------------------------------------------

export const list_resources: McpHandler = async (_args, ctx) => {
  const all = await ctx.listResources()
  return all.map((rec) => ({ ...metaView(rec), citedByRules: citingRuleIds(ctx, rec.key) }))
}

export const search_resources: McpHandler = async (args, ctx) => {
  const query = reqStr(args, 'query').trim()
  if (!query) throw new McpToolError('Die Suchanfrage ist leer.')
  const limit = Math.min(Math.max(int(args, 'limit', SEARCH_DEFAULT), 1), SEARCH_MAX)
  const hits = searchResources(await ctx.listResources(), query, { limit })
  return hits.slice(0, limit).map((h) => ({
    key: h.key,
    title: h.title,
    url: h.url,
    snippet: scrubResourceText(h.snippet),
    score: h.score,
    matchedIn: h.in,
  }))
}

export const get_resource: McpHandler = async (args, ctx) => {
  const key = reqStr(args, 'key')
  const rec = await ctx.getResource(key)
  if (!rec) throw new McpToolError(`Hilfsmittel «${key}» nicht gefunden.`)
  const content = scrubResourceText(rec.content ?? '')
  const offset = Math.max(0, int(args, 'offset', 0))
  const length = Math.min(Math.max(int(args, 'length', RESOURCE_PAGE_MAX), 1), RESOURCE_PAGE_MAX)
  const slice = content.slice(offset, offset + length)
  const end = offset + slice.length
  return {
    ...metaView(rec),
    summary: rec.summary ? scrubResourceText(rec.summary) : null,
    notes: rec.notes ? scrubResourceText(rec.notes) : null,
    citedByRules: citingRuleIds(ctx, rec.key),
    content: slice,
    offset,
    totalLength: content.length,
    nextOffset: end < content.length ? end : null,
  }
}

// ---- write: update_resource ---------------------------------------------------------------------

const RESOURCE_FIELDS = ['title', 'publisher', 'edition', 'date', 'url', 'weight', 'notes', 'summary', 'checkedOn', 'content'] as const

function assertNotRed(text: string): void {
  if (RED_DERIVED_MARKER.test(text)) throw new McpToolError('Der Text enthält MiData-/NDS-Angaben und kann nicht gespeichert werden.')
}

function resourcePatchFromArgs(args: Record<string, unknown>): ResourcePatch {
  const patch: Record<string, unknown> = {}
  for (const f of RESOURCE_FIELDS) {
    const v = args[f]
    if (v === undefined) continue
    if (typeof v === 'string') assertNotRed(v)
    patch[f] = v
  }
  if (Object.keys(patch).length === 0) throw new McpToolError('Keine Änderung angegeben (title, content, … fehlen).')
  return patch as ResourcePatch
}

export const update_resource: McpHandler = async (args, ctx) => {
  const key = reqStr(args, 'key')
  const patch = resourcePatchFromArgs(args)
  if (!(await ctx.getResource(key))) throw new McpToolError(`Hilfsmittel «${key}» nicht gefunden.`)
  try {
    const rec = await ctx.updateResource(key, patch)
    return { ...metaView(rec), changed: Object.keys(patch) }
  } catch (e) {
    throw new McpToolError(e instanceof Error ? e.message : String(e))
  }
}

export const confirmUpdateResource: McpConfirmBuilder = async (args, ctx) => {
  const key = reqStr(args, 'key')
  const rec = await ctx.getResource(key)
  const patch = resourcePatchFromArgs(args) as Record<string, unknown>
  const details: string[] = []
  for (const [field, value] of Object.entries(patch)) {
    if (field === 'content') {
      const text = String(value)
      details.push(`Text ersetzen: ${rec?.content?.length ?? 0} -> ${text.length} Zeichen`, `Anfang: ${text.slice(0, 200)}`)
    } else {
      const before = (rec as unknown as Record<string, unknown> | undefined)?.[field]
      details.push(`${field}: ${before === undefined || before === null ? '(leer)' : String(before)} -> ${String(value)}`)
    }
  }
  return { tool: 'update_resource', kind: 'write', summary: `Hilfsmittel ändern: ${rec?.title ?? key}`, details }
}

// ---- write: update_rule -------------------------------------------------------------------------

function parseSources(raw: unknown): SourceRef[] {
  if (!Array.isArray(raw)) throw new McpToolError('Argument «sources» muss eine Liste sein.')
  return raw.map((x, i) => {
    if (!x || typeof x !== 'object') throw new McpToolError(`sources[${i}] muss ein Objekt {key, page} sein.`)
    const o = x as Record<string, unknown>
    if (typeof o.key !== 'string' || !o.key) throw new McpToolError(`sources[${i}].key fehlt.`)
    const ref: SourceRef = { key: o.key, page: typeof o.page === 'string' ? o.page : '' }
    if (typeof o.quote === 'string') ref.quote = o.quote
    return ref
  })
}

function parseVariants(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new McpToolError('Argument «messageVariants» muss ein Objekt sein.')
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string') throw new McpToolError(`messageVariants.${k} muss ein Text sein.`)
    out[k] = v
  }
  return out
}

function parseTags(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.some((t) => typeof t !== 'string')) throw new McpToolError('Argument «tags» muss eine Liste von Texten sein.')
  return raw as string[]
}

export function rulePatchFromArgs(args: Record<string, unknown>): RuleEditPatch {
  const patch: RuleEditPatch = {}
  for (const f of ['title', 'description', 'message'] as const) {
    const v = str(args, f)
    if (v !== undefined) {
      assertNotRed(v)
      patch[f] = v
    }
  }
  if (args.messageVariants !== undefined) patch.messageVariants = parseVariants(args.messageVariants)
  if (str(args, 'severity') !== undefined) patch.severity = str(args, 'severity') as Severity
  if (str(args, 'confidence') !== undefined) patch.confidence = str(args, 'confidence') as Confidence
  if (str(args, 'status') !== undefined) patch.status = str(args, 'status') as RuleStatus
  for (const f of ['validFrom', 'validTo'] as const) {
    const v = str(args, f)
    if (v !== undefined) patch[f] = v === '' ? null : v
  }
  if (args.sources !== undefined) patch.sources = parseSources(args.sources)
  if (args.tags !== undefined) patch.tags = parseTags(args.tags)
  if (Object.keys(patch).length === 0) throw new McpToolError('Keine Änderung angegeben (title, message, severity, … fehlen).')
  return patch
}

function resourceKeysArg(args: Record<string, unknown>): string[] | undefined {
  const v = args.resourceKeys
  if (v === undefined) return undefined
  if (!Array.isArray(v) || v.some((k) => typeof k !== 'string')) throw new McpToolError('Argument «resourceKeys» muss eine Liste von Texten sein.')
  return v as string[]
}

function findRule(ctx: McpContext, ruleId: string): { meta: RuleMeta; packId: string } | undefined {
  for (const p of ctx.rulePacks()) {
    const rule = p.rules.find((r) => r.meta.id === ruleId)
    if (rule) return { meta: rule.meta, packId: p.id }
  }
  return undefined
}

export function ruleView(meta: RuleMeta, packId: string, edit?: { updatedBy: string; updatedAt: string; reason?: string }) {
  return {
    id: meta.id,
    packId,
    module: meta.module,
    status: meta.status,
    title: meta.title,
    description: meta.description,
    message: meta.message,
    severity: meta.severity,
    confidence: meta.confidence,
    scope: meta.scope,
    validFrom: meta.validFrom ?? null,
    validTo: meta.validTo ?? null,
    sources: meta.sources.map((s) => ({ key: s.key, page: s.page })),
    source: { title: meta.source.title, url: meta.source.url },
    edited: !!edit,
    updatedBy: edit?.updatedBy ?? null,
    updatedAt: edit?.updatedAt ?? null,
    editReason: edit?.reason ?? null,
  }
}

export const update_rule: McpHandler = async (args, ctx) => {
  const ruleId = reqStr(args, 'ruleId')
  const reason = reqStr(args, 'reason').trim()
  if (!reason) throw new McpToolError('Die Begründung ist leer.')
  assertNotRed(reason)
  const patch = rulePatchFromArgs(args)
  if (!findRule(ctx, ruleId)) throw new McpToolError(`Regel «${ruleId}» nicht gefunden (oder ihr Regelpaket ist nicht aktiv).`)
  const existing = (await ctx.listRuleEdits()).find((e) => e.ruleId === ruleId)
  // The store keeps ONE patch per rule: merge so that earlier edits to other fields stay.
  const merged: RuleEditPatch = { ...(existing?.patch ?? {}), ...patch }
  try {
    await ctx.saveRuleEdit(ruleId, merged, { reason, resourceKeys: resourceKeysArg(args) ?? existing?.resourceKeys })
  } catch (e) {
    throw new McpToolError(e instanceof Error ? e.message : String(e))
  }
  const after = findRule(ctx, ruleId)
  const edit = (await ctx.listRuleEdits()).find((e) => e.ruleId === ruleId)
  if (!after) throw new McpToolError('Interner Fehler: Regel nach dem Speichern nicht gefunden.')
  return { saved: true, rule: ruleView(after.meta, after.packId, edit) }
}

export const confirmUpdateRule: McpConfirmBuilder = async (args, ctx): Promise<McpConfirmRequest> => {
  const ruleId = reqStr(args, 'ruleId')
  const patch = rulePatchFromArgs(args) as Record<string, unknown>
  const meta = findRule(ctx, ruleId)?.meta as unknown as Record<string, unknown> | undefined
  const show = (v: unknown) => (v === undefined || v === null ? '(leer)' : typeof v === 'string' ? v : JSON.stringify(v))
  const details = Object.entries(patch).map(([f, v]) => `${f}: ${show(meta?.[f])} -> ${show(v)}`)
  details.push(`Begründung: ${reqStr(args, 'reason')}`)
  const keys = resourceKeysArg(args)
  if (keys?.length) details.push(`Hilfsmittel: ${keys.join(', ')}`)
  return { tool: 'update_rule', kind: 'write', summary: `Regel anpassen: ${ruleId}${meta ? ` (${String(meta.title)})` : ''}`, details }
}

