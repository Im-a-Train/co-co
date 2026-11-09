/**
 * Findings of one camp: builds RuleContext from useCampFacts + useCampSettings + documents (db) +
 * overrides + AppSettings, runs evaluate(loadEffectivePacks(), ctx), writes a CampSummaryRecord.
 * Re-evaluates when facts / settings version / overrides / documents change.
 * AI findings (origin 'ai') can be appended via addAiFindings (kept in memory only, shared per camp).
 */
import { computed, onScopeDispose, ref, shallowRef, toValue, watch, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'
import { liveQuery } from 'dexie'
import { getDb } from '@/domain/storage/db'
import { getAppSettings } from '@/domain/storage/settings'
import { countFindings, evaluate } from '@/domain/rules/engine'
import { computeJsDays, lastJsDate, type JsDayReport } from '@/domain/rules/lib/jsDays'
import { selectPacks } from '@/domain/rules/packs'
import { loadEffectivePacks } from '@/domain/rules/editsStore'
import { useRuleEdits } from '@/composables/useRuleEdits'
import { addOverride, listOverrides, removeOverride, saveCampSummary } from '@/domain/rules/store'
import { categoryExclusionsForCamp, disabledRuleIds, disablePromptCount, isGloballyDisabled, resolveRule, type CategoryExclusion } from '@/domain/rules/ruleState'
import { filterExcludedFindings } from '@/domain/rules/categoryExclusions'
import { completeContext } from '@/domain/rules/lib/context'
import { disableRuleStored, enableRuleStored, excludeCategoryStored, includeCategoryStored, listAllOverrides, muteRuleStored } from '@/domain/rules/ruleStateStore'
import { useRuleState } from '@/composables/useRuleState'
import { DEFAULT_APP_SETTINGS } from '@/domain/types'
import type { RuleContextInput } from '@/domain/types'
import type { JsDayModel } from '@/domain/types'
import type { AppSettings, CampRuleConfig, DocumentRecord, Finding, FindingCounts, Iri, MidataAggregate, NdsAggregate, Override, RulePack } from '@/domain/types'
import { getMidataRecord } from '@/domain/midata/store'
import { midataVersion } from '@/composables/midataSignal'
import { getNdsRecord } from '@/domain/nds/store'
import { ndsVersion } from '@/composables/ndsSignal'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampSettings } from '@/composables/useCampSettings'
import { onDataStoreLocked, useDataStore } from '@/composables/useDataStore'

/** Last date with J+S minutes in the context's day model (null if none). */
function lastModelJsDate(model: JsDayModel): string | null {
  for (let i = model.days.length - 1; i >= 0; i--) if (model.days[i].jsMinutes > 0) return model.days[i].date
  return null
}

export interface FindingsHandle {
  findings: ComputedRef<Finding[]>
  counts: ComputedRef<FindingCounts>
  jsDays: ComputedRef<JsDayReport | null>
  evaluating: ComputedRef<boolean>
  error: ComputedRef<string | null>
  refresh(): Promise<void>
  /** "Ignorieren" with an optional reason (persisted via domain/rules/store.ts). */
  override(finding: Finding, reason?: string): Promise<void>
  /** Rules switched off for this camp (own or global), for the note on the Befunde page. */
  disabledRules: ComputedRef<DisabledRuleInfo[]>
  /** Set after ignoring when a rule was ignored often enough to offer disabling it. */
  disablePrompt: Ref<DisablePrompt | null>
  answerDisablePrompt(choice: 'camp' | 'all' | 'no'): Promise<void>
  enableRule(ruleId: string, global: boolean): Promise<void>
  removeOverride(finding: Finding): Promise<void>
  addAiFindings(findings: Finding[]): void
  /** Findings hidden because their activity category is excluded from the rule check. */
  excludedCount: ComputedRef<number>
  /** Category exclusions of this camp (all rules or single rules). */
  categoryExclusions: ComputedRef<CategoryExclusion[]>
  excludeCategory(categoryIri: Iri, ruleId: string | null): Promise<void>
  includeCategory(categoryIri: Iri, ruleId: string | null): Promise<void>
}

export interface DisabledRuleInfo {
  ruleId: string
  title: string
  global: boolean
}
export interface DisablePrompt {
  ruleId: string
  title: string
  count: number
}

/** AI findings per camp, in memory only (never persisted). Shared by all handles. */
const aiFindingsByCamp = ref<Record<Iri, Finding[]>>({})
onDataStoreLocked(() => {
  aiFindingsByCamp.value = {}
})

function enabledPacks(settings: AppSettings): RulePack[] {
  return selectPacks(loadEffectivePacks(), settings.rulePacks)
}

/** Subscribes to a Dexie live query; failures (no IndexedDB, e.g. in tests) are swallowed. */
function subscribe<T>(query: () => Promise<T>, onValue: (v: T) => void): () => void {
  try {
    const sub = liveQuery(query).subscribe({ next: onValue, error: () => {} })
    return () => sub.unsubscribe()
  } catch {
    return () => {}
  }
}

