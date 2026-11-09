/**
 * MCP tool-call bridge (ADR 0012): listens to `mcp://tool-call`, runs domain/mcp/dispatch.ts with the real
 * McpContext and answers with commands.mcpToolResult. Installed once from App.vue onMounted (Tauri only).
 *
 * - createMcpContext(): McpContext built from Dexie stores, useCampList/useCampFacts caches, useSession,
 *   the rules engine (evaluated with midata: null, nds: null), feedback posting and requestConfirm.
 *   MUST NOT import MiData/NDS modules (enforced by __tests__/contracts/mcpGuard.test.ts).
 * - installMcpBridge(): idempotent; every event is answered exactly once, also on unexpected exceptions.
 */
import { effectScope } from 'vue'
import { getMapping, getCoachInputs, listCoachInputs } from '@/domain/campFacts/store'
import { dispatchToolCall } from '@/domain/mcp/dispatch'
import { stripRedDerivedInputs } from '@/domain/mcp/sanitize'
import { McpToolError, type McpContext, type McpToolCallEvent, type McpToolOutcome } from '@/domain/mcp/types'
import { listFeedback, saveFeedback } from '@/domain/feedback/store'
import { deleteManualFinding, getManualFinding, listManualFindings, saveManualFinding } from '@/domain/manualFindings/store'
import { listRounds, getReview, setReviewStatus } from '@/domain/rounds/store'
import { evaluate } from '@/domain/rules/engine'
import { computeAllDeadlines, type DeadlineCamp } from '@/domain/rules/lib/deadlines'
import { computeJsDays, lastJsDate } from '@/domain/rules/lib/jsDays'
import { computeMilestoneDeadlines, loadBundledMilestones } from '@/domain/rules/milestones'
import { listRuleEdits, loadEffectivePacks, reloadRuleEdits, saveRuleEdit } from '@/domain/rules/editsStore'
import { getResource, listResources, updateResource } from '@/domain/resources/store'
import { getCampRuleConfig } from '@/domain/rules/campRuleConfigStore'
import { filterExcludedFindings } from '@/domain/rules/categoryExclusions'
import { disabledRuleIds, resolveRule } from '@/domain/rules/ruleState'
import { getRuleState } from '@/domain/rules/ruleStateStore'
import { addOverride, listCampSummaries, listOverrides } from '@/domain/rules/store'
import { getDb, newId } from '@/domain/storage/db'
import { getAppSettings } from '@/domain/storage/settings'
import type { AppSettings, CampFacts, Deadline, FeedbackItem, Finding, Iri, ModuleId, RulePack } from '@/domain/types'
import { commands, onMcpToolCall, onMcpToolCancel } from '@/lib/tauri'
import { notifyMcpChange } from './mcpChanges'
import { requestConfirm } from './mcpConfirm'
import { useCampFacts } from './useCampFacts'
import { useCampList } from './useCampList'
import { useCampRuleConfig } from './useCampRuleConfig'
import { useFeedback } from './useFeedback'
import { useSession } from './useSession'

