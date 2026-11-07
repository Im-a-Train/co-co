<script setup lang="ts">
/** «Anlass wählen»: MiData camps within the eCamp camp dates. */
import { useI18n } from 'vue-i18n'
import type { MidataEventSummary } from '@/domain/types'
import { formatDate } from './format'

defineProps<{ modelValue: boolean; events: MidataEventSummary[]; loading: boolean; error: string | null }>()
defineEmits<{ 'update:modelValue': [value: boolean]; pick: [id: string] }>()
const { t } = useI18n()

function dates(e: MidataEventSummary): string {
  if (!e.startAt) return t('midata.picker.noDates')
  return e.finishAt && e.finishAt !== e.startAt ? `${formatDate(e.startAt)} – ${formatDate(e.finishAt)}` : formatDate(e.startAt)
}
</script>

<template>
  <v-dialog :model-value="modelValue" scroll-strategy="none" max-width="640" @update:model-value="$emit('update:modelValue', $event)">
    <v-card data-testid="midata-picker">
      <v-card-title>{{ t('midata.picker.title') }}</v-card-title>
      <v-card-text>
        <p class="text-medium-emphasis mb-3">{{ t('midata.picker.intro') }}</p>
        <div v-if="loading" class="text-center pa-4">
          <v-progress-circular indeterminate size="24" class="mr-2" />{{ t('midata.picker.loading') }}
        </div>
        <v-alert v-else-if="error" type="error" variant="tonal" density="compact">{{ t('midata.picker.failed') }}: {{ error }}</v-alert>
        <div v-else-if="events.length === 0" class="text-medium-emphasis">{{ t('midata.picker.empty') }}</div>
        <v-list v-else density="compact" lines="two">
          <v-list-item
            v-for="e in events"
            :key="e.id"
            :title="e.name"
            :subtitle="[dates(e), e.location].filter(Boolean).join(' · ')"
            :data-testid="`midata-event-${e.id}`"
            @click="$emit('pick', e.id)"
          />
        </v-list>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="$emit('update:modelValue', false)">{{ t('common.cancel') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
