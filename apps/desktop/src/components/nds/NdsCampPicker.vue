<script setup lang="ts">
/**
 * «Lager wählen»: NDS camps within the eCamp camp dates. With `rankCamp` the candidates are sorted by match
 * (reason chips, «Vorschlag» badge on the suggested one); the coach still has to click.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate } from '@/components/midata/format'
import { ndsStateLabel } from '@/domain/nds'
import { rankNdsCamps, type NdsMatchCamp } from '@/domain/nds/match'
import type { NdsCampSummary } from '@/domain/types'

const props = defineProps<{
  modelValue: boolean
  camps: NdsCampSummary[]
  loading: boolean
  error: string | null
  rankCamp?: NdsMatchCamp
  orgNames?: string[]
}>()
defineEmits<{ 'update:modelValue': [value: boolean]; pick: [camp: NdsCampSummary] }>()
const { t } = useI18n()

/** Display order: ranked when the eCamp camp is known, else as delivered. */
const items = computed(() => {
  if (!props.rankCamp) return props.camps.map((camp) => ({ camp, reasons: [] as string[], suggested: false }))
  return rankNdsCamps(props.rankCamp, props.camps, props.orgNames ?? []).map((r) => ({ camp: r.camp, reasons: r.reasons as string[], suggested: r.suggested }))
})

function title(c: NdsCampSummary): string {
  return [c.offerNumber, c.offerItemNumber, c.groupName].filter(Boolean).join(' · ') || c.campBusinessId
}
function subtitle(c: NdsCampSummary): string {
  const dates = c.start ? (c.end && c.end !== c.start ? `${formatDate(c.start)} – ${formatDate(c.end)}` : formatDate(c.start)) : t('nds.picker.noDates')
  const state = c.offerItemState ?? c.offerState
  return [dates, c.organisationName, state ? ndsStateLabel(state) : ''].filter(Boolean).join(' · ')
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
            v-for="it in items"
            :key="it.camp.campBusinessId"
            :title="title(it.camp)"
            :subtitle="subtitle(it.camp)"
            :data-testid="`nds-camp-${it.camp.campBusinessId}`"
            @click="$emit('pick', it.camp)"
          >
            <template v-if="it.suggested || it.reasons.length" #append>
              <div class="d-flex flex-wrap justify-end ga-1 ml-2">
                <v-chip v-if="it.suggested" size="x-small" color="primary" variant="flat" label data-testid="nds-suggested">{{ t('nds.picker.suggested') }}</v-chip>
                <v-chip v-for="r in it.reasons" :key="r" size="x-small" variant="tonal" label data-testid="nds-reason">{{ t(`nds.picker.reason.${r}`) }}</v-chip>
              </div>
            </template>
          </v-list-item>
        </v-list>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="$emit('update:modelValue', false)">{{ t('common.cancel') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
