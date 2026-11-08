<script setup lang="ts">
/**
 * "Befunde durchgehen": two-pane triage. Left: compact list with status; right: current finding,
 * the affected activity, and an inline feedback editor. Advances to the next open finding after each action.
 * The parent owns persistence (feedback, ignore) and routing; this component only emits intents.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { itemFromFinding, KIND_ORDER } from '@/domain/feedback'
import { severityColor } from '@/domain/cockpit'
import {
  activityIriOfFinding,
  feedbackForFinding,
  nextOpenIndex,
  progressOf,
  resolveIndex,
  statusesOf,
  stepIndex,
  type FindingStatus,
} from '@/domain/triage'
import type { CampFacts, CategoryClass, FeedbackItem, FeedbackKind, FeedbackScope, Finding, Iri } from '@/domain/types'
import ActivityPreview from './ActivityPreview.vue'
import FindingCard from './FindingCard.vue'

export interface FeedbackDraft {
  kind: FeedbackKind
  scope: FeedbackScope
  text: string
}

const props = defineProps<{
  findings: Finding[]
  campIri: Iri
  facts: CampFacts | null
  feedbackItems: FeedbackItem[]
  classOf: (categoryIri: Iri | null) => CategoryClass
  /** Key (finding id) of the current finding; v-model. */
  currentKey: string | null
  /** Focus the feedback text right away (arrived via "Feedback erstellen"). */
  focusEditor?: boolean
}>()
const emit = defineEmits<{
  'update:currentKey': [key: string]
  saveFeedback: [finding: Finding, draft: FeedbackDraft]
  ignore: [finding: Finding, reason: string]
  unignore: [finding: Finding]
  openActivity: [iri: Iri]
  openFeedback: [itemId: string]
  excludeCategory: [finding: Finding]
}>()
const { t } = useI18n()

const statuses = computed(() => statusesOf(props.findings, props.feedbackItems))
const progress = computed(() => progressOf(statuses.value))
const index = computed(() => resolveIndex(props.findings, props.currentKey))
const current = computed<Finding | null>(() => props.findings[index.value] ?? null)
const currentStatus = computed<FindingStatus | null>(() => statuses.value[index.value] ?? null)
const existingFeedback = computed(() => (current.value ? feedbackForFinding(current.value, props.feedbackItems) : null))
const activityIri = computed(() => (current.value ? activityIriOfFinding(current.value, props.facts) : null))

const hasCategory = computed(
  () => !!activityIri.value && !!props.facts?.activities.find((a) => a.iri === activityIri.value)?.categoryIri,
)

const STATUS_COLOR: Record<FindingStatus, string | undefined> = { open: undefined, feedback: 'success', ignored: 'grey' }
const STATUS_ICON: Record<FindingStatus, string> = {
  open: 'mdi-circle-outline',
  feedback: 'mdi-message-check-outline',
  ignored: 'mdi-eye-off-outline',
}

// ---- editor draft (re-prefilled whenever the current finding changes) --------------------------
const draft = ref<FeedbackDraft>({ kind: 'suggestion', scope: 'camp', text: '' })
const reason = ref('')
const editorOpen = ref(true)
const textField = ref<{ focus: () => void } | null>(null)

function prefill() {
  const f = current.value
  reason.value = ''
  editorOpen.value = true
  if (!f) return
  const item = itemFromFinding(f, props.campIri)
  draft.value = { kind: item.kind, scope: item.scope, text: item.text }
}
watch(() => current.value?.id, prefill, { immediate: true })
const canActivityScope = computed(() => !!activityIri.value)
watch(
  () => [props.focusEditor, current.value?.id] as const,
  async ([focus]) => {
    if (!focus || currentStatus.value !== 'open') return
    await nextTick()
    textField.value?.focus()
  },
  { immediate: true },
)

// ---- navigation ------------------------------------------------------------------------------
function go(i: number) {
  const f = props.findings[i]
  if (f) emit('update:currentKey', f.id)
}
function step(dir: 1 | -1) {
  go(stepIndex(props.findings.length, index.value, dir))
}
function advance() {
  const next = nextOpenIndex(statuses.value, index.value)
  if (next >= 0) go(next)
}

function save() {
  const f = current.value
  if (!f || currentStatus.value !== 'open' || !draft.value.text.trim()) return
  advance()
  emit('saveFeedback', f, { ...draft.value, scope: draft.value.scope === 'activity' && !canActivityScope.value ? 'camp' : draft.value.scope })
}
function ignore() {
  const f = current.value
  if (!f || currentStatus.value !== 'open') return
  advance()
  emit('ignore', f, reason.value.trim())
}
function skip() {
  advance()
}

