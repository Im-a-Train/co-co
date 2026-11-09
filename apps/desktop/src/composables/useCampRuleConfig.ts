/**
 * Per-camp rule configuration (catalog v2 §3.8) for the coach UI: loads/saves CampRuleConfig through
 * campRuleConfigStore, resolves the effective module states with reasons for the current camp (same
 * resolution as the engine) and the visible coach checklist.
 *
 * Findings re-evaluate on change: useFindings subscribes to the same Dexie table (liveQuery), so every
 * save here reaches the engine without further wiring.
 */
import { computed, onScopeDispose, shallowRef, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { liveQuery } from 'dexie'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampSettings } from '@/composables/useCampSettings'
import { getDb } from '@/domain/storage/db'
import { getAppSettings } from '@/domain/storage/settings'
import { defaultCampRuleConfig, normalizeCampRuleConfig, updateCampRuleConfig } from '@/domain/rules/campRuleConfigStore'
import {
  withActivityTags,
  withChecklistItem,
  withModuleState,
  withSbApproval,
} from '@/domain/rules/lib/campConfigEdit'
import { campOverlapsMonths, loadBundledChecklist, visibleChecklist, type ChecklistItem } from '@/domain/rules/lib/checklist'
import { compiledSetsOf, contextDate, paramDefsOf } from '@/domain/rules/lib/context'
import { createKeywordMatcher } from '@/domain/rules/lib/keywords'
import { resolveModuleStates } from '@/domain/rules/lib/moduleState'
import { createParamReader } from '@/domain/rules/lib/params'
import { modulesOf, selectPacks } from '@/domain/rules/packs'
import { loadEffectivePacks } from '@/domain/rules/editsStore'
import { useRuleEdits } from '@/composables/useRuleEdits'
import { DEFAULT_APP_SETTINGS } from '@/domain/types'
import type {
  ActivityTag,
  AppSettings,
  CampRuleConfig,
  DocumentRecord,
  Iri,
  ModuleCoachState,
  ModuleDef,
  ModuleId,
  ModuleResolution,
  SbApprovalKind,
} from '@/domain/types'

export interface CampRuleConfigHandle {
  /** Stored config with defaults applied (never null). */
  config: ComputedRef<CampRuleConfig>
  /** Sport with the default (lst) applied. */
  sport: ComputedRef<'lst' | 'other'>
  /** Modules of the enabled packs. */
  modules: ComputedRef<ModuleDef[]>
  /** Effective state + reasons per module for this camp (empty until the facts are loaded). */
  moduleStates: ComputedRef<Partial<Record<ModuleId, ModuleResolution>>>
  /** Checklist items shown for this camp (module on, showWhen holds). */
  checklist: ComputedRef<ChecklistItem[]>
  /** Camp overlaps lst.winterMonths. */
  campInWinter: ComputedRef<boolean>
  loaded: ComputedRef<boolean>
  error: ComputedRef<string | null>
  /** Read-modify-write of the stored record. */
  update(fn: (c: CampRuleConfig) => CampRuleConfig): Promise<void>
  setSport(sport: 'lst' | 'other'): Promise<void>
  setModule(id: ModuleId, state: ModuleCoachState): Promise<void>
  setCamp(patch: Partial<CampRuleConfig['camp']>): Promise<void>
  setAngebot(patch: Partial<CampRuleConfig['angebot']>): Promise<void>
  setTags(activityIri: Iri, tags: ActivityTag[]): Promise<void>
  setSbApproval(key: Iri | 'camp', value: { approvedOn?: string | null; kind: SbApprovalKind } | null): Promise<void>
  setChecklistItem(id: string, patch: { done?: boolean; note?: string }): Promise<void>
}

function subscribe<T>(query: () => Promise<T>, onValue: (v: T) => void): () => void {
  try {
    const sub = liveQuery(query).subscribe({ next: onValue, error: () => {} })
    return () => sub.unsubscribe()
  } catch {
    return () => {}
  }
}

