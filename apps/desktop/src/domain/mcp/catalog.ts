/**
 * MCP tool catalogue (ADR 0012): static definitions shared by the settings UI (switches, grouped
 * «Lesen» / «Schreiben»), the Rust registration (`mcp_set_tools`) and the dispatcher.
 * Handlers live in ./handlers.ts. Read tools default ON, write tools default OFF.
 *
 * Ids: every `campId` accepts the short camp id ('70ca971c992f') or the IRI ('/api/camps/70ca971c992f');
 * `activityId` likewise ('/api/activities/…'). Use normalizeIri() from ./ids.ts in handlers.
 */
import { MANUAL_FINDING_CATEGORIES, MODULE_IDS, RULE_KINDS, type McpSettings } from '../types'
import type { JsonSchema, McpToolDefinition, McpToolKind, McpToolName, McpToolRegistration } from './types'

const campId: JsonSchema = {
  type: 'string',
  description: "Camp id or IRI as returned by list_camps (e.g. '70ca971c992f' or '/api/camps/70ca971c992f').",
  minLength: 1,
  maxLength: 200,
}
const activityId: JsonSchema = {
  type: 'string',
  description: "Activity id or IRI as returned by list_activities (e.g. '/api/activities/b29d387cc403').",
  minLength: 1,
  maxLength: 200,
}
const resourceKey: JsonSchema = { type: 'string', description: 'Resource key as returned by list_resources (e.g. a manual id).', minLength: 1, maxLength: 100 }
const feedbackId: JsonSchema = { type: 'string', description: 'Feedback item id as returned by list_feedback.', minLength: 1, maxLength: 100 }
const feedbackKind: JsonSchema = {
  type: 'string',
  enum: ['kudos', 'must', 'suggestion', 'question'],
  description: "kudos = praise, must = required change, suggestion = optional improvement, question = open question.",
}
const documentId: JsonSchema = { type: 'string', description: 'Document id as returned by list_documents.', minLength: 1, maxLength: 100 }
const manualFindingId: JsonSchema = { type: 'string', description: "Manual finding id ('manual:...') as returned by list_manual_findings.", minLength: 1, maxLength: 100 }
const manualCategory: JsonSchema = {
  type: 'string',
  enum: [...MANUAL_FINDING_CATEGORIES],
  description: 'Category of the finding (positive = praise, safety, program, js, pedagogy, organisation, documents, question, other).',
}

function def(
  name: McpToolName,
  kind: McpToolKind,
  title: string,
  description: string,
  properties: Record<string, JsonSchema> = {},
  required: string[] = [],
): McpToolDefinition {
  return {
    name,
    kind,
    title,
    description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
    titleKey: `mcp.tools.${name}.title`,
    descriptionKey: `mcp.tools.${name}.description`,
  }
}

