<script setup lang="ts">
/** Category -> LS/LA/LP/ES/NONE mapping, confirm once. Shown inside the GP view (collapsible section). */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { buildMappingRows, mappingDirty, MAPPING_CLASSES } from '@/components/camps/mappingRows'
import { formatIsoDate } from '@/components/camps/campRows'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampRoute } from '@/composables/useCampRoute'
import { useCampSettings } from '@/composables/useCampSettings'
import { guessCategories } from '@/domain/campFacts'
import type { CategoryClass, Iri } from '@/domain/types'

const { t } = useI18n()
const { campIri } = useCampRoute()
const { facts, loading, error, load: loadFacts } = useCampFacts(campIri)
const settings = useCampSettings(campIri)

const draft = ref<Record<Iri, CategoryClass>>({})
const saving = ref(false)
const saveError = ref<string | null>(null)
const justSaved = ref(false)

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
    draft.value = { ...(m?.entries ?? {}) }
  },
  { immediate: true },
)

const guesses = computed(() => (facts.value ? guessCategories(facts.value.categories, facts.value.activities) : []))
const rows = computed(() =>
  facts.value ? buildMappingRows(facts.value.categories, facts.value.activities, guesses.value, draft.value) : [],
)
const dirty = computed(() => mappingDirty(settings.mapping.value, draft.value))
const confirmed = computed(() => settings.mappingConfirmed.value)
const canConfirm = computed(() => rows.value.length > 0 && (!confirmed.value || dirty.value))
const options = MAPPING_CLASSES.map((c) => ({ value: c, title: t(`camps.mapping.class.${c}`) }))

function setClass(iri: Iri, c: CategoryClass): void {
  draft.value = { ...draft.value, [iri]: c }
  justSaved.value = false
}

async function confirm(): Promise<void> {
  const m = settings.mapping.value
  if (!m) return
  saving.value = true
  saveError.value = null
  try {
    const entries = Object.fromEntries(rows.value.map((r) => [r.iri, r.selected])) as Record<Iri, CategoryClass>
    await settings.saveMapping({ ...m, entries, confirmed: true, confirmedAt: new Date().toISOString() })
    justSaved.value = true
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <p class="text-medium-emphasis mb-4">{{ t('camps.mapping.intro') }}</p>

    <v-alert v-if="confirmed" type="success" variant="tonal" class="mb-4" data-testid="mapping-confirmed">
      <strong>{{ t('camps.mapping.confirmedTitle') }}.</strong>
      {{ t('camps.mapping.confirmedText', { date: formatIsoDate(settings.mapping.value?.confirmedAt) }) }}
    </v-alert>
    <v-alert v-else type="warning" variant="tonal" class="mb-4" data-testid="mapping-inactive">
      <strong>{{ t('camps.mapping.inactiveTitle') }}.</strong>
      {{ t('camps.mapping.inactiveText') }}
    </v-alert>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">
      <div>{{ t('camps.mapping.failed') }}</div>
      <div class="text-caption">{{ error }}</div>
      <template #append>
        <v-btn variant="text" @click="loadFacts(true)">{{ t('common.retry') }}</v-btn>
      </template>
    </v-alert>
    <v-alert v-if="saveError" type="error" variant="tonal" class="mb-4">{{ t('camps.mapping.saveFailed') }}: {{ saveError }}</v-alert>

    <div v-if="loading && !facts" class="text-center pa-8">
      <v-progress-circular indeterminate class="mb-2" />
      <div class="text-medium-emphasis">{{ t('camps.mapping.loading') }}</div>
    </div>
    <div v-else-if="facts && rows.length === 0" class="text-medium-emphasis">{{ t('camps.mapping.empty') }}</div>

    <template v-else-if="facts">
      <v-table data-testid="mapping-table">
        <thead>
          <tr>
            <th>{{ t('camps.mapping.columns.category') }}</th>
            <th class="text-right">{{ t('camps.mapping.columns.activities') }}</th>
            <th>{{ t('camps.mapping.columns.guess') }}</th>
            <th style="min-width: 220px">{{ t('camps.mapping.columns.class') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.iri" data-testid="mapping-row">
            <td>
              <span class="d-inline-block rounded-circle mr-2" :style="{ width: '12px', height: '12px', background: r.color }" aria-hidden="true" />
              <strong>{{ r.short }}</strong> {{ r.name }}
            </td>
            <td class="text-right">{{ r.activityCount }}</td>
            <td>
              <template v-if="r.guess">
                {{ t(`camps.mapping.class.${r.guess}`) }}
                <v-chip size="x-small" class="ml-1" :color="r.confidence === 'high' ? 'success' : 'warning'" variant="tonal">
                  {{ t(`camps.mapping.confidence.${r.confidence}`) }}
                </v-chip>
              </template>
              <span v-else class="text-medium-emphasis">{{ t('camps.mapping.noGuess') }}</span>
            </td>
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
          </tr>
        </tbody>
      </v-table>

      <div class="d-flex align-center ga-3 mt-4">
        <v-btn color="primary" :disabled="!canConfirm" :loading="saving" data-testid="mapping-confirm" @click="confirm">
          {{ confirmed ? t('camps.mapping.confirmChanges') : t('camps.mapping.confirm') }}
        </v-btn>
        <span v-if="justSaved" class="text-success">{{ t('camps.mapping.confirmed') }}</span>
      </div>
    </template>
  </div>
</template>
