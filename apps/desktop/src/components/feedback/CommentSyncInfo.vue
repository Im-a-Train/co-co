<script setup lang="ts">
/** Comment-sync chips of a posted feedback item: resolved, replies (expandable), missing. Replies render as plain text. */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { newReplies } from '@/domain/feedback/commentSync'
import type { FeedbackItem } from '@/domain/types'

const props = defineProps<{ item: FeedbackItem }>()
const emit = defineEmits<{ seen: [] }>()

const { t } = useI18n()
const sync = computed(() => props.item.commentSync)
const unseen = computed(() => new Set(newReplies(sync.value).map((r) => r.iri)))
const open = ref(false)

function date(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function toggle() {
  open.value = !open.value
  if (open.value && unseen.value.size > 0) emit('seen')
}
</script>

<template>
  <div v-if="sync" data-testid="comment-sync" class="mt-2">
    <div class="d-flex flex-wrap align-center ga-2">
      <v-chip v-if="sync.resolvedAt" size="small" color="success" variant="tonal" prepend-icon="mdi-check-circle" data-testid="chip-resolved"
        :title="t('feedback.sync.resolvedOn', { date: date(sync.resolvedAt) })">
        {{ t('feedback.sync.resolved') }}<template v-if="date(sync.resolvedAt)"> ({{ date(sync.resolvedAt) }})</template>
      </v-chip>
      <v-chip v-if="sync.missing" size="small" color="warning" variant="tonal" prepend-icon="mdi-alert" data-testid="chip-missing">
        {{ t('feedback.sync.missing') }}
      </v-chip>
      <v-chip v-if="sync.replies.length > 0" size="small" :color="unseen.size > 0 ? 'primary' : undefined"
        :variant="unseen.size > 0 ? 'flat' : 'tonal'" prepend-icon="mdi-comment-text-multiple" data-testid="chip-replies" @click="toggle">
        {{ t('feedback.sync.replies', sync.replies.length) }}
        <template v-if="unseen.size > 0"> · {{ t('feedback.sync.newBadge') }}</template>
        <v-icon end :icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'" />
      </v-chip>
    </div>
    <div v-if="open" class="mt-2 d-flex flex-column ga-2" data-testid="reply-list">
      <v-sheet v-for="r in sync.replies" :key="r.iri" rounded border class="pa-2" data-testid="reply">
        <div class="text-caption text-medium-emphasis d-flex flex-wrap ga-2 align-center">
          <span>{{ r.authorDisplayName ?? t('feedback.sync.unknownAuthor') }}</span>
          <span v-if="date(r.createTime)">{{ date(r.createTime) }}</span>
          <v-chip v-if="r.inferred" size="x-small" variant="outlined">{{ t('feedback.sync.likelyReply') }}</v-chip>
        </div>
        <div class="text-body-2" style="white-space: pre-wrap">{{ r.text }}</div>
      </v-sheet>
    </div>
  </div>
</template>