function enabledPacks(settings: AppSettings): RulePack[] {
  const all = loadEffectivePacks()
  return settings.rulePacks.length === 0 ? all : all.filter((p) => settings.rulePacks.includes(p.id))
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function createMcpContext(): McpContext {
  async function loadFacts(campIri: Iri): Promise<CampFacts> {
    const handle = useCampFacts(campIri)
    const facts = await handle.load()
    if (!facts) throw new McpToolError(handle.error.value ?? 'Lager konnte nicht geladen werden (nicht angemeldet oder nicht gefunden).')
    return facts
  }

  async function listCamps() {
    const { session } = useSession()
    if (!session.value?.userIri) throw new McpToolError('Nicht in eCamp angemeldet.')
    const handle = useCampList()
    await handle.load()
    if (handle.camps.value.length === 0 && handle.error.value) throw new McpToolError(handle.error.value)
    return handle.camps.value
  }

  const ctx: McpContext = {
    now: () => new Date(),
    listCamps,
    loadFacts,
    getMapping: (campIri) => getMapping(campIri),

    async findings(campIri) {
      const facts = await loadFacts(campIri)
      const settings = await getAppSettings()
      const mapping = await getMapping(campIri)
      const coachInputs = stripRedDerivedInputs(await getCoachInputs(campIri))
      const documents = (await getDb().documents.where('campIri').equals(campIri).toArray()).filter((d) => d.zone !== 'red')
      const overrides = await listOverrides(campIri)
      const ruleState = await getRuleState()
      // Rules v2: module states, activity tags and camp context, like useFindings.
      const campConfig = await getCampRuleConfig(campIri)
      const { user } = useSession()
      const userDisplayName = facts.collaborators.find((c) => c.isCurrentUser)?.displayName ?? user.value?.displayName ?? null
      const found = evaluate(
        enabledPacks(settings),
        {
          facts,
          mapping: mapping?.confirmed ? mapping : null,
          coachInputs,
          // Red zone: MiData/NDS never reach MCP.
          midata: null,
          nds: null,
          documents,
          settings,
          now: new Date(),
          userDisplayName,
          overrides,
          campConfig,
        },
        { disabledRuleIds: disabledRuleIds(ruleState, campIri) },
      )
      // Same category exclusions as the Befunde view (incl. former rule ids).
      const allRules = enabledPacks(settings).flatMap((p) => p.rules)
      const formerIdsOf = (ruleId: string): readonly string[] => resolveRule(allRules, ruleId)?.meta.formerIds ?? []
      const { kept } = filterExcludedFindings(found, facts, ruleState, campIri, formerIdsOf)
      return kept.filter((f: Finding) => f.origin === 'rule')
    },

    rulePacks: () => enabledPacks(getSettingsSync()),

    listManualFindings: (campIri) => listManualFindings(campIri),
    async getManualFinding(id) {
      return (await getManualFinding(id)) ?? null
    },
    async saveManualFinding(item) {
      await saveManualFinding(item)
      notifyMcpChange(item.campIri, 'manualFinding')
    },
    async deleteManualFinding(id) {
      const item = await getManualFinding(id)
      await deleteManualFinding(id)
      if (item) notifyMcpChange(item.campIri, 'manualFinding')
    },
    // Red zone: documents flagged red never reach MCP.
    async listDocuments(campIri) {
      return (await getDb().documents.where('campIri').equals(campIri).toArray()).filter((d) => d.zone !== 'red')
    },
    async reviewContext(campIri) {
      await loadFacts(campIri)
      const inputs = stripRedDerivedInputs(await getCoachInputs(campIri))
      const disabled = [...disabledRuleIds(await getRuleState(), campIri)]
      // Same resolution as the Checkliste tab / Übersicht (module states, visible items, milestone-done).
      const scope = effectScope()
      try {
        const rc = scope.run(() => useCampRuleConfig(campIri))
        if (!rc) throw new McpToolError('Interner Fehler: Regelkonfiguration konnte nicht geöffnet werden.')
        for (let i = 0; i < 30 && !rc.loaded.value; i++) await new Promise((r) => setTimeout(r, 50))
        await new Promise((r) => setTimeout(r, 50))
        const states = rc.config.value.checklist ?? {}
        const milestonesDone = inputs?.milestonesDone ?? {}
        const done = rc.checklist.value.filter(
          (it) => states[it.id]?.done === true || (!!it.milestone && Object.prototype.hasOwnProperty.call(milestonesDone, it.milestone)),
        ).length
        const moduleStates: Partial<Record<ModuleId, 'on' | 'suggested' | 'off'>> = {}
        for (const [id, res] of Object.entries(rc.moduleStates.value)) if (res) moduleStates[id as ModuleId] = res.state
        return { coachInputsPresent: inputs !== null, checklist: { done, total: rc.checklist.value.length }, moduleStates, disabledRuleIds: disabled }
      } finally {
        scope.stop()
      }
    },

    listResources: () => listResources(),
    getResource: (key) => getResource(key),
    updateResource: (key, patch) => updateResource(key, patch, 'mcp'),
    listRuleEdits: () => listRuleEdits(),
    async saveRuleEdit(ruleId, patch, opts) {
      const rec = await saveRuleEdit(ruleId, patch, { origin: 'mcp', ...opts })
      await reloadRuleEdits()
      return rec
    },

    async deadlines(campIri) {
      const camps = await listCamps()
      const summaries = new Map((await listCampSummaries()).map((s) => [s.campIri, s.lastJsDate ?? null]))
      const inputs = Object.fromEntries((await listCoachInputs()).map((i) => [i.campIri, stripRedDerivedInputs(i) ?? undefined]))
      const milestones = loadBundledMilestones()
      let deadlineCamps: DeadlineCamp[] = camps
        .filter((c) => !c.isPrototype)
        .map((c) => ({ iri: c.iri, title: c.title, start: c.start, end: c.end, lastJsDate: summaries.get(c.iri) ?? null }))
      if (campIri) {
        deadlineCamps = deadlineCamps.filter((c) => c.iri === campIri)
        if (deadlineCamps.length === 0) {
          const facts = await loadFacts(campIri)
          const mapping = await getMapping(campIri)
          const report = mapping?.confirmed ? computeJsDays(facts, mapping) : null
          deadlineCamps = [
            { iri: facts.camp.iri, title: facts.camp.title, start: facts.camp.start, end: facts.camp.end, lastJsDate: report ? lastJsDate(report) : null },
          ]
        }
      }
      const all: Deadline[] = [
        ...computeAllDeadlines(deadlineCamps, inputs),
        ...deadlineCamps.flatMap((c) => computeMilestoneDeadlines(c, inputs[c.iri] ?? null, milestones)),
      ]
      return all.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.campTitle.localeCompare(b.campTitle)))
    },

    listFeedback: (campIri) => listFeedback(campIri),
    async getFeedback(id) {
      return (await getDb().feedback.get(id)) ?? null
    },
    // Writes notify the views that keep their own copy (useFeedback, useRounds), see mcpChanges.ts.
    async saveFeedback(item) {
      await saveFeedback(item)
      notifyMcpChange(item.campIri, 'feedback')
    },
    listOverrides: (campIri) => listOverrides(campIri),
    async addOverride(campIri, findingId, ruleId, reason) {
      const o = await addOverride(campIri, findingId, ruleId, reason)
      notifyMcpChange(campIri, 'override')
      return o
    },
    listRounds: (campIri) => listRounds(campIri),
    getReview: (campIri) => getReview(campIri),
    async setReviewStatus(campIri, status, note) {
      const r = await setReviewStatus(campIri, status, note)
      notifyMcpChange(campIri, 'review')
      return r
    },

    async postFeedbackComment(feedbackId) {
      const item = await ctx.getFeedback(feedbackId)
      if (!item) throw new McpToolError('Feedback-Punkt nicht gefunden.')
      const scope = effectScope()
      try {
        const handle = scope.run(() => useFeedback(item.campIri))
        if (!handle) throw new McpToolError('Interner Fehler: Feedback konnte nicht geöffnet werden.')
        await handle.reload()
        try {
          await handle.postAsComment(feedbackId)
        } catch (e) {
          throw new McpToolError(`Posten in eCamp fehlgeschlagen: ${errText(e)}`)
        }
        const stored: FeedbackItem | null = await ctx.getFeedback(feedbackId)
        if (!stored) throw new McpToolError('Feedback-Punkt nicht gefunden.')
        return stored
      } finally {
        scope.stop()
        notifyMcpChange(item.campIri, 'feedback')
      }
    },

    confirm: (request, signal) => requestConfirm(request, signal),
    newId: () => newId(),
  }
  return ctx
}