export function useCampRuleConfig(campIri: MaybeRefOrGetter<Iri>): CampRuleConfigHandle {
  const iri = computed(() => toValue(campIri))
  const { facts } = useCampFacts(iri)
  const settingsHandle = useCampSettings(iri)

  const stored = shallowRef<CampRuleConfig | null>(null)
  const documents = shallowRef<DocumentRecord[]>([])
  const appSettings = shallowRef<AppSettings>(DEFAULT_APP_SETTINGS)
  const loaded = shallowRef(false)
  const error = shallowRef<string | null>(null)

  let unsub: Array<() => void> = []
  const stop = () => {
    unsub.forEach((u) => u())
    unsub = []
  }
  watch(
    iri,
    (value) => {
      stop()
      stored.value = null
      loaded.value = false
      if (!value) return
      unsub = [
        subscribe(
          async () => {
            const rec = await getDb().campRuleConfig.get(value)
            return rec ? normalizeCampRuleConfig(rec, value) : null
          },
          (v) => {
            stored.value = v
            loaded.value = true
          },
        ),
        subscribe(() => getDb().documents.where('campIri').equals(value).toArray(), (v) => (documents.value = v)),
        subscribe(() => getAppSettings(), (v) => (appSettings.value = v)),
      ]
    },
    { immediate: true },
  )
  onScopeDispose(stop)

  const config = computed(() => stored.value ?? defaultCampRuleConfig(iri.value))
  const sport = computed(() => config.value.sport ?? 'lst')
  const ruleEdits = useRuleEdits()
  const packs = computed(() => {
    void ruleEdits.version.value
    return selectPacks(loadEffectivePacks(), appSettings.value.rulePacks)
  })
  const modules = computed(() => modulesOf(packs.value))

  const moduleStates = computed(() => {
    const f = facts.value
    void settingsHandle.version.value
    if (!f) return {}
    try {
      const params = createParamReader({
        defs: paramDefsOf(packs.value),
        date: contextDate({ facts: f, now: new Date() }),
        adminParams: appSettings.value.ruleParams ?? null,
        campParams: config.value.params,
      })
      return resolveModuleStates({
        modules: modules.value,
        facts: f,
        coachInputs: settingsHandle.coachInputs.value,
        documents: documents.value,
        config: { ...config.value, sport: sport.value },
        keywords: createKeywordMatcher(compiledSetsOf(packs.value)),
        params,
      })
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return {}
    }
  })

  /** Camp overlaps `lst.winterMonths` (false while facts are missing). */
  const campInWinter = computed(() => {
    const f = facts.value
    if (!f) return false
    let winterMonths: number[] = [11, 12, 1, 2, 3, 4]
    try {
      winterMonths = createParamReader({
        defs: paramDefsOf(packs.value),
        date: contextDate({ facts: f, now: new Date() }),
        adminParams: appSettings.value.ruleParams ?? null,
        campParams: config.value.params,
      }).get<number[]>('lst.winterMonths')
    } catch {
      // Param missing (packs in flux): use the documented default.
    }
    return campOverlapsMonths(f.days.map((d) => d.date), winterMonths)
  })

  const checklist = computed(() => {
    if (!facts.value) return []
    return visibleChecklist(loadBundledChecklist(), {
      moduleStates: moduleStates.value,
      config: config.value,
      coachInputs: settingsHandle.coachInputs.value,
      campInWinter: campInWinter.value,
    })
  })

  async function update(fn: (c: CampRuleConfig) => CampRuleConfig): Promise<void> {
    error.value = null
    try {
      stored.value = await updateCampRuleConfig(iri.value, fn)
      loaded.value = true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    }
  }

  return {
    config,
    sport,
    modules,
    moduleStates,
    checklist,
    campInWinter,
    loaded: computed(() => loaded.value),
    error: computed(() => error.value),
    update,
    setSport: (s) => update((c) => ({ ...c, sport: s })),
    setModule: (id, state) => update((c) => withModuleState(c, id, state)),
    setCamp: (patch) => update((c) => ({ ...c, camp: { ...c.camp, ...patch } })),
    setAngebot: (patch) => update((c) => ({ ...c, angebot: { ...c.angebot, ...patch } })),
    setTags: (activityIri, tags) => update((c) => withActivityTags(c, activityIri, tags)),
    setSbApproval: (key, value) => update((c) => withSbApproval(c, key, value)),
    setChecklistItem: (id, patch) => update((c) => withChecklistItem(c, id, patch)),
  }
}
