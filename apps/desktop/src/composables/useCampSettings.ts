/**
 * Per-camp category mapping + coach inputs, reactive and persisted.
 * Consumers (rules, cockpit, documents) rely on the shapes below. Changing a mapping or an input
 * bumps `version` so useFindings re-evaluates.
 */
import { computed, ref, shallowRef, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { classOf, guessCategories, mappingFromGuesses } from '@/domain/campFacts'
import { getCoachInputs, getMapping, saveCoachInputs, saveMapping } from '@/domain/campFacts/store'
import { dropEditedMidataFields } from '@/domain/midata'
import { dropEditedNdsFields } from '@/domain/nds'
import type { CampFacts, CategoryClass, CategoryMapping, CoachInputs, Iri, MidataField, NdsField } from '@/domain/types'
import { useCampFacts } from './useCampFacts'

export interface CampSettingsHandle {
  mapping: ComputedRef<CategoryMapping | null>
  coachInputs: ComputedRef<CoachInputs | null>
  /** True once the coach confirmed the mapping for this camp. */
  mappingConfirmed: ComputedRef<boolean>
  /** Increments on every save (mapping or inputs). */
  version: ComputedRef<number>
  /** Loads from IndexedDB; creates a guessed, unconfirmed mapping when none exists and facts are loaded. */
  load(): Promise<void>
  classOf(categoryIri: Iri | null): CategoryClass
  saveMapping(mapping: CategoryMapping): Promise<void>
  /** `opts.adopted`: MiData fields accepted in this save (they keep their badge). */
  saveCoachInputs(inputs: CoachInputs, opts?: { adopted?: readonly MidataField[]; adoptedNds?: readonly NdsField[] }): Promise<void>
}

const version = ref(0)
const mappings = shallowRef<Record<Iri, CategoryMapping | null>>({})
const inputs = shallowRef<Record<Iri, CoachInputs | null>>({})
const loadedFromDb = new Set<Iri>()

/** Adds guessed entries for categories without a stored class; un-confirms when something new appeared. */
async function ensureMapping(campIri: Iri, facts: CampFacts): Promise<void> {
  const current = mappings.value[campIri] ?? null
  const guesses = guessCategories(facts.categories, facts.activities)
  if (!current) {
    const created = mappingFromGuesses(campIri, guesses)
    await persistMapping(created)
    return
  }
  const missing = guesses.filter((g) => !(g.categoryIri in current.entries))
  if (missing.length === 0) return
  const entries = { ...current.entries }
  for (const g of missing) entries[g.categoryIri] = g.guess
  await persistMapping({ ...current, entries, confirmed: false, confirmedAt: null })
}

async function persistMapping(m: CategoryMapping): Promise<void> {
  const next = { ...m, updatedAt: new Date().toISOString() }
  await saveMapping(next)
  mappings.value = { ...mappings.value, [m.campIri]: next }
  version.value += 1
}

export function useCampSettings(campIri: MaybeRefOrGetter<Iri>): CampSettingsHandle {
  const { facts } = useCampFacts(campIri)
  const mapping = computed(() => mappings.value[toValue(campIri)] ?? null)

  async function load(): Promise<void> {
    const iri = toValue(campIri)
    if (!loadedFromDb.has(iri)) {
      const [m, i] = await Promise.all([getMapping(iri), getCoachInputs(iri)])
      mappings.value = { ...mappings.value, [iri]: m }
      inputs.value = { ...inputs.value, [iri]: i }
      loadedFromDb.add(iri)
      version.value += 1
    }
    if (facts.value) await ensureMapping(iri, facts.value)
  }

  // Facts may arrive after settings were loaded: guess the mapping then.
  watch(
    () => facts.value,
    (f) => {
      const iri = toValue(campIri)
      if (f && loadedFromDb.has(iri)) void ensureMapping(iri, f)
    },
  )

  return {
    mapping,
    coachInputs: computed(() => inputs.value[toValue(campIri)] ?? null),
    mappingConfirmed: computed(() => mapping.value?.confirmed === true),
    version: computed(() => version.value),
    load,
    classOf: (categoryIri) => classOf(mapping.value, categoryIri),
    saveMapping: persistMapping,
    async saveCoachInputs(next, opts) {
      // A manual edit removes the MiData badge; fields just adopted keep theirs.
      const cleaned = dropEditedMidataFields(inputs.value[next.campIri] ?? null, next)
      const adopted = opts?.adopted ?? []
      const midataFields = { ...(cleaned.midataFields ?? {}) }
      for (const f of adopted) if (next.midataFields?.[f]) midataFields[f] = next.midataFields[f]
      const prevInputs = inputs.value[next.campIri] ?? null
      const cleanedNds = dropEditedNdsFields(prevInputs, cleaned)
      const ndsFields = { ...(cleanedNds.ndsFields ?? {}) }
      for (const f of opts?.adoptedNds ?? []) if (next.ndsFields?.[f]) ndsFields[f] = next.ndsFields[f]
      const saved = { ...cleanedNds, midataFields, ...(next.ndsFields || cleanedNds.ndsFields ? { ndsFields } : {}), updatedAt: new Date().toISOString() }
      await saveCoachInputs(saved)
      inputs.value = { ...inputs.value, [saved.campIri]: saved }
      version.value += 1
    },
  }
}
