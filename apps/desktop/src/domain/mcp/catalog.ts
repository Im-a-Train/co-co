/**
 * MCP tool catalogue (ADR 0012): static definitions shared by the settings UI (switches, grouped
 * «Lesen» / «Schreiben»), the Rust registration (`mcp_set_tools`) and the dispatcher.
 * Handlers live in ./handlers.ts. Read tools default ON, write tools default OFF.
 *
 * Ids: every `campId` accepts the short camp id ('70ca971c992f') or the IRI ('/api/camps/70ca971c992f');
 * `activityId` likewise ('/api/activities/…'). Use normalizeIri() from ./ids.ts in handlers.
 */
import { MODULE_IDS, type McpSettings } from '../types'
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
const feedbackId: JsonSchema = { type: 'string', description: 'Feedback item id as returned by list_feedback.', minLength: 1, maxLength: 100 }
const feedbackKind: JsonSchema = {
  type: 'string',
  enum: ['kudos', 'must', 'suggestion', 'question'],
  description: "kudos = praise, must = required change, suggestion = optional improvement, question = open question.",
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
    'The active rules co-co checks (enabled rule packs): id, module, title, description, severity, confidence, scope, validity and source URL. Retired rules are left out.',
    { module: { type: 'string', enum: [...MODULE_IDS], description: 'Only rules of this module (js = J+S general, lst* = Lagersport/Trekking modules, pbs = PBS).' } },
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
  // ---- write --------------------------------------------------------------------------------
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
