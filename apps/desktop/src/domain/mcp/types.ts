/**
 * Shared contract of the local MCP server (ADR 0012). Framework-free.
 *
 * Flow: MCP client -> Rust (src-tauri/src/mcp.rs, JSON-RPC over POST /mcp) -> event `mcp://tool-call`
 * (McpToolCallEvent) -> composables/mcpBridge.ts -> domain/mcp/dispatch.ts (enabled check, confirmation,
 * handler, zone check) -> command `mcp_tool_result(callId, McpToolOutcome)` -> Rust -> client.
 *
 * Data zones (ADR 0005/0012): an MCP client is an external AI. Handlers never touch MiData/NDS data
 * (red), redact every yellow text with the camp's redactor and the dispatcher runs every serialized
 * result through zones/mcpZone.ts assertMcpSendable().
 */
import type {
  CampFacts,
  CampListEntry,
  CategoryMapping,
  Deadline,
  DocumentRecord,
  FeedbackItem,
  Finding,
  Iri,
  ManualFinding,
  ModuleId,
  Override,
  ReviewState,
  ReviewStatus,
  ResourceRecord,
  Round,
  RuleEditPatch,
  RuleEditRecord,
  RulePack,
} from '../types'
import type { ResourcePatch } from '../resources'

export type McpToolKind = 'read' | 'write'

/** Every tool co-co offers. Adding one: catalog.ts entry + mcpTools.json texts + handler + test. */
export type McpToolName =
  // read
  | 'list_camps'
  | 'get_camp_overview'
  | 'list_activities'
  | 'get_activity'
  | 'list_findings'
  | 'get_rule_catalog'
  | 'list_deadlines'
  | 'list_feedback'
  | 'list_rounds'
  | 'list_resources'
  | 'search_resources'
  | 'get_resource'
  | 'list_manual_findings'
  | 'get_feedback_structure'
  | 'list_general_feedback_points'
  | 'get_camp_progress'
  | 'list_documents'
  | 'get_document_text'
  | 'get_review_guidance'
  // write
  | 'add_manual_finding'
  | 'update_manual_finding'
  | 'delete_manual_finding'
  | 'add_feedback'
  | 'update_feedback'
  | 'ignore_finding'
  | 'set_review_status'
  | 'post_feedback_comment'
  | 'update_resource'
  | 'update_rule'

/** Minimal JSON Schema subset used for tool inputs (what MCP clients understand). */
export interface JsonSchema {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array'
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  enum?: readonly (string | number)[]
  items?: JsonSchema
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  additionalProperties?: boolean
}

/** Static definition of one tool (catalog.ts). No handler here, see handlers.ts. */
export interface McpToolDefinition {
  name: McpToolName
  kind: McpToolKind
  /** Short English title for the MCP client (tools/list `title`). */
  title: string
  /** English description for the MCP client / its model. Mention ids, zones (redacted names) and limits. */
  description: string
  /** JSON Schema of `arguments` (type 'object'). */
  inputSchema: JsonSchema
  /** i18n keys (German UI, locales/de/mcpTools.json): `mcp.tools.<name>.title` / `.description`. */
  titleKey: string
  descriptionKey: string
}

/** What the frontend pushes to Rust via `mcp_set_tools` (only ENABLED tools). Mirrors coco_core::mcp::ToolRegistration. */
export interface McpToolRegistration {
  name: McpToolName
  title: string
  description: string
  kind: McpToolKind
  inputSchema: JsonSchema
}

/** Payload of the Rust event `mcp://tool-call` (main window only). */
export interface McpToolCallEvent {
  /** Opaque id; answer exactly once with mcp_tool_result(callId, …). */
  callId: string
  name: string
  kind: McpToolKind
  /** Raw JSON-RPC `params.arguments` (untrusted; validate in the handler). */
  arguments: unknown
  /**
   * Epoch milliseconds when Rust stops waiting and answers the client with a timeout. The bridge drops the
   * call (and its confirmation dialog) shortly before, so a write never runs after the client gave up.
   * Optional only for old mocks.
   */
  deadlineMs?: number
}

/**
 * Payload of the Rust event `mcp://tool-cancel`: the call was already answered without the frontend
 * (client sent notifications/cancelled, timeout, server stopped). Drop its dialog; never run it.
 */
export interface McpToolCancelEvent {
  callId: string
}

/** Answer to Rust (`mcp_tool_result`). `text` is the serialized result (JSON) or a German/English error message. */
export interface McpToolOutcome {
  text: string
  isError: boolean
}

/** One entry of the in-memory MCP activity log kept by Rust (never arguments or results). */
export interface McpLogEntry {
  /** Epoch milliseconds. */
  atMs: number
  /** Tool name; null for requests without a tool (e.g. rejected authentication). */
  tool: string | null
  kind: McpToolKind | null
  ok: boolean
  durationMs: number
  /** Short reason, e.g. 'Abgelehnt', 'Zeitüberschreitung', 'Nicht autorisiert'. Never payload data. */
  error: string | null
}

/** Rust `mcp_status` / event `mcp://status`. */
export interface McpStatus {
  running: boolean
  /** Port the server listens on (null when stopped). */
  port: number | null
  /** e.g. 'http://127.0.0.1:41731/mcp' (null when stopped). */
  url: string | null
  /** Last start/serve error (e.g. port in use), German. */
  error: string | null
  /** Number of registered (= enabled) tools. */
  toolCount: number
  /** Newest first, at most 50. */
  log: McpLogEntry[]
}

