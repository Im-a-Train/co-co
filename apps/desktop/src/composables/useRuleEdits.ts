/**
 * Rule edits state (ADR 0013): reactive `version` that changes whenever the effective packs changed
 * (edit saved/reset, store locked, Hilfsmittel changed). Components and composables that read
 * `loadEffectivePacks()` depend on `version` (read it inside a computed to recompute).
 */
import { ref, watch } from 'vue'
import { onRuleEditsChanged, reloadRuleEdits, clearRuleEditsCache, skippedRuleEdits, cachedRuleEdits, loadEffectivePacks } from '@/domain/rules/editsStore'
import type { RuleEditRecord, RulePack } from '@/domain/types'
import { useResources } from './useResources'
import { onDataStoreLocked, useDataStore } from './useDataStore'

const version = ref(0)
const loaded = ref(false)
let initialised = false
let loading: Promise<void> | null = null

onRuleEditsChanged(() => {
  version.value++
})
onDataStoreLocked(() => {
  loaded.value = false
  clearRuleEditsCache()
})

async function load(): Promise<void> {
  try {
    await reloadRuleEdits()
    loaded.value = true
  } catch {
    // locked / no IndexedDB (plain browser tests): effective packs stay the bundled ones
  }
}

/** Loads the edits once (idempotent); resolves when the first load finished. */
export function ensureLoaded(): Promise<void> {
  if (loaded.value) return Promise.resolve()
  loading ??= load().finally(() => {
    loading = null
  })
  return loading
}

/** Call once at app start (App.vue) after the data store is ready: loads edits, reloads on Hilfsmittel changes. */
export function initRuleEdits(): void {
  if (initialised) return
  initialised = true
  const { state } = useDataStore()
  watch(state, (s) => (s === 'ready' ? void ensureLoaded() : undefined), { immediate: true })
  // A Hilfsmittel (source key) can appear/disappear: edits are re-validated against the new registry.
  const { version: resourcesVersion } = useResources()
  watch(resourcesVersion, () => (loaded.value ? void load() : undefined))
}

export function useRuleEdits() {
  void ensureLoaded()
  return {
    version,
    loaded,
    /** Effective packs (bundled + edits). Read `version` first inside computeds. */
    packs: (): RulePack[] => {
      void version.value
      return loadEffectivePacks()
    },
    edits: (): readonly RuleEditRecord[] => {
      void version.value
      return cachedRuleEdits()
    },
    skipped: () => {
      void version.value
      return skippedRuleEdits()
    },
    reload: load,
  }
}
