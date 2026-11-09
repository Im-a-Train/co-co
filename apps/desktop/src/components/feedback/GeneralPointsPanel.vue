<script setup lang="ts">
/** Default general feedback points ("Standard-Themen"): one row each; "Übernehmen" creates a camp-scope item. */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GENERAL_POINTS, usedGeneralPointIds } from '@/domain/feedback/defaults'
import type { FeedbackItem } from '@/domain/types'

const props = defineProps<{ items: FeedbackItem[] }>()
const emit = defineEmits<{ take: [pointId: string] }>()

const { t } = useI18n()
const used = computed(() => usedGeneralPointIds(props.items))
const doneCount = computed(() => GENERAL_POINTS.filter((p) => used.value.has(p.id)).length)
const open = ref<Record<string, boolean>>({})
</script>

<template>
  <v-card variant="outlined" data-testid="feedback-general-points">
    <v-card-title class="text-subtitle-1 d-flex align-center">
      {{ t('feedback.generalPoints.title') }}
      <v-spacer />
      <span class="text-caption text-medium-emphasis">{{ t('feedback.generalPoints.progress', { done: doneCount, total: GENERAL_POINTS.length }) }}</span>
    </v-card-title>
    <v-card-subtitle class="text-wrap">{{ t('feedback.generalPoints.hint') }}</v-card-subtitle>
    <v-list density="compact" lines="two">
      <template v-for="p in GENERAL_POINTS" :key="p.id">
        <v-list-item :data-testid="`feedback-general-point-${p.id}`" :data-done="used.has(p.id) ? '1' : '0'">
          <template #prepend>
            <v-icon :icon="used.has(p.id) ? 'mdi-check-circle' : 'mdi-circle-outline'" :color="used.has(p.id) ? 'success' : undefined" />
          </template>
          <v-list-item-title class="text-wrap">{{ t(p.titleKey) }}</v-list-item-title>
          <v-list-item-subtitle class="text-wrap">{{ t(p.promptKey) }}</v-list-item-subtitle>
          <div v-if="open[p.id]" class="mt-1">
            <ul class="text-caption ps-4">
              <li v-for="c in p.checks" :key="c">{{ t(c) }}</li>
            </ul>
            <div v-if="p.ruleIds?.length || p.checklistIds?.length" class="text-caption text-medium-emphasis mt-1">
              {{ t('feedback.generalPoints.related', { ids: [...(p.ruleIds ?? []), ...(p.checklistIds ?? [])].join(', ') }) }}
            </div>
          </div>
          <template #append>
            <v-btn size="x-small" variant="text" :icon="open[p.id] ? 'mdi-chevron-up' : 'mdi-chevron-down'"
              :aria-label="open[p.id] ? t('feedback.generalPoints.hideChecks') : t('feedback.generalPoints.showChecks')"
              @click="open[p.id] = !open[p.id]" />
            <v-btn v-if="!used.has(p.id)" size="small" variant="tonal" color="primary" :data-testid="`feedback-take-${p.id}`"
              @click="emit('take', p.id)">{{ t('feedback.generalPoints.take') }}</v-btn>
            <v-chip v-else size="small" color="success" variant="tonal">{{ t('feedback.generalPoints.done') }}</v-chip>
          </template>
        </v-list-item>
      </template>
    </v-list>
  </v-card>
</template>
