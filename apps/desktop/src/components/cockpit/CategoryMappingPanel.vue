<script setup lang="ts">
/**
 * Category -> LS/LA/LP/ES/NONE mapping, confirm once. Shown inside the GP view: as the first card while the mapping is
 * unconfirmed, folded to one line afterwards (the view owns the folding).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { buildMappingRows, mappingDirty, MAPPING_CLASSES } from '@/components/camps/mappingRows'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampRoute } from '@/composables/useCampRoute'
import { useCampSettings } from '@/composables/useCampSettings'
import type { FindingsHandle } from '@/composables/useFindings'
import { guessCategories } from '@/domain/campFacts'
import type { CategoryClass, Iri } from '@/domain/types'

/** Unconfirmed edits of a confirmed mapping per camp (in memory only): they survive switching tabs, not a restart. */
const pendingDrafts = new Map<string, Record<Iri, CategoryClass>>()

const props = defineProps<{ findingsHandle?: FindingsHandle }>()
const emit = defineEmits<{ confirmed: []; dirty: [value: boolean] }>()

const { t } = useI18n()
const { campIri } = useCampRoute()
const { facts, loading, error, load: loadFacts } = useCampFacts(campIri)
const settings = useCampSettings(campIri)

const draft = ref<Record<Iri, CategoryClass>>({})
const saving = ref(false)
const saveError = ref<string | null>(null)

async function init(): Promise<void> {
  await loadFacts()
  await settings.load()
}
onMounted(() => void init())
watch(campIri, () => void init())

// Sync the draft with the stored mapping whenever it changes (load, guess, confirm).
watch(
  () => settings.mapping.value,
  (m) => {
    draft.value = { ...(m ? (pendingDrafts.get(campIri.value) ?? m.entries) : {}) }
  },
  { immediate: true },
)

const guesses = computed(() => (facts.value ? guessCategories(facts.value.categories, facts.value.activities) : []))
const rows = computed(() =>
  facts.value ? buildMappingRows(facts.value.categories, facts.value.activities, guesses.value, draft.value) : [],
)
const dirty = computed(() => mappingDirty(settings.mapping.value, draft.value))
const confirmed = computed(() => settings.mappingConfirmed.value)
/** An edit of a confirmed mapping that is not yet confirmed. */
const pendingChange = computed(() => confirmed.value && dirty.value)
// Remember the pending edit (once the stored mapping is loaded), forget it as soon as nothing is pending.
watch([pendingChange, draft], () => {
  if (!settings.mapping.value) return
  if (pendingChange.value) pendingDrafts.set(campIri.value, { ...draft.value })
  else pendingDrafts.delete(campIri.value)
})
watch(pendingChange, (v) => emit('dirty', v), { immediate: true })
const canConfirm = computed(() => rows.value.length > 0 && (!confirmed.value || dirty.value))
const options = MAPPING_CLASSES.map((c) => ({ value: c, title: t(`camps.mapping.class.${c}`) }))

function setClass(iri: Iri, c: CategoryClass): void {
  draft.value = { ...draft.value, [iri]: c }
}

function discard(): void {
  pendingDrafts.delete(campIri.value)
  draft.value = { ...(settings.mapping.value?.entries ?? {}) }
}

function currentEntries(): Record<Iri, CategoryClass> {
  return Object.fromEntries(rows.value.map((r) => [r.iri, r.selected])) as Record<Iri, CategoryClass>
}