// Rule packs are needed synchronously by McpContext.rulePacks(); the settings are refreshed on every call.
let cachedSettings: AppSettings | null = null
function getSettingsSync(): AppSettings {
  return cachedSettings ?? ({ rulePacks: [] } as unknown as AppSettings)
}

let installed = false
let context: McpContext | null = null

/**
 * The bridge gives up this long before the call's Rust deadline (`deadlineMs`), so the result (or the
 * refusal) still reaches Rust in time and a handler never starts after the client was told «Zeitüberschreitung».
 */
export const MCP_DEADLINE_MARGIN_MS = 5_000
export const MCP_TIMEOUT_TEXT = 'Zeitüberschreitung: Der Aufruf wurde in co-co nicht rechtzeitig bestätigt.'
export const MCP_CANCELLED_TEXT = 'Abgebrochen: Der MCP-Client wartet nicht mehr auf dieses Ergebnis.'

/** Milliseconds until the bridge aborts a call (null = no deadline known). Pure, for tests. */
export function abortDelayMs(deadlineMs: number | undefined, nowMs: number): number | null {
  if (typeof deadlineMs !== 'number' || !Number.isFinite(deadlineMs)) return null
  return Math.max(0, deadlineMs - nowMs - MCP_DEADLINE_MARGIN_MS)
}

/** callId -> controller of calls in progress (aborted by `mcp://tool-cancel` or the deadline). */
const inflight = new Map<string, AbortController>()

/** Runs one tool-call event and answers Rust exactly once. Exported for tests. */
export async function handleMcpToolCall(call: McpToolCallEvent, ctx?: McpContext): Promise<McpToolOutcome> {
  const ac = new AbortController()
  inflight.set(call.callId, ac)
  const delay = abortDelayMs(call.deadlineMs, Date.now())
  const timer = delay === null ? null : setTimeout(() => ac.abort(MCP_TIMEOUT_TEXT), delay)
  let outcome: McpToolOutcome
  try {
    const c = ctx ?? (context ??= createMcpContext())
    const settings = await getAppSettings()
    cachedSettings = settings
    // Rule edits made in the UI since the last call; a locked store just keeps the cached effective packs.
    await reloadRuleEdits().catch(() => undefined)
    outcome = await dispatchToolCall(call, c, settings, ac.signal)
  } catch (e) {
    outcome = { text: `Interner Fehler: ${errText(e)}`, isError: true }
  } finally {
    if (timer !== null) clearTimeout(timer)
    inflight.delete(call.callId)
  }
  try {
    await commands.mcpToolResult(call.callId, outcome)
  } catch {
    // Rust may have answered the call already; nothing else to do (and never log payloads).
  }
  return outcome
}

/** `mcp://tool-cancel`: closes the call's dialog and keeps its handler from starting. */
export function cancelMcpToolCall(callId: string): void {
  inflight.get(callId)?.abort(MCP_CANCELLED_TEXT)
}

export async function installMcpBridge(): Promise<void> {
  if (installed) return
  installed = true
  await onMcpToolCancel((e) => cancelMcpToolCall(e.callId))
  await onMcpToolCall((call: McpToolCallEvent) => {
    void handleMcpToolCall(call)
  })
}
