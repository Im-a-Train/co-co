<script setup lang="ts">
/** Review status workflow: stepper over the happy path + buttons for allowed transitions. OWNER: rounds builder. */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { REVIEW_TRANSITIONS } from '@/domain/rounds'
import type { ReviewState, ReviewStatus } from '@/domain/types'

const props = defineProps<{ review: ReviewState | null }>()
const emit = defineEmits<{ (e: 'set', status: ReviewStatus, note: string | null): void }>()
const { t, d } = useI18n()

const note = ref('')
const current = computed<ReviewStatus>(() => props.review?.status ?? 'neu')
const allowed = computed(() => REVIEW_TRANSITIONS[current.value])

/** Steps of the workflow; the last step is either approval variant. */
const steps = computed<ReviewStatus[]>(() => [
  'neu',
  'in_review',
  'aenderungen_angefragt',
  current.value === 'bewilligt_mit_auflagen' ? 'bewilligt_mit_auflagen' : 'bewilligt',
])
const activeIndex = computed(() => {
  const i = steps.value.indexOf(current.value)
  return i < 0 ? 0 : i
})

function color(s: ReviewStatus): string {
  if (s === 'bewilligt') return 'success'
  if (s === 'bewilligt_mit_auflagen') return 'warning'
  if (s === 'aenderungen_angefragt') return 'warning'
  return 'primary'
}
function setTo(s: ReviewStatus) {
  emit('set', s, note.value.trim() || null)
  note.value = ''
}
</script>

<template>
  <v-card variant="outlined">
    <v-card-title class="text-subtitle-1">{{ t('rounds.status.title') }}</v-card-title>
    <v-card-text>
      <div class="d-flex flex-wrap align-center ga-2 mb-4">
        <template v-for="(s, i) in steps" :key="s">
          <v-icon v-if="i > 0" size="small" color="medium-emphasis">mdi-chevron-right</v-icon>
          <v-chip
            :color="i === activeIndex ? color(s) : undefined"
            :variant="i === activeIndex ? 'flat' : 'outlined'"
            :prepend-icon="i < activeIndex ? 'mdi-check' : undefined"
            size="small"
          >
            {{ t(`reviewStatus.${s}`) }}
          </v-chip>
        </template>
      </div>

      <div class="text-caption text-medium-emphasis mb-1">{{ t('rounds.status.setTo') }}</div>
      <div v-if="allowed.length" class="d-flex flex-wrap ga-2 mb-2">
        <v-btn
          v-for="s in allowed"
          :key="s"
          size="small"
          variant="tonal"
          :color="color(s)"
          @click="setTo(s)"
        >
          {{ t(`reviewStatus.${s}`) }}
        </v-btn>
      </div>
      <div v-else class="text-body-2 mb-2">{{ t('rounds.status.noTransitions') }}</div>
      <v-text-field v-model="note" :label="t('rounds.status.noteLabel')" density="compact" hide-details variant="outlined" />

      <template v-if="review && review.history.length">
        <div class="text-caption text-medium-emphasis mt-4 mb-1">{{ t('rounds.status.history') }}</div>
        <v-list density="compact" class="pa-0">
          <v-list-item v-for="(h, i) in [...review.history].reverse()" :key="i" class="px-0" min-height="28">
            <v-list-item-title class="text-body-2">
              {{ t(`reviewStatus.${h.status}`) }}
              <span class="text-medium-emphasis">· {{ d(new Date(h.at), 'dateTime') }}</span>
            </v-list-item-title>
            <v-list-item-subtitle v-if="h.note">{{ h.note }}</v-list-item-subtitle>
          </v-list-item>
        </v-list>
      </template>
    </v-card-text>
  </v-card>
</template>
