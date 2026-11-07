<script setup lang="ts">
/** «Lager wählen»: NDS camps within the eCamp camp dates. */
import { useI18n } from 'vue-i18n'
import { formatDate } from '@/components/midata/format'
import { ndsStateLabel } from '@/domain/nds'
import type { NdsCampSummary } from '@/domain/types'

defineProps<{ modelValue: boolean; camps: NdsCampSummary[]; loading: boolean; error: string | null }>()
defineEmits<{ 'update:modelValue': [value: boolean]; pick: [camp: NdsCampSummary] }>()
const { t } = useI18n()

function title(c: NdsCampSummary): string {
  return [c.offerNumber, c.offerItemNumber, c.groupName].filter(Boolean).join(' · ') || c.campBusinessId
}
function subtitle(c: NdsCampSummary): string {
  const dates = c.start ? (c.end && c.end !== c.start ? `${formatDate(c.start)} – ${formatDate(c.end)}` : formatDate(c.start)) : t('nds.picker.noDates')
  const state = c.offerItemState ?? c.offerState
  return [dates, state ? ndsStateLabel(state) : ''].filter(Boolean).join(' · ')
}
</script>

<template>
  <v-dialog :model-value="modelValue" scroll-strategy="none" max-width="640" @update:model-value="$emit('update:modelValue', $event)">
    <v-card data-testid="nds-picker">
      <v-card-title>{{ t('nds.picker.title') }}</v-card-title>
      <v-card-text>
        <p class="text-medium-emphasis mb-3">{{ t('nds.picker.intro') }}</p>
        <div v-if="loading" class="text-center pa-4">
          <v-progress-circular indeterminate size="24" class="mr-2" />{{ t('nds.picker.loading') }}
        </div>
        <v-alert v-else-if="error" type="error" variant="tonal" density="compact">{{ t('nds.picker.failed') }}: {{ error }}</v-alert>
        <div v-else-if="camps.length === 0" class="text-medium-emphasis">{{ t('nds.picker.empty') }}</div>
        <v-list v-else density="compact" lines="two">
          <v-list-item
            v-for="c in camps"
            :key="c.campBusinessId"
            :title="title(c)"
            :subtitle="subtitle(c)"
            :data-testid="`nds-camp-${c.campBusinessId}`"
            @click="$emit('pick', c)"
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