/** Thrown by handlers/dispatcher for an expected, user-readable tool error (becomes isError: true). */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpToolError'
  }
}

/** Shown in the in-app confirmation dialog before a write (or, with confirmReads, a read) tool runs. */
export interface McpConfirmRequest {
  tool: McpToolName
  kind: McpToolKind
  /** German summary, e.g. «Feedback-Entwurf hinzufügen (Lager «Sommerlager»)». */
  summary: string
  /** German detail lines, e.g. the exact (de-redacted) text that will be stored or posted. */
  details: string[]
}

/**
 * Everything a handler may touch besides pure domain functions. Implemented in composables/mcpBridge.ts
 * (Dexie stores, eCamp via api_get, cached CampFacts); tests pass fakes. MUST NOT expose MiData/NDS data.
 */
export interface McpContext {
  now(): Date
  /** «Meine Lager». Rejects with McpToolError when not logged in to eCamp. */
  listCamps(): Promise<CampListEntry[]>
  /** Cached or freshly loaded CampFacts. Rejects with McpToolError when not logged in / not found. */
  loadFacts(campIri: Iri): Promise<CampFacts>
  getMapping(campIri: Iri): Promise<CategoryMapping | null>
  /**
   * Rule findings of the camp, evaluated like useFindings BUT with `midata: null, nds: null` (red never
   * reaches MCP), overrides attached, AI findings excluded.
   */
  findings(campIri: Iri): Promise<Finding[]>
  /** Enabled rule packs with the coach's rule edits applied (loadEffectivePacks, AppSettings.rulePacks). */
  rulePacks(): RulePack[]
  /** Deadlines (incl. PBS milestones) of one camp, or of all camps with a summary when campIri is null. */
  deadlines(campIri: Iri | null): Promise<Deadline[]>
  listFeedback(campIri: Iri): Promise<FeedbackItem[]>
  getFeedback(id: string): Promise<FeedbackItem | null>
  saveFeedback(item: FeedbackItem): Promise<void>
  listOverrides(campIri: Iri): Promise<Override[]>
  addOverride(campIri: Iri, findingId: string, ruleId: string, reason: string): Promise<Override>
  listRounds(campIri: Iri): Promise<Round[]>
  getReview(campIri: Iri): Promise<ReviewState | null>
  setReviewStatus(campIri: Iri, status: ReviewStatus, note: string | null): Promise<ReviewState>
  /** Posts an activity feedback item as eCamp comment(s) (existing api_post_comment path). Returns the updated item. */
  postFeedbackComment(feedbackId: string): Promise<FeedbackItem>
  /** Hilfsmittel (ADR 0013, zone green): all resources incl. attached content. */
  listResources(): Promise<ResourceRecord[]>
  getResource(key: string): Promise<ResourceRecord | undefined>
  /** Throws Error(German) on validation failure / unknown key. Origin is always 'mcp'. */
  updateResource(key: string, patch: ResourcePatch): Promise<ResourceRecord>
  /** Manual findings (ADR 0014, written by the coach, zone green/yellow text). */
  listManualFindings(campIri: Iri): Promise<ManualFinding[]>
  getManualFinding(id: string): Promise<ManualFinding | null>
  /** Saves (insert or replace) and notifies the views. */
  saveManualFinding(item: ManualFinding): Promise<void>
  deleteManualFinding(id: string): Promise<void>
  /** Documents of the camp WITHOUT red-zone ones (zone 'red' never reaches MCP). Includes the extracted text and the local path: handlers must not return the path. */
  listDocuments(campIri: Iri): Promise<DocumentRecord[]>
  /**
   * Per-camp inputs of the review progress and of the AI guidance that are not plain stores: whether the
   * coach recorded camp inputs, the visible checklist progress, resolved module states and rules the coach disabled.
   */
  reviewContext(campIri: Iri): Promise<McpReviewContext>
  /** Stored rule edits (zone green). */
  listRuleEdits(): Promise<RuleEditRecord[]>
  /** Saves a rule edit with origin 'mcp' (policy enforced by the store). Throws Error(German) on validation failure. */
  saveRuleEdit(ruleId: string, patch: RuleEditPatch, opts: { reason?: string; resourceKeys?: string[] }): Promise<RuleEditRecord | null>
  /**
   * Asks the coach in co-co. Resolves false when denied, dismissed, timed out or when `signal` aborts
   * (the call was cancelled or reached its deadline; the dialog is closed then).
   */
  confirm(request: McpConfirmRequest, signal?: AbortSignal): Promise<boolean>
  newId(): string
}

/** See McpContext.reviewContext. */
export interface McpReviewContext {
  coachInputsPresent: boolean
  checklist: { done: number; total: number }
  moduleStates: Partial<Record<ModuleId, 'on' | 'suggested' | 'off'>>
  disabledRuleIds: string[]
}

/** A tool implementation. Returns a JSON-serializable value (already redacted). Throw McpToolError for user errors. */
export type McpHandler = (args: Record<string, unknown>, ctx: McpContext) => Promise<unknown>

/** Optional pre-step of write tools: builds the confirmation text (de-redacted) from validated args. */
export type McpConfirmBuilder = (args: Record<string, unknown>, ctx: McpContext) => Promise<McpConfirmRequest>
