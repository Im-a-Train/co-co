<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { copyRich, copyText } from '@/lib/clipboard'
import { commands } from '@/lib/tauri'
import { postedItems, previewItems, renderFeedback, TEMPLATE_IDS, type RenderContext } from '@/domain/feedback'
import type { FeedbackChannel, FeedbackItem, FeedbackTemplateId } from '@/domain/types'

const props = defineProps<{
  items: FeedbackItem[]
  context: Omit<RenderContext, 'templateId'>
  /** Template that fits the camp state (no round yet: Grobprogramm, changes requested: Auflagen). */
  suggestedTemplate?: FeedbackTemplateId | null
  /** Confirming «gesendet» also moves the review status to «Änderungen angefragt». */
  setsStatus?: boolean
  /** ... and first records round 1 (no round yet). */
  startsRound?: boolean
}>()
const emit = defineEmits<{ (e: 'confirm-sent', ids: string[]): void }>()
const { t } = useI18n()

const channel = ref<FeedbackChannel>('whatsapp')
const templateId = ref<FeedbackTemplateId | null>(null)
const templatePicked = ref(false)
const includeLinks = ref(true)
const includeSent = ref(false)
const notice = ref<string | null>(null)
/** Ids of the drafts that went into the last copied text; set after «Kopieren», cleared on answer. */
const copiedIds = ref<string[] | null>(null)

watch(
  () => props.suggestedTemplate ?? null,
  (id) => {
    if (!templatePicked.value) templateId.value = id
  },
  { immediate: true },
)

const shown = computed(() => previewItems(props.items, { includeSent: includeSent.value }))
const postedCount = computed(() => postedItems(props.items).length)
const sentCount = computed(() => props.items.filter((i) => i.status === 'sent').length)
const draftIds = computed(() => shown.value.filter((i) => i.status === 'draft').map((i) => i.id))

const rendered = computed(() =>
  renderFeedback(shown.value, channel.value, { ...props.context, templateId: templateId.value ?? undefined, includeLinks: includeLinks.value }),
)
const lengthText = computed(() =>
  t('feedback.previewLength', {
    channel: t(`feedback.channel.${channel.value}`),
    n: String(rendered.value.body.length).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0'),
  }),
)

/** Still-draft items among the copied ones (the answer may come after further edits). */
const pendingSent = computed(() => {
  if (!copiedIds.value) return []
  const open = new Set(props.items.filter((i) => i.status === 'draft').map((i) => i.id))
  return copiedIds.value.filter((id) => open.has(id))
})

const sentBarKey = computed(() =>
  !props.setsStatus ? 'feedback.sentBar.textNoStatus' : props.startsRound ? 'feedback.sentBar.textRound' : 'feedback.sentBar.text',
)

const sentBarEl = ref<HTMLElement | null>(null)
watch(
  () => pendingSent.value.length > 0,
  async (open) => {
    if (!open) return
    await nextTick()
    sentBarEl.value?.scrollIntoView({ block: 'nearest' })
  },
)

function afterCopy(ok: boolean) {
  notice.value = ok ? t('feedback.copied') : t('feedback.copyFailed')
  copiedIds.value = ok && draftIds.value.length ? [...draftIds.value] : null
}
function confirmSent() {
  emit('confirm-sent', [...pendingSent.value])
  copiedIds.value = null
}

async function copy(text: string) {
  notice.value = (await copyText(text)) ? t('feedback.copied') : t('feedback.copyFailed')
}

async function copyBody() {
  const r = rendered.value
  afterCopy(r.html ? await copyRich(r.html, r.body) : await copyText(r.body))
}

/** Links in the HTML preview must not navigate inside the webview: open them externally. */
async function onHtmlClick(e: MouseEvent) {
  const a = (e.target as HTMLElement | null)?.closest('a')
  if (!a) return
  e.preventDefault()
  const href = a.getAttribute('href')
  if (!href) return
  try {
    await commands.openEcampUrl(href)
  } catch (err) {
    notice.value = `${t('feedback.openInEcampFailed')}: ${err instanceof Error ? err.message : String(err)}`
  }
}
</script>