// ---- keyboard --------------------------------------------------------------------------------
function inTextField(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}
function onKey(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      save()
    }
    return
  }
  if (e.key === 'Escape') {
    if (inTextField(e)) (e.target as HTMLElement).blur()
    else editorOpen.value = false
    return
  }
  if (inTextField(e) || document.querySelector('.v-overlay--active')) return
  const k = e.key.toLowerCase()
  if (k === 'j' || e.key === 'ArrowDown') step(1)
  else if (k === 'k' || e.key === 'ArrowUp') step(-1)
  else if (k === 'f') save()
  else if (k === 'i') ignore()
  else return
  e.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// keep the active list entry in view
const listEl = ref<HTMLElement | null>(null)
watch(
  () => current.value?.id,
  async (id) => {
    if (!id) return
    await nextTick()
    listEl.value?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="!findings.length" class="text-body-2 text-medium-emphasis">{{ t('findings.triage.none') }}</div>
  <div v-else class="triage">
    <div class="d-flex align-center flex-wrap ga-3 mb-3">
      <div class="text-subtitle-1 font-weight-medium" data-testid="triage-progress">
        {{ t('findings.triage.progress', { done: progress.done, total: progress.total }) }}
      </div>
      <v-progress-linear :model-value="progress.total ? (progress.done / progress.total) * 100 : 0" color="primary" height="6" rounded style="max-width: 260px" />
      <v-spacer />
      <span class="text-caption text-medium-emphasis">{{ t('findings.triage.hint') }}</span>
    </div>

    <div class="triage-panes">
      <div ref="listEl" class="triage-list" role="listbox" :aria-label="t('findings.triage.listLabel')">
        <button
          v-for="(f, i) in findings"
          :key="f.id"
          type="button"
          class="triage-item"
          :class="{ active: i === index, done: statuses[i] !== 'open' }"
          :data-active="i === index"
          :data-status="statuses[i]"
          :data-finding-id="f.id"
          :style="{ borderLeftColor: `rgb(var(--v-theme-${severityColor(f.severity)}))` }"
          role="option"
          :aria-selected="i === index"
          @click="go(i)"
        >
          <v-icon :icon="STATUS_ICON[statuses[i]!]" :color="STATUS_COLOR[statuses[i]!]" size="small" class="mr-2 flex-shrink-0" />
          <span class="triage-item-text">
            <span class="d-block text-body-2 text-truncate">{{ f.title }}</span>
            <span class="d-block text-caption text-medium-emphasis text-truncate">
              {{ f.ruleId }} · {{ t(`findings.triage.status.${statuses[i]}`) }}
            </span>
          </span>
        </button>
      </div>

      <div v-if="current" class="triage-detail">
        <div class="d-flex align-center ga-2 mb-2">
          <v-chip size="small" label :color="STATUS_COLOR[currentStatus!]" variant="flat" data-testid="triage-status">
            {{ t(`findings.triage.status.${currentStatus}`) }}
          </v-chip>
          <span class="text-caption text-medium-emphasis">{{ index + 1 }} / {{ findings.length }}</span>
        </div>
        <FindingCard :finding="current" hide-actions @open-activity="emit('openActivity', $event)" />

        <div class="triage-cols mt-3">
          <v-card variant="outlined" class="triage-col">
            <v-card-text>
              <div class="text-subtitle-2 mb-1">{{ t('findings.triage.activity') }}</div>
              <ActivityPreview v-if="activityIri" :facts="facts" :activity-iri="activityIri" :class-of="classOf" excerpt />
              <div v-else class="text-body-2 text-medium-emphasis">{{ t('findings.triage.noActivity') }}</div>
              <v-btn
                v-if="activityIri"
                size="small"
                variant="text"
                prepend-icon="mdi-calendar-week"
                :text="t('findings.triage.openInGrid')"
                @click="emit('openActivity', activityIri)"
              />
              <v-btn
                v-if="activityIri && current.origin === 'rule' && hasCategory"
                size="small"
                variant="text"
                prepend-icon="mdi-filter-remove-outline"
                class="d-block mt-1"
                style="height: auto; white-space: normal"
                :text="t('findings.categoryExclusion.forRule')"
                data-testid="exclude-category-rule"
                @click="emit('excludeCategory', current)"
              />
            </v-card-text>
          </v-card>

          <v-card variant="outlined" class="triage-col" data-testid="triage-editor">
            <v-card-text>
              <div class="text-subtitle-2 mb-2">{{ t('findings.triage.editor') }}</div>

              <template v-if="currentStatus === 'feedback' && existingFeedback">
                <v-alert type="success" variant="tonal" density="compact" class="mb-2" :text="t('findings.triage.hasFeedback')" />
                <v-btn size="small" variant="tonal" :text="t('findings.triage.openFeedback')" @click="emit('openFeedback', existingFeedback.id)" />
              </template>
              <template v-else-if="currentStatus === 'ignored'">
                <v-alert type="info" variant="tonal" density="compact" class="mb-2">
                  {{ t('findings.triage.isIgnored') }}
                  <template v-if="current.override?.reason"> {{ t('findings.overrideReason', { reason: current.override.reason }) }}</template>
                </v-alert>
                <v-btn size="small" variant="tonal" prepend-icon="mdi-undo" :text="t('findings.removeOverride')" @click="emit('unignore', current)" />
              </template>
              <template v-else-if="!editorOpen">
                <v-btn size="small" variant="tonal" :text="t('findings.triage.editorOpen')" @click="editorOpen = true" />
              </template>
              <template v-else>
                <div class="d-flex ga-2 mb-2">
                  <v-select
                    v-model="draft.kind"
                    :items="KIND_ORDER.map((k) => ({ title: t(`feedback.kind.${k}`), value: k }))"
                    :label="t('findings.triage.kind')"
                    density="compact"
                    variant="outlined"
                    hide-details
                  />
                  <v-select
                    v-model="draft.scope"
                    :items="[
                      { title: t('feedback.scope.camp'), value: 'camp' },
                      { title: t('feedback.scope.activity'), value: 'activity', props: { disabled: !canActivityScope } },
                    ]"
                    :label="t('findings.triage.scope')"
                    density="compact"
                    variant="outlined"
                    hide-details
                  />
                </div>
                <v-textarea
                  ref="textField"
                  v-model="draft.text"
                  :label="t('findings.triage.text')"
                  rows="4"
                  auto-grow
                  variant="outlined"
                  density="compact"
                  hide-details
                  class="mb-2"
                  data-testid="triage-text"
                />
                <v-text-field
                  v-model="reason"
                  :label="t('findings.triage.ignoreReason')"
                  density="compact"
                  variant="outlined"
                  hide-details
                  class="mb-3"
                  data-testid="triage-reason"
                  @keydown.enter.prevent="ignore"
                />
                <div class="d-flex flex-wrap ga-2">
                  <v-btn
                    color="primary"
                    variant="flat"
                    prepend-icon="mdi-message-draw"
                    :disabled="!draft.text.trim()"
                    :text="t('findings.triage.saveNext')"
                    data-testid="triage-save"
                    @click="save"
                  />
                  <v-btn variant="tonal" prepend-icon="mdi-eye-off-outline" :text="t('findings.triage.ignoreNext')" data-testid="triage-ignore" @click="ignore" />
                  <v-btn variant="text" prepend-icon="mdi-skip-next" :text="t('findings.triage.skip')" data-testid="triage-skip" @click="skip" />
                </div>
              </template>
            </v-card-text>
          </v-card>
        </div>

        <v-alert v-if="!progress.open" type="success" variant="tonal" density="compact" class="mt-3" :text="t('findings.triage.allDone')" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.triage-panes {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.triage-list {
  flex: 0 0 320px;
  max-height: calc(100vh - 260px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: sticky;
  top: 8px;
}
.triage-item {
  display: flex;
  align-items: center;
  text-align: left;
  padding: 6px 10px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-left-width: 4px;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  min-width: 0;
}
.triage-item.done {
  opacity: 0.65;
}
.triage-item.active {
  background: rgba(var(--v-theme-primary), 0.12);
  border-color: rgb(var(--v-theme-primary));
  opacity: 1;
}
.triage-item-text {
  min-width: 0;
  flex: 1 1 auto;
}
.triage-detail {
  flex: 1 1 0;
  min-width: 0;
}
.triage-cols {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
}
.triage-col {
  flex: 1 1 320px;
  min-width: 0;
}
@media (max-width: 900px) {
  .triage-panes {
    flex-direction: column;
  }
  .triage-list {
    flex: none;
    width: 100%;
    max-height: 220px;
    position: static;
  }
}
</style>
