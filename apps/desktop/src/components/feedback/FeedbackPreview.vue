<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { copyText } from '@/lib/clipboard'
import { renderFeedback, TEMPLATE_IDS, type RenderContext } from '@/domain/feedback'
import type { FeedbackChannel, FeedbackItem, FeedbackTemplateId } from '@/domain/types'

const props = defineProps<{ items: FeedbackItem[]; context: Omit<RenderContext, 'templateId'> }>()
const { t } = useI18n()

const channel = ref<FeedbackChannel>('whatsapp')
const templateId = ref<FeedbackTemplateId | null>(null)
const includeLinks = ref(true)
const notice = ref<string | null>(null)

const rendered = computed(() =>
  renderFeedback(props.items, channel.value, { ...props.context, templateId: templateId.value ?? undefined, includeLinks: includeLinks.value }),
)

async function copy(text: string) {
  notice.value = (await copyText(text)) ? t('feedback.copied') : t('feedback.copyFailed')
}
</script>

<template>
  <v-card variant="outlined">
    <v-card-title class="text-subtitle-1">{{ t('feedback.preview') }}</v-card-title>
    <v-card-text>
      <v-select
        v-model="templateId"
        :items="[{ title: t('feedback.noTemplate'), value: null }, ...TEMPLATE_IDS.map((id) => ({ title: t(`feedback.templates.${id}`), value: id }))]"
        :label="t('feedback.template')"
        density="compact"
        variant="outlined"
        hide-details
        class="mb-3"
      />
      <v-switch v-model="includeLinks" :label="t('feedback.includeLinks')" density="compact" color="primary" hide-details class="mb-2" />
      <v-tabs v-model="channel" density="compact" class="mb-3">
        <v-tab v-for="c in (['whatsapp', 'email', 'plain'] as const)" :key="c" :value="c">{{ t(`feedback.channel.${c}`) }}</v-tab>
      </v-tabs>

      <div v-if="rendered.subject !== null" class="mb-2">
        <div class="text-caption text-medium-emphasis">{{ t('feedback.subject') }}</div>
        <div class="d-flex align-center">
          <div class="font-weight-medium flex-grow-1">{{ rendered.subject }}</div>
          <v-btn size="x-small" variant="text" icon="mdi-content-copy" :aria-label="t('feedback.copy')" @click="copy(rendered.subject ?? '')" />
        </div>
      </div>
      <v-sheet border rounded class="pa-3" style="white-space: pre-wrap; max-height: 420px; overflow: auto">{{ rendered.body }}</v-sheet>
      <div class="d-flex align-center mt-3">
        <v-btn variant="tonal" color="primary" prepend-icon="mdi-content-copy" :disabled="!rendered.body" @click="copy(rendered.body)">
          {{ t('feedback.copy') }}
        </v-btn>
        <span v-if="notice" class="text-caption ml-3">{{ notice }}</span>
      </div>
    </v-card-text>
  </v-card>
</template>