export function useFindings(campIri: MaybeRefOrGetter<Iri>): FindingsHandle {
  const iri = computed(() => toValue(campIri))
  const factsHandle = useCampFacts(iri)
  const settingsHandle = useCampSettings(iri)

  const overrides = shallowRef<Override[]>([])
  const documents = shallowRef<DocumentRecord[]>([])
  const appSettings = shallowRef<AppSettings>(DEFAULT_APP_SETTINGS)
  const midata = shallowRef<MidataAggregate | null>(null)
  const nds = shallowRef<NdsAggregate | null>(null)
  const campRuleConfig = shallowRef<CampRuleConfig | null>(null)
  const evalError = ref<string | null>(null)
  const { state: ruleState } = useRuleState()
  const disablePrompt = ref<DisablePrompt | null>(null)
  const { version: ruleEditsVersion } = useRuleEdits()
  const ruleTitle = (ruleId: string) => resolveRule(loadEffectivePacks().flatMap((p) => p.rules), ruleId)?.meta.title ?? ruleId
  const formerIdsOf = (ruleId: string): readonly string[] =>
    resolveRule(loadEffectivePacks().flatMap((p) => p.rules), ruleId)?.meta.formerIds ?? []

  // Live data: overrides + documents of this camp, app settings once.
  let unsub: Array<() => void> = []
  const stop = () => {
    unsub.forEach((u) => u())
    unsub = []
  }
  const { ready: storeReady } = useDataStore()
  watch(
    [iri, storeReady],
    ([value, isReady]) => {
      stop()
      if (!isReady) {
        // Locked (logout): drop what was read from the encrypted store.
        overrides.value = []
        documents.value = []
        appSettings.value = DEFAULT_APP_SETTINGS
      }
      if (!value || !isReady) return
      unsub = [
        subscribe(() => listOverrides(value), (v) => (overrides.value = v)),
        subscribe(() => getDb().documents.where('campIri').equals(value).toArray(), (v) => (documents.value = v)),
        subscribe(() => getAppSettings(), (v) => (appSettings.value = v)),
        subscribe(() => getDb().campRuleConfig.get(value), (v) => (campRuleConfig.value = v ?? null)),
      ]
    },
    { immediate: true },
  )
  onScopeDispose(stop)

  // MiData aggregate (red-derived; read from IndexedDB, re-read when the UI bumps midataVersion).
  watch(
    [iri, midataVersion],
    async ([value]) => {
      if (!value) {
        midata.value = null
        return
      }
      try {
        const record = await getMidataRecord(value)
        if (iri.value === value) midata.value = record?.aggregate ?? null
      } catch {
        midata.value = null
      }
    },
    { immediate: true },
  )

  // NDS aggregate (red-derived; same pattern, re-read when the UI bumps ndsVersion).
  watch(
    [iri, ndsVersion],
    async ([value]) => {
      if (!value) {
        nds.value = null
        return
      }
      try {
        const record = await getNdsRecord(value)
        if (iri.value === value) nds.value = record?.aggregate ?? null
      } catch {
        nds.value = null
      }
    },
    { immediate: true },
  )

  // Make sure mapping + coach inputs get loaded once the facts are there.
  watch(
    () => factsHandle.facts.value,
    (facts) => {
      if (facts) settingsHandle.load().catch(() => {})
    },
    { immediate: true },
  )

  const contextInput = computed<RuleContextInput | null>(() => {
    const facts = factsHandle.facts.value
    void settingsHandle.version.value
    if (!facts) return null
    return {
      facts,
      mapping: settingsHandle.mapping.value?.confirmed ? settingsHandle.mapping.value : null,
      coachInputs: settingsHandle.coachInputs.value,
      midata: midata.value,
      nds: nds.value,
      documents: documents.value,
      settings: appSettings.value,
      now: new Date(),
      userDisplayName: facts.collaborators.find((c) => c.isCurrentUser)?.displayName ?? null,
      overrides: overrides.value,
      campConfig: campRuleConfig.value,
    }
  })

  const result = computed<{ findings: Finding[]; error: string | null }>(() => {
    const input = contextInput.value
    void ruleEditsVersion.value
    if (!input) return { findings: [], error: null }
    try {
      const findings = evaluate(enabledPacks(appSettings.value), input, {
        disabledRuleIds: disabledRuleIds(ruleState.value, iri.value),
      })
      return { findings, error: null }
    } catch (e) {
      return { findings: [], error: e instanceof Error ? e.message : String(e) }
    }
  })

  /** J+S day model of the evaluated context (respects activity tags, params and 2027 rules). */
  const jsModel = computed<JsDayModel | null>(() => {
    const input = contextInput.value
    void ruleEditsVersion.value
    if (!input) return null
    try {
      const model = completeContext(enabledPacks(appSettings.value), input).js
      return model.status === 'ok' ? model : null
    } catch {
      return null
    }
  })

  /** Legacy per-day report (grid/bars) with the valid-day count taken from the context model when available. */
  const jsDays = computed<JsDayReport | null>(() => {
    const facts = factsHandle.facts.value
    void settingsHandle.version.value
    if (!facts) return null
    const legacy = computeJsDays(facts, settingsHandle.mapping.value?.confirmed ? settingsHandle.mapping.value : null)
    return jsModel.value ? { ...legacy, validDayCount: jsModel.value.jsDayCount } : legacy
  })

  const ruleFindings = computed(() =>
    filterExcludedFindings(result.value.findings, factsHandle.facts.value, ruleState.value, iri.value, formerIdsOf),
  )
  const findings = computed(() => {
    const ai = aiFindingsByCamp.value[iri.value] ?? []
    if (!ai.length) return ruleFindings.value.kept
    return [...ruleFindings.value.kept, ...filterExcludedFindings(ai, factsHandle.facts.value, ruleState.value, iri.value, formerIdsOf).kept]
  })
  const categoryExclusions = computed(() => categoryExclusionsForCamp(ruleState.value, iri.value))
  const counts = computed(() => countFindings(findings.value))
  const disabledRules = computed<DisabledRuleInfo[]>(() => {
    void ruleEditsVersion.value
    const rules = loadEffectivePacks().flatMap((p) => p.rules)
    const ids = [...new Set([...disabledRuleIds(ruleState.value, iri.value)].map((id) => resolveRule(rules, id)?.meta.id ?? id))].sort()
    return ids.map((ruleId) => ({ ruleId, title: ruleTitle(ruleId), global: isGloballyDisabled(ruleState.value, ruleId, resolveRule(rules, ruleId)?.meta.formerIds ?? []) }))
  })

  // Cached summary for "Meine Lager" (rule findings only, no AI).
  let summaryTimer: ReturnType<typeof setTimeout> | undefined
  watch(
    [() => ruleFindings.value.kept, jsDays, jsModel],
    ([ruleFindings, report, model]) => {
      const facts = factsHandle.facts.value
      if (!facts) return
      clearTimeout(summaryTimer)
      summaryTimer = setTimeout(() => {
        saveCampSummary({
          campIri: facts.camp.iri,
          title: facts.camp.title,
          start: facts.camp.start,
          end: facts.camp.end,
          counts: countFindings(ruleFindings),
          validJsDays: report ? report.validDayCount : null,
          totalDays: report ? report.totalDayCount : null,
          lastJsDate: model ? lastModelJsDate(model) : report ? lastJsDate(report) : null,
          evaluatedAt: new Date().toISOString(),
        }).catch(() => {})
      }, 300)
    },
    { immediate: true },
  )
  onScopeDispose(() => clearTimeout(summaryTimer))

  return {
    findings,
    counts,
    jsDays,
    evaluating: computed(() => factsHandle.loading.value),
    error: computed(() => result.value.error ?? evalError.value ?? factsHandle.error.value),
    async refresh() {
      evalError.value = null
      await factsHandle.load(true)
    },
    async override(finding, reason = '') {
      const created = await addOverride(iri.value, finding.id, finding.ruleId, reason)
      overrides.value = [...overrides.value.filter((o) => o.findingId !== finding.id), created]
      try {
        const count = disablePromptCount(await listAllOverrides(), ruleState.value, finding.ruleId, iri.value)
        disablePrompt.value = count === null ? null : { ruleId: finding.ruleId, title: ruleTitle(finding.ruleId), count }
      } catch {
        disablePrompt.value = null
      }
    },
    disabledRules,
    excludedCount: computed(() => ruleFindings.value.excluded),
    categoryExclusions,
    async excludeCategory(categoryIri, ruleId) {
      ruleState.value = await excludeCategoryStored(iri.value, categoryIri, ruleId)
    },
    async includeCategory(categoryIri, ruleId) {
      ruleState.value = await includeCategoryStored(iri.value, categoryIri, ruleId)
    },
    disablePrompt,
    async answerDisablePrompt(choice) {
      const p = disablePrompt.value
      disablePrompt.value = null
      if (!p) return
      if (choice === 'camp') ruleState.value = await disableRuleStored(p.ruleId, iri.value)
      else if (choice === 'all') ruleState.value = await disableRuleStored(p.ruleId, null)
      else ruleState.value = await muteRuleStored(p.ruleId, iri.value)
    },
    async enableRule(ruleId, global) {
      ruleState.value = await enableRuleStored(ruleId, global ? null : iri.value)
    },
    async removeOverride(finding) {
      if (!finding.override) return
      await removeOverride(finding.override.id)
      overrides.value = overrides.value.filter((o) => o.id !== finding.override?.id)
    },
    addAiFindings(list) {
      const key = iri.value
      const ids = new Set(list.map((f) => f.id))
      const kept = (aiFindingsByCamp.value[key] ?? []).filter((f) => !ids.has(f.id))
      aiFindingsByCamp.value = { ...aiFindingsByCamp.value, [key]: [...kept, ...list] }
    },
  }
}
