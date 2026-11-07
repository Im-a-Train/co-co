<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AiRephraseButton from '@/components/ai/AiRephraseButton.vue'
import { COMMENT_MAX_LENGTH, KIND_ORDER, type FeedbackLint } from '@/domain/feedback'
import { commands } from '@/lib/tauri'
import type { CampFacts, FeedbackItem, FeedbackKind } from '@/domain/types'

const props = defineProps<{
  item: FeedbackItem
  activityTitle?: string
  activityUrl?: string
  lint: FeedbackLint[]
  facts: CampFacts | null
  posting: boolean
  focused: boolean
}>()
const emit = defineEmits<{
  save: [patch: { text: string; kind: FeedbackKind }]
  remove: []
  post: []
  'mark-sent': [sent: boolean]
}>()

const { t } = useI18n()
const editing = ref(false)
const text = ref(props.item.text)
const kind = ref<FeedbackKind>(props.item.kind)

watch(
  () => props.item,
  (i) => {
    if (!editing.value) {
      text.value = i.text
      kind.value = i.kind
    }
  },
)

const KIND_COLOR: Record<FeedbackKind, string> = { kudos: 'success', must: 'error', suggestion: 'warning', question: 'info' }
const STATUS_COLOR = { draft: undefined, posted: 'primary', sent: 'success' } as const
const kindColor = computed(() => KIND_COLOR[props.item.kind])
const canPost = computed(() => props.item.scope === 'activity' && !!props.item.activityIri)

const openError = ref<string | null>(null)
async function openInEcamp() {
  if (!props.activityUrl) return
  openError.value = null
  try {
    await commands.openEcampUrl(props.activityUrl)
  } catch (e) {
    openError.value = `${t('feedback.openInEcampFailed')}: ${e instanceof Error ? e.message : String(e)}`
  }
}

function startEdit() {
  text.value = props.item.text
  kind.value = props.item.kind
  editing.value = true
}
function save() {
  emit('save', { text: text.value, kind: kind.value })
  editing.value = false
}
</script>

<template>
  <v-card variant="outlined" density="compact" :class="{ 'border-primary': focused }" :data-item-id="item.id">
    <v-card-text class="pb-2">
      <div class="d-flex flex-wrap align-center ga-2 mb-2">
        <v-chip size="small" :color="kindColor" variant="flat">{{ t(`feedback.kind.${item.kind}`) }}</v-chip>
        <v-chip size="small" variant="outlined" :title="activityUrl">
          {{ t(`feedback.scope.${item.scope}`) }}<template v-if="activityTitle">: {{ activityTitle }}</template>
        </v-chip>
        <v-chip v-if="item.ruleId" size="small" variant="text">{{ item.ruleId }}</v-chip>
        <v-chip size="small" :color="STATUS_COLOR[item.status]" variant="tonal">{{ t(`feedback.status.${item.status}`) }}</v-chip>
      </div>

      <div v-if="!editing" class="text-body-2" style="white-space: pre-wrap">{{ item.text }}</div>
      <div v-else>
        <v-btn-toggle v-model="kind" mandatory density="compact" class="mb-2" divided>
          <v-btn v-for="k in KIND_ORDER" :key="k" :value="k" size="small">{{ t(`feedback.kind.${k}`) }}</v-btn>
        </v-btn-toggle>
        <v-textarea v-model="text" :label="t('feedback.text')" auto-grow rows="2" density="compact" variant="outlined" hide-details="auto"
          :counter="canPost ? COMMENT_MAX_LENGTH : undefined" />
      </div>

      <v-alert v-if="openError" type="error" variant="tonal" density="compact" class="mt-2" :text="openError" />
      <v-alert v-for="l in lint" :key="l.code" type="warning" variant="tonal" density="compact" class="mt-2" :text="t(`feedback.lint.${l.code}`)" />
    </v-card-text>

    <v-card-actions class="pt-0 flex-wrap" style="height: auto">
      <template v-if="!editing">
        <v-btn size="small" variant="text" prepend-icon="mdi-pencil" @click="startEdit">{{ t('feedback.edit') }}</v-btn>
        <AiRephraseButton :item="item" :facts="facts" @rephrased="(txt: string) => emit('save', { text: txt, kind: item.kind })" />
        <v-btn v-if="canPost && item.status === 'draft'" size="small" variant="tonal" color="primary" prepend-icon="mdi-comment-arrow-right"
          :loading="posting" @click="emit('post')">{{ t('feedback.post') }}</v-btn>
        <v-btn v-if="item.status !== 'sent'" size="small" variant="text" prepend-icon="mdi-check" @click="emit('mark-sent', true)">{{ t('feedback.markSent') }}</v-btn>
        <v-btn v-else size="small" variant="text" @click="emit('mark-sent', false)">{{ t('feedback.markDraft') }}</v-btn>
        <v-btn v-if="activityUrl" size="small" variant="text" prepend-icon="mdi-open-in-new" data-test="open-ecamp" @click="openInEcamp">{{ t('feedback.openInEcamp') }}</v-btn>
        <v-spacer />
        <v-btn size="small" variant="text" color="error" icon="mdi-delete" :aria-label="t('feedback.delete')" @click="emit('remove')" />
      </template>
      <template v-else>
        <v-spacer />
        <v-btn size="small" variant="text" @click="editing = false">{{ t('feedback.cancel') }}</v-btn>
        <v-btn size="small" variant="flat" color="primary" @click="save">{{ t('feedback.save') }}</v-btn>
      </template>
    </v-card-actions>
  </v-card>
</template>