async function confirm(): Promise<void> {
  const m = settings.mapping.value
  if (!m) return
  saving.value = true
  saveError.value = null
  try {
    pendingDrafts.delete(campIri.value)
    await settings.saveMapping({ ...m, entries: currentEntries(), confirmed: true, confirmedAt: new Date().toISOString() })
    emit('confirmed')
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

// ---- What-if: valid J+S days with the draft mapping ---------------------------------------------------------
const effect = computed(() => {
  const m = settings.mapping.value
  const handle = props.findingsHandle
  if (!m || !handle || rows.value.length === 0) return null
  const model = handle.jsModelFor({ ...m, entries: currentEntries(), confirmed: true })
  if (!model) return null
  return { valid: model.jsDayCount, total: model.days.length - (model.endDaysMode === 'combined' ? 1 : 0) }
})

// ---- «Regeln prüfen»: category exclusion for all rules --------------------------------------------------------
const excludedIris = computed(
  () => new Set((props.findingsHandle?.categoryExclusions.value ?? []).filter((e) => e.ruleId === null).map((e) => e.categoryIri)),
)
async function setChecked(iri: Iri, on: boolean): Promise<void> {
  const handle = props.findingsHandle
  if (!handle) return
  saveError.value = null
  try {
    if (on) await handle.includeCategory(iri, null)
    else await handle.excludeCategory(iri, null)
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <div>
    <p class="text-body-2 text-medium-emphasis mb-3">{{ t('camps.mapping.intro') }}</p>

    <v-alert
      v-if="!confirmed"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-3"
      data-testid="mapping-inactive"
    >
      <strong>{{ t('camps.mapping.inactiveTitle') }}.</strong>
      {{ t('camps.mapping.inactiveText') }}
    </v-alert>
    <v-alert
      v-else-if="pendingChange"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-3"
      data-testid="mapping-dirty"
    >
      <strong>{{ t('camps.mapping.dirtyTitle') }}.</strong>
      {{ t('camps.mapping.dirtyText') }}
    </v-alert>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-3">
      <div>{{ t('camps.mapping.failed') }}</div>
      <div class="text-caption">{{ error }}</div>
      <template #append>
        <v-btn variant="text" @click="loadFacts(true)">{{ t('common.retry') }}</v-btn>
      </template>
    </v-alert>
    <v-alert v-if="saveError" type="error" variant="tonal" class="mb-3">{{ t('camps.mapping.saveFailed') }}: {{ saveError }}</v-alert>

    <div v-if="loading && !facts" class="text-center pa-8">
      <v-progress-circular indeterminate class="mb-2" />
      <div class="text-medium-emphasis">{{ t('camps.mapping.loading') }}</div>
    </div>
    <div v-else-if="facts && rows.length === 0" class="text-medium-emphasis">{{ t('camps.mapping.empty') }}</div>

    <template v-else-if="facts">
      <v-table density="compact" data-testid="mapping-table">
        <thead>
          <tr>
            <th>{{ t('camps.mapping.columns.category') }}</th>
            <th class="text-right">{{ t('camps.mapping.columns.activities') }}</th>
            <th style="min-width: 300px">{{ t('camps.mapping.columns.class') }}</th>
            <th v-if="findingsHandle" class="text-center" :title="t('camps.mapping.checkCaption')">
              {{ t('camps.mapping.columns.check') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.iri" data-testid="mapping-row">
            <td class="py-1">
              <span class="d-inline-block rounded-circle mr-2" :style="{ width: '12px', height: '12px', background: r.color }" aria-hidden="true" />
              <strong>{{ r.short }}</strong> {{ r.name }}
              <div
                class="text-caption ml-5"
                :class="r.confidence === 'low' && !confirmed ? 'text-warning' : 'text-medium-emphasis'"
                data-testid="mapping-reason"
              >
                {{ t(`camps.mapping.reason.${r.reason ?? 'none'}`) }}
              </div>
            </td>
            <td class="text-right">{{ r.activityCount }}</td>
            <td>
              <v-select
                :model-value="r.selected"
                :items="options"
                density="compact"
                variant="outlined"
                hide-details
                :aria-label="`${t('camps.mapping.columns.class')}: ${r.name}`"
                @update:model-value="(v: CategoryClass) => setClass(r.iri, v)"
              />
            </td>
            <td v-if="findingsHandle" class="text-center">
              <v-switch
                :model-value="!excludedIris.has(r.iri)"
                density="compact"
                color="primary"
                hide-details
                inset
                class="d-inline-flex"
                data-testid="mapping-check"
                :aria-label="t('camps.mapping.checkOn', { name: r.name })"
                @update:model-value="(v: boolean | null) => setChecked(r.iri, v === true)"
              />
            </td>
          </tr>
        </tbody>
      </v-table>
      <div v-if="findingsHandle" class="text-caption text-medium-emphasis mt-1">{{ t('camps.mapping.checkCaption') }}</div>

      <!-- A confirmed mapping without changes has nothing to confirm: the actions appear with the first change. -->
      <div v-if="!confirmed || pendingChange" class="d-flex align-center flex-wrap ga-3 mt-3">
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!canConfirm"
          :loading="saving"
          data-testid="mapping-confirm"
          @click="confirm"
        >
          {{ confirmed ? t('camps.mapping.confirmChanges') : t('camps.mapping.confirm') }}
        </v-btn>
        <v-btn v-if="pendingChange" variant="text" data-testid="mapping-discard" @click="discard">
          {{ t('camps.mapping.discard') }}
        </v-btn>
        <span v-if="effect" class="text-body-2" data-testid="mapping-effect">
          {{ t('camps.mapping.effect', effect) }}
        </span>
      </div>
    </template>
  </div>
</template>