<template>
  <v-card variant="outlined" data-testid="feedback-preview">
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
        @update:model-value="templatePicked = true"
      />
      <v-switch v-model="includeLinks" :label="t('feedback.includeLinks')" density="compact" color="primary" hide-details />
      <v-switch
        v-if="sentCount > 0"
        v-model="includeSent"
        :label="t('feedback.previewIncludeSent')"
        density="compact"
        color="primary"
        hide-details
        class="mb-2"
        data-testid="preview-include-sent"
      />
      <v-tabs v-model="channel" density="compact" class="mb-3 mt-2">
        <v-tab v-for="c in (['whatsapp', 'email', 'plain'] as const)" :key="c" :value="c">{{ t(`feedback.channel.${c}`) }}</v-tab>
      </v-tabs>

      <div v-if="rendered.subject !== null" class="mb-2">
        <div class="text-caption text-medium-emphasis">{{ t('feedback.subject') }}</div>
        <div class="d-flex align-center">
          <div class="font-weight-medium flex-grow-1">{{ rendered.subject }}</div>
          <v-btn size="x-small" variant="text" icon="mdi-content-copy" :aria-label="t('feedback.copy')" @click="copy(rendered.subject ?? '')" />
        </div>
      </div>
      <div v-if="!shown.length" class="text-body-2 text-medium-emphasis mb-2" data-testid="preview-empty">{{ t('feedback.previewEmpty') }}</div>
      <!-- rendered.html is built only from escaped text parts and http(s) URLs (see domain/feedback). -->
      <v-sheet
        v-if="rendered.html"
        border
        rounded
        class="pa-3 feedback-html preview-sheet"
        data-test="feedback-html"
        @click="onHtmlClick"
        v-html="rendered.html"
      />
      <v-sheet v-else border rounded class="pa-3 preview-sheet" style="white-space: pre-wrap">{{ rendered.body }}</v-sheet>
      <div class="text-caption text-medium-emphasis mt-1" data-testid="preview-length">{{ lengthText }}</div>
      <div v-if="postedCount > 0" class="text-caption text-medium-emphasis mt-1" data-testid="preview-posted">
        <v-icon size="x-small" class="mr-1">mdi-comment-check-outline</v-icon>{{ t('feedback.previewPostedSummary', { n: postedCount }, postedCount) }}
      </div>

      <div class="d-flex align-center mt-3">
        <v-btn :variant="pendingSent.length ? 'tonal' : 'flat'" color="primary" prepend-icon="mdi-content-copy" :disabled="!rendered.body || !shown.length" data-testid="preview-copy" @click="copyBody">
          {{ t('feedback.copy') }}
        </v-btn>
        <span v-if="notice" class="text-caption ml-3">{{ notice }}</span>
      </div>

      <!-- Right under «Kopieren», where the coach just clicked; scrolled into view in the sticky column. -->
      <div ref="sentBarEl">
        <v-alert
          v-if="pendingSent.length"
          type="info"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="sent-bar"
        >
          <div class="mb-2">
            {{ t(sentBarKey, { n: pendingSent.length }, pendingSent.length) }}
          </div>
          <div class="d-flex ga-2">
            <v-btn size="small" variant="flat" color="primary" data-testid="sent-bar-confirm" @click="confirmSent">{{ t('feedback.sentBar.confirm') }}</v-btn>
            <v-btn size="small" variant="text" data-testid="sent-bar-later" @click="copiedIds = null">{{ t('feedback.sentBar.later') }}</v-btn>
          </div>
        </v-alert>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.preview-sheet {
  max-height: max(160px, calc(100vh - 520px));
  overflow: auto;
}
</style>
