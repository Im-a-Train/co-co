<script setup lang="ts">
/** «Lager wirklich bewilligen?»: lists what is still open before the camp is set to approved (local status only). */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { REVIEW_STEP_ROUTES } from '@/domain/cockpit/progress'
import type { ApprovalBlockers } from '@/domain/rounds'
import type { ReviewStatus } from '@/domain/types'

const props = defineProps<{
  modelValue: boolean
  campId: string
  blockers: ApprovalBlockers
  target: ReviewStatus
  initialNote?: string | null
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'confirm', note: string | null): void }>()
const { t } = useI18n()
const router = useRouter()

const note = ref('')
watch(
  () => props.modelValue,
  (open) => {
    if (open) note.value = props.initialNote ?? ''
  },
  { immediate: true },
)

type Tone = 'error' | 'warning'
interface Line { key: string; text: string; tone: Tone }
/** Colour = state: only an open Muss is red, the rest is orange. */
const lines = computed<Line[]>(() => {
  const b = props.blockers
  const out: Line[] = []
  if (b.openMust) out.push({ key: 'must', text: t('rounds.approve.openMust', { n: b.openMust }, b.openMust), tone: 'error' })
  if (b.mappingUnconfirmed) out.push({ key: 'mapping', text: t('rounds.approve.mapping'), tone: 'warning' })
  if (b.untriaged) out.push({ key: 'untriaged', text: t('rounds.approve.untriaged', { n: b.untriaged }, b.untriaged), tone: 'warning' })
  if (b.unsentMust) out.push({ key: 'unsentMust', text: t('rounds.approve.unsentMust', { n: b.unsentMust }, b.unsentMust), tone: 'warning' })
  if (b.unsentDrafts) out.push({ key: 'unsentDrafts', text: t('rounds.approve.unsentDrafts', { n: b.unsentDrafts }, b.unsentDrafts), tone: 'warning' })
  if (b.jsDays) out.push({ key: 'jsDays', text: t('rounds.approve.jsDays', b.jsDays), tone: 'warning' })
  return out
})

const noteRequired = computed(() => props.blockers.openMust > 0)
const canForce = computed(() => !noteRequired.value || note.value.trim() !== '')

/** First place where a blocker can be worked off. */
function reviewRoute(): { name: string; query?: Record<string, string> } {
  const b = props.blockers
  if (b.mappingUnconfirmed) return { name: REVIEW_STEP_ROUTES.mapping, query: { zuordnung: '1' } }
  if (b.openMust || b.untriaged) return { name: REVIEW_STEP_ROUTES.triage }
  if (b.unsentMust || b.unsentDrafts) return { name: REVIEW_STEP_ROUTES.feedback }
  return { name: REVIEW_STEP_ROUTES.mapping }
}
function backToReview() {
  emit('update:modelValue', false)
  const r = reviewRoute()
  void router.push({ name: r.name, params: { campId: props.campId }, query: r.query })
}
function force() {
  if (!canForce.value) return
  emit('confirm', note.value.trim() || null)
  emit('update:modelValue', false)
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="520" data-testid="approval-dialog" @update:model-value="emit('update:modelValue', $event)">
    <v-card>
      <v-card-title>{{ t('rounds.approve.title') }}</v-card-title>
      <v-card-text>
        <p class="mb-2">{{ t('rounds.approve.lead', { status: t(`reviewStatus.${target}`) }) }}</p>
        <v-list density="compact" class="pa-0 mb-3" data-testid="approval-blockers">
          <v-list-item v-for="l in lines" :key="l.key" :data-blocker="l.key" class="px-0" min-height="28">
            <template #prepend>
              <v-icon :color="l.tone" size="small" class="mr-2">{{ l.tone === 'error' ? 'mdi-alert-circle' : 'mdi-alert-outline' }}</v-icon>
            </template>
            <v-list-item-title class="text-body-2" style="white-space: normal">{{ l.text }}</v-list-item-title>
          </v-list-item>
        </v-list>
        <v-textarea
          v-model="note"
          :label="noteRequired ? t('rounds.approve.noteRequired') : t('rounds.approve.noteOptional')"
          rows="2"
          auto-grow
          variant="outlined"
          density="compact"
          hide-details
          data-testid="approval-note"
        />
        <div v-if="noteRequired" class="text-caption text-medium-emphasis mt-1">{{ t('rounds.approve.noteHint') }}</div>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" :disabled="!canForce" data-testid="approval-force" @click="force">{{ t('rounds.approve.anyway') }}</v-btn>
        <v-spacer />
        <v-btn variant="flat" color="primary" data-testid="approval-back" @click="backToReview">{{ t('rounds.approve.back') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