const REDACTED =
  ' Person names are pseudonymised (Leiter A, Leiter B, …); e-mail addresses, phone numbers and addresses are removed.'

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  // ---- read ---------------------------------------------------------------------------------
  def('list_camps', 'read', 'List camps', "Lists the eCamp camps of the logged-in J+S coach (id, title, motto, start, end, the coach's role)."),
  def(
    'get_camp_overview',
    'read',
    'Camp overview',
    'Overview of one camp: periods, number of days and activities, categories with their J+S class, valid J+S days, finding counts by severity, review status and number of review rounds.' +
      REDACTED,
    { campId },
    ['campId'],
  ),
  def(
    'list_activities',
    'read',
    'List activities',
    'Programme of one camp: schedule entries with number, day, start/end (camp-local time), title, category and location. With includeContent the programme and safety texts are added (truncated).' +
      REDACTED,
    {
      campId,
      day: { type: 'integer', minimum: 1, maximum: 60, description: 'Only entries of this day number (1-based).' },
      includeContent: { type: 'boolean', description: 'Add programme and safety texts (default false).' },
    },
    ['campId'],
  ),
  def(
    'get_activity',
    'read',
    'Get activity',
    'One activity with its schedule entries, programme, safety considerations, learning objectives, material and the rule findings concerning it.' +
      REDACTED,
    { campId, activityId },
    ['campId', 'activityId'],
  ),
  def(
    'list_findings',
    'read',
    'List findings',
    "Rule check results of one camp (J+S / PBS rule packs): id, rule, severity (must/should/hint), confidence, title, message, targets, source URL and triage status (open / feedback / ignored). Use the finding id for ignore_finding or add_feedback." +
      REDACTED,
    {
      campId,
      severity: { type: 'string', enum: ['must', 'should', 'hint'], description: 'Only findings of this severity.' },
      includeIgnored: { type: 'boolean', description: 'Include findings the coach ignored (default false).' },
    },
    ['campId'],
  ),
  def(
    'get_rule_catalog',
    'read',
    'Rule catalogue',
    "The active rules co-co checks (enabled rule packs): id, kind, module, title, description, severity, confidence, scope, validity and source URL. kind 'hard' = checked by the rule engine, 'ai' = guidance on what a good camp looks like (no automatic finding, used for AI reviews). Retired rules are left out.",
    {
      module: { type: 'string', enum: [...MODULE_IDS], description: 'Only rules of this module (js = J+S general, lst* = Lagersport/Trekking modules, pbs = PBS).' },
      kind: { type: 'string', enum: [...RULE_KINDS], description: "Only rules of this kind ('hard' or 'ai')." },
    },
  ),
  def(
    'list_deadlines',
    'read',
    'List deadlines',
    'Deadlines (J+S / NDS registration and closing, material, maps, camp approval, PBS milestones) with due date, status (done / overdue / soon / open) and source. Without campId: all camps that were opened in co-co.',
    { campId: { ...campId, description: 'Optional camp id or IRI; omit for all camps.' } },
  ),
  def(
    'list_feedback',
    'read',
    'List feedback',
    "The coach's feedback items for one camp: id, scope (camp / activity), activity, kind, status (draft / posted / sent) and text." + REDACTED,
    { campId },
    ['campId'],
  ),
  def(
    'list_rounds',
    'read',
    'List review rounds',
    'Review rounds of one camp (number, started, closed, note) and the current review status with its history.',
    { campId },
    ['campId'],
  ),
  def(
    'list_resources',
    'read',
    'List resources',
    'Lists the «Hilfsmittel» (reference documents and links the rules cite, e.g. J+S manuals): key, title, publisher, edition, date, url, weight, origin (bundled/custom), modified, hasContent, contentLength (characters of the attached text) and the ids of the rules citing it. Public reference material, no camp data.',
  ),
  def(
    'search_resources',
    'read',
    'Search resources',
    'Full-text search over the Hilfsmittel (title, summary, notes and attached document text). Words are AND-ed, case/umlaut-insensitive. Returns hits with key, title, url, snippet, score and where it matched. Use get_resource for the full text.',
    {
      query: { type: 'string', minLength: 1, maxLength: 200, description: 'Search words.' },
      limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum number of hits (default 8).' },
    },
    ['query'],
  ),
  def(
    'get_resource',
    'read',
    'Get resource',
    'One Hilfsmittel with all metadata and its attached text `content`, paged: pass offset/length (at most 20000 characters per call); the result has totalLength and nextOffset (null at the end).',
    {
      key: resourceKey,
      offset: { type: 'integer', minimum: 0, maximum: 5000000, description: 'Start character of the content slice (default 0).' },
      length: { type: 'integer', minimum: 1, maximum: 20000, description: 'Slice length (default and maximum 20000).' },
    },
    ['key'],
  ),
  def(
    'list_manual_findings',
    'read',
    'List manual findings',
    "The coach's own findings (written in co-co, not by rules) of one camp: id, scope (camp / activity / document), activity, document, anchor (page / sheet+cell / km), category and comment. Optionally only those of one activity." +
      REDACTED,
    { campId, activityId: { ...activityId, description: 'Optional: only manual findings of this activity.' } },
    ['campId'],
  ),
  def(
    'get_feedback_structure',
    'read',
    'Feedback structure',
    "The camp's feedback grouped like the feedback page: `general` (camp-wide points) first, then one group per day with its activities and their items (id, kind, status, text, documentId, generalPointId, manualFindingId)." +
      REDACTED,
    { campId },
    ['campId'],
  ),
  def(
    'list_general_feedback_points',
    'read',
    'List general feedback points',
    "The default general points a coach covers for every camp (siko, psa, notfall, rega, ...): id, German title, prompt, check bullets, related rule and checklist ids and whether the camp's feedback already uses the point (used, feedbackIds). Use the id as generalPointId in add_feedback. Static reference text, no camp data.",
    { campId },
    ['campId'],
  ),
  def(
    'get_camp_progress',
    'read',
    'Camp review progress',
    'How far the coach is with the review of a camp: percent (0-100) and the steps (mapping, inputs, triage, documents, checklist, feedback, status) with German label, done, value/total and a hint for the first open step. Counts only.',
    { campId },
    ['campId'],
  ),
  def(
    'list_documents',
    'read',
    'List documents',
    'Metadata of the camp documents the coach added (never the file path, never red-zone documents): id, name, kind (pdf/docx/xlsx/gpx/txt/md/...), size, ids of the linked activities, document check summary (complete, missing safety-concept items), GPX stats (distance, ascent, descent, Leistungskilometer), aiAllowed, text length and number of manual findings pointing at it. Use get_document_text for the text (only when aiAllowed).' +
      REDACTED,
    { campId },
    ['campId'],
  ),
  def(
    'get_document_text',
    'read',
    'Get document text',
    'The extracted text of one document, only if the coach allowed AI use for it (aiAllowed, see list_documents); otherwise an error. Text is pseudonymised and paged: pass offset/length (at most 20000 characters per call); the result has totalLength and nextOffset (null at the end).' +
      REDACTED,
    {
      campId,
      documentId,
      offset: { type: 'integer', minimum: 0, maximum: 5000000, description: 'Start character of the slice (default 0).' },
      length: { type: 'integer', minimum: 1, maximum: 20000, description: 'Slice length (default and maximum 20000).' },
    },
    ['campId', 'documentId'],
  ),
  def(
    'get_review_guidance',
    'read',
    'Get review guidance',
    "What a good scout camp looks like, as the coach's rule packs describe it: the active guidance ('ai') and hard rules valid for the camp (modules switched off and rules the coach disabled are left out) as compact German text plus the list of rule ids with kind. Use it as checklist when you review a camp yourself; guidance never produces a 'must'. Public rule texts, no camp data.",
    { campId },
    ['campId'],
  ),
  // ---- write --------------------------------------------------------------------------------
  def(
    'add_manual_finding',
    'write',
    'Add manual finding',
    "Records a finding of the coach in co-co (not sent anywhere): on the camp, on an activity (activityId) or on a document (documentId, optionally with page / sheet+cell / km as anchor). Pseudonyms like 'Leiter A' are replaced with the real names locally. The coach confirms in co-co.",
    {
      campId,
      category: manualCategory,
      comment: { type: 'string', minLength: 1, maxLength: 1000, description: 'The finding (plain text, German, at most 1000 characters).' },
      activityId: { ...activityId, description: 'Optional: attach the finding to this activity.' },
      documentId: { ...documentId, description: 'Optional: attach the finding to this document (list_documents).' },
      page: { type: 'integer', minimum: 1, maximum: 100000, description: 'Anchor: PDF page (needs documentId).' },
      sheet: { type: 'string', minLength: 1, maxLength: 100, description: 'Anchor: Excel sheet name (needs documentId).' },
      cell: { type: 'string', minLength: 1, maxLength: 30, description: "Anchor: Excel cell or range, e.g. 'B4' (needs documentId)." },
      km: { type: 'number', minimum: 0, maximum: 100000, description: 'Anchor: GPX distance in km (needs documentId).' },
    },
    ['campId', 'category', 'comment'],
  ),
  def(
    'update_manual_finding',
    'write',
    'Update manual finding',
    'Changes category and/or comment of a manual finding (id from list_manual_findings). Only the given fields change. The coach confirms in co-co.',
    {
      findingId: manualFindingId,
      category: manualCategory,
      comment: { type: 'string', minLength: 1, maxLength: 1000, description: 'New comment (plain text).' },
    },
    ['findingId'],
  ),
  def(
    'delete_manual_finding',
    'write',
    'Delete manual finding',
    'Deletes a manual finding (id from list_manual_findings). Cannot be undone in co-co. The coach confirms in co-co.',
    { findingId: manualFindingId },
    ['findingId'],
  ),
  def(
    'add_feedback',
    'write',
    'Add feedback draft',
    "Adds a feedback draft to a camp (only in co-co, nothing is sent). Pseudonyms like 'Leiter A' are replaced with the real names locally. The coach confirms in co-co before it is saved.",
    {
      campId,
      kind: feedbackKind,
      text: { type: 'string', minLength: 1, maxLength: 4000, description: 'Feedback text (plain text, German).' },
      activityId: { ...activityId, description: 'Optional: attach the feedback to this activity (scope activity); omit for camp scope.' },
      findingId: { type: 'string', maxLength: 300, description: 'Optional: the finding id this feedback answers (from list_findings).' },
      documentId: { ...documentId, description: 'Optional: the document this feedback refers to (list_documents, must belong to the camp).' },
      generalPointId: { type: 'string', maxLength: 50, description: 'Optional: the default general point this feedback covers (list_general_feedback_points).' },
      manualFindingId: { ...manualFindingId, description: 'Optional: the manual finding this feedback was refined from (must belong to the camp).' },
    },
    ['campId', 'kind', 'text'],
  ),
  def(
    'update_feedback',
    'write',
    'Update feedback draft',
    'Changes text and/or kind of a feedback item that is still a draft (posted or sent items cannot be changed). The coach confirms in co-co.',
    {
      feedbackId,
      text: { type: 'string', minLength: 1, maxLength: 4000, description: 'New text (plain text).' },
      kind: feedbackKind,
      documentId: { ...documentId, description: 'Optional: the document this feedback refers to (must belong to the camp).' },
      generalPointId: { type: 'string', maxLength: 50, description: 'Optional: the default general point (list_general_feedback_points).' },
      manualFindingId: { ...manualFindingId, description: 'Optional: the manual finding (must belong to the camp).' },
    },
    ['feedbackId'],
  ),
  def(
    'ignore_finding',
    'write',
    'Ignore finding',
    'Marks a finding of a camp as ignored with a reason (co-co only; can be undone in co-co). The coach confirms in co-co.',
    {
      campId,
      findingId: { type: 'string', minLength: 1, maxLength: 300, description: 'Finding id from list_findings.' },
      reason: { type: 'string', minLength: 1, maxLength: 500, description: 'Why the finding does not apply.' },
    },
    ['campId', 'findingId', 'reason'],
  ),
  def(
    'set_review_status',
    'write',
    'Set review status',
    "Sets the coach's review status of a camp (co-co only). Allowed transitions follow co-co's workflow: neu -> in_review -> aenderungen_angefragt / bewilligt / bewilligt_mit_auflagen. The coach confirms in co-co.",
    {
      campId,
      status: {
        type: 'string',
        enum: ['neu', 'in_review', 'aenderungen_angefragt', 'bewilligt', 'bewilligt_mit_auflagen'],
        description: 'New review status.',
      },
      note: { type: 'string', maxLength: 500, description: 'Optional note for the history.' },
    },
    ['campId', 'status'],
  ),
  def(
    'post_feedback_comment',
    'write',
    'Post feedback as eCamp comment',
    'Posts an activity feedback draft as comment(s) on the activity in eCamp (the only eCamp write co-co does; long texts are split into parts of at most 1024 characters). Visible to the camp leaders. The coach confirms in co-co.',
    { feedbackId },
    ['feedbackId'],
  ),
  def(
    'update_resource',
    'write',
    'Update resource',
    'Changes metadata and/or the attached text of a Hilfsmittel (key from list_resources). Only the given fields change; `content` replaces the whole attached text. The coach confirms in co-co; the change is marked as made via MCP.',
    {
      key: resourceKey,
      title: { type: 'string', minLength: 1, maxLength: 300 },
      publisher: { type: 'string', maxLength: 200 },
      edition: { type: 'string', maxLength: 100 },
      date: { type: 'string', maxLength: 10, description: 'ISO date YYYY-MM-DD.' },
      url: { type: 'string', maxLength: 1000, description: 'http(s) URL.' },
      weight: { type: 'string', enum: ['binding', 'binding-quote', 'didactic', 'outdated', 'pbs', 'info'], description: 'How binding the source is.' },
      notes: { type: 'string', maxLength: 4000 },
      summary: { type: 'string', maxLength: 2000 },
      checkedOn: { type: 'string', maxLength: 10, description: 'ISO date the source was last checked.' },
      content: { type: 'string', maxLength: 1000000, description: 'Plain text of the document (replaces the stored text).' },
    },
    ['key'],
  ),
  def(
    'update_rule',
    'write',
    'Update rule',
    "Adjusts a rule's metadata (not its logic): title, description, message, messageVariants, severity, confidence, status, validFrom/validTo (empty string removes the bound), sources ([{key, page, quote?}], keys from list_resources) and tags. A `reason` is required. MCP cannot set severity `must` or confidence `verified`; only the coach can. Returns the effective rule afterwards. The coach confirms in co-co.",
    {
      ruleId: { type: 'string', minLength: 1, maxLength: 100, description: 'Rule id from get_rule_catalog.' },
      reason: { type: 'string', minLength: 1, maxLength: 500, description: "Why the rule changes, e.g. 'Manual 2027 S. 21 geändert'." },
      resourceKeys: { type: 'array', items: { type: 'string', maxLength: 100 }, description: 'Resource keys the change relies on.' },
      title: { type: 'string', minLength: 1, maxLength: 300 },
      description: { type: 'string', minLength: 1, maxLength: 4000 },
      message: { type: 'string', minLength: 1, maxLength: 2000, description: 'Message template; keep the {param} placeholders.' },
      messageVariants: { type: 'object', description: 'Map variant name -> message template.' },
      severity: { type: 'string', enum: ['should', 'hint'], description: "'must' is not allowed via MCP." },
      confidence: { type: 'string', enum: ['conflict', 'unverified', 'best-practice', 'heuristic'], description: "'verified' is not allowed via MCP." },
      status: { type: 'string', enum: ['active', 'retired'] },
      validFrom: { type: 'string', maxLength: 10, description: 'ISO date; empty string removes the bound.' },
      validTo: { type: 'string', maxLength: 10, description: 'ISO date; empty string removes the bound.' },
      sources: {
        type: 'array',
        items: { type: 'object', description: '{ key: resource key, page: string, quote?: string }' },
        description: 'Citations of the rule (replaces the list).',
      },
      tags: { type: 'array', items: { type: 'string', maxLength: 60 } },
    },
    ['ruleId', 'reason'],
  ),
]

export const MCP_TOOL_NAMES: readonly McpToolName[] = MCP_TOOLS.map((t) => t.name)

export function mcpToolByName(name: string): McpToolDefinition | undefined {
  return MCP_TOOLS.find((t) => t.name === name)
}

/** Default switch state: read tools on, write tools off. */
export function defaultToolEnabled(tool: McpToolDefinition): boolean {
  return tool.kind === 'read'
}

/** Effective switch state of a tool under the given settings (missing entry = default). */
export function isToolEnabled(tool: McpToolDefinition, tools: McpSettings['tools']): boolean {
  return tools[tool.name] ?? defaultToolEnabled(tool)
}

/** What `mcp_set_tools` receives: the enabled tools only. */
export function mcpToolRegistrations(tools: McpSettings['tools']): McpToolRegistration[] {
  return MCP_TOOLS.filter((t) => isToolEnabled(t, tools)).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    kind: t.kind,
    inputSchema: t.inputSchema,
  }))
}
