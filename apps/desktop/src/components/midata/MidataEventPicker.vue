<script setup lang="ts">
/** «Anlass wählen»: MiData camps around the eCamp camp dates (±14 days, all visible organisations). */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MidataEventSummary } from '@/domain/types'
import { searchedCampDays } from '@/composables/useMidata'
import { formatDate } from './format'

const props = defineProps<{ modelValue: boolean; events: MidataEventSummary[]; loading: boolean; error: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; pick: [id: string] }>()
const { t } = useI18n()

const filter = ref('')
const manualId = ref('')

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      filter.value = ''
      manualId.value = ''
    }
  },
)

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return props.events
  return props.events.filter((e) => [e.name, ...(e.groupNames ?? [])].some((s) => s.toLowerCase().includes(q)))
})

const manualTrimmed = computed(() => manualId.value.trim())
const manualValid = computed(() => /^\d{1,12}$/.test(manualTrimmed.value))
const manualError = computed(() => (manualTrimmed.value !== '' && !manualValid.value ? t('midata.picker.manualInvalid') : ''))

function submitManual(): void {
  if (manualValid.value) emit('pick', manualTrimmed.value)
}

function dates(e: MidataEventSummary): string {
  if (!e.startAt) return t('midata.picker.noDates')
  return e.finishAt && e.finishAt !== e.startAt ? `${formatDate(e.startAt)} – ${formatDate(e.finishAt)}` : formatDate(e.startAt)
}

function organisation(e: MidataEventSummary): string {
  return e.groupNames && e.groupNames.length > 0 ? e.groupNames.join(', ') : t('midata.picker.noGroups')
}

type Chip = { text: string; color: string }
function chip(e: MidataEventSummary): Chip | null {
  const n = e.overlapDays
  if (n === null || n === undefined) return null
  if (n <= 0) return { text: t('midata.picker.noOverlap'), color: 'default' }
  if (searchedCampDays.value !== null && n >= searchedCampDays.value) return { text: t('midata.picker.exact'), color: 'success' }
  return { text: t('midata.picker.overlap', n), color: 'warning' }
}
</script>

<template>
  <v-dialog :model-value="modelValue" scroll-strategy="none" max-width="680" @update:model-value="emit('update:modelValue', $event)">
    <v-card data-testid="midata-picker">
      <v-card-title>{{ t('midata.picker.title') }}</v-card-title>
      <v-card-text>
        <p class="text-medium-emphasis mb-3" data-testid="midata-picker-hint">{{ t('midata.picker.intro') }}</p>
        <div v-if="loading" class="text-center pa-4">
          <v-progress-circular indeterminate size="24" class="mr-2" />{{ t('midata.picker.loading') }}
        </div>
        <v-alert v-else-if="error" type="error" variant="tonal" density="compact">{{ t('midata.picker.failed') }}: {{ error }}</v-alert>
        <div v-else-if="events.length === 0" class="text-medium-emphasis">{{ t('midata.picker.empty') }}</div>
        <template v-else>
          <v-text-field
            v-model="filter"
            :label="t('midata.picker.filter')"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            class="mb-2"
            data-testid="midata-picker-filter"
          />
          <div v-if="filtered.length === 0" class="text-medium-emphasis pa-2">{{ t('midata.picker.emptyFiltered') }}</div>
          <v-list v-else density="compact" lines="three" style="max-height: 340px; overflow-y: auto">
            <v-list-item v-for="e in filtered" :key="e.id" :data-testid="`midata-event-${e.id}`" @click="emit('pick', e.id)">
              <v-list-item-title>{{ e.name }}</v-list-item-title>
              <v-list-item-subtitle>{{ [dates(e), e.location].filter(Boolean).join(' · ') }}</v-list-item-subtitle>
              <v-list-item-subtitle :data-testid="`midata-event-org-${e.id}`">{{ organisation(e) }}</v-list-item-subtitle>
              <template v-if="chip(e)" #append>
                <v-chip size="small" :color="chip(e)!.color" variant="tonal" :data-testid="`midata-event-chip-${e.id}`">{{ chip(e)!.text }}</v-chip>
              </template>
            </v-list-item>
          </v-list>
        </template>

        <v-divider class="my-3" />
        <div class="text-subtitle-2 mb-1">{{ t('midata.picker.manualTitle') }}</div>
        <div class="d-flex align-start ga-2">
          <v-text-field
            v-model="manualId"
            :label="t('midata.picker.manualLabel')"
            :hint="t('midata.picker.manualHint')"
            :error-messages="manualError"
            inputmode="numeric"
            density="compact"
            variant="outlined"
            persistent-hint
            data-testid="midata-manual-id"
            @keydown.enter.prevent="submitManual"
          />
          <v-btn :disabled="!manualValid" color="primary" class="mt-1" data-testid="midata-manual-apply" @click="submitManual">
            {{ t('midata.picker.manualApply') }}
          </v-btn>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="emit('update:modelValue', false)">{{ t('common.cancel') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
