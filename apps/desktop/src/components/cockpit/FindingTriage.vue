<script setup lang="ts">
/**
 * "Befunde durchgehen": two-pane triage. Left: compact list of topics (same-rule day findings are one
 * entry) with status; right: current entry, the decision (feedback text + buttons) right under it, then
 * the affected activity. Findings that only wait for an input of the coach sit in a block on top and are
 * never part of the triage. Advances to the next open entry after each action.
 * The parent owns persistence (feedback, ignore) and routing; this component only emits intents.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { itemFromFindingGroup, KIND_ORDER, previewItems } from '@/domain/feedback'
import { severityColor } from '@/domain/cockpit'
import { formatDateList } from '@/domain/selfCheck'
import {
  activityIriOfFinding,
  feedbackForFinding,
  findingStatus,
  findingTarget,
  groupFindings,
  isCoachTodo,
  nextOpenIndex,
  progressOf,
  stepIndex,
  type FindingGroupEntry,
  type FindingStatus,
} from '@/domain/triage'
import type { CampFacts, CategoryClass, FeedbackItem, FeedbackKind, FeedbackScope, Finding, Iri } from '@/domain/types'
import ActivityPreview from './ActivityPreview.vue'
import CoachTodoBlock from './CoachTodoBlock.vue'
import RuleEditDialog from '@/components/rules/RuleEditDialog.vue'
import { loadBundledPacks } from '@/domain/rules/packs'
import FindingCard from './FindingCard.vue'
import { groupLabel, targetLabel } from './findingLabels'

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
  /** One feedback item for the (open) findings of the group. */
  saveFeedback: [group: FindingGroupEntry, draft: FeedbackDraft]
  /** Ignore all given findings with one reason. */
  ignore: [findings: Finding[], reason: string]
  unignore: [findings: Finding[]]
  /** «Im GP öffnen»: a day (day findings) or an activity. */
  openGrid: [target: { activityIri: Iri | null; dayIri: Iri | null }]
  openActivity: [iri: Iri]
  openFeedback: [itemId: string]
  excludeCategory: [finding: Finding]
  toFeedback: []
}>()
const { t } = useI18n()

// ---- entries (topics) and rows ---------------------------------------------------------------------
const todos = computed(() => props.findings.filter((f) => isCoachTodo(f) && !f.override))
const topicFindings = computed(() => props.findings.filter((f) => !isCoachTodo(f)))
const entries = computed(() => groupFindings(topicFindings.value, props.facts))

const statusOf = (f: Finding): FindingStatus => findingStatus(f, props.feedbackItems)
/** Open while any member is open; else feedback if any member has feedback; else ignored. */
function entryStatus(findings: readonly Finding[]): FindingStatus {
  const s = findings.map(statusOf)
  if (s.includes('open')) return 'open'
  return s.includes('feedback') ? 'feedback' : 'ignored'
}

interface Unit {
  key: string
  entry: FindingGroupEntry
  /** A single finding shown below its expanded group. */
  member: boolean
}
const expanded = reactive(new Set<string>())
const units = computed<Unit[]>(() =>
  entries.value.flatMap((e) => {
    const rows: Unit[] = [{ key: e.key, entry: e, member: false }]
    if (e.findings.length > 1 && expanded.has(e.key)) {
      for (const f of e.findings) {
        rows.push({ key: f.id, entry: { key: f.id, ruleId: f.ruleId, severity: f.severity, findings: [f], dates: [] }, member: true })
      }
    }
    return rows
  }),
)
const statuses = computed(() => units.value.map((u) => entryStatus(u.entry.findings)))
const progress = computed(() => progressOf(entries.value.map((e) => entryStatus(e.findings))))

const unitKey = ref<string | null>(null)
const index = computed(() => {
  const list = units.value
  if (!list.length) return -1
  let i = unitKey.value ? list.findIndex((u) => u.key === unitKey.value) : -1
  if (i < 0 && props.currentKey) {
    const has = (u: Unit) => u.entry.findings.some((f) => f.id === props.currentKey)
    i = list.findIndex((u) => !u.member && has(u))
    if (i < 0) i = list.findIndex(has)
  }
  return i >= 0 ? i : 0
})
const unit = computed<Unit | null>(() => units.value[index.value] ?? null)
const current = computed<FindingGroupEntry | null>(() => unit.value?.entry ?? null)
/** The finding shown on the card (first of the group). */
const rep = computed<Finding | null>(() => current.value?.findings[0] ?? null)
const isGroup = computed(() => (current.value?.findings.length ?? 0) > 1)
const currentStatus = computed<FindingStatus | null>(() => statuses.value[index.value] ?? null)
const openMembers = computed(() => current.value?.findings.filter((f) => statusOf(f) === 'open') ?? [])
const hasMust = computed(() => openMembers.value.some((f) => f.severity === 'must'))
const existingFeedback = computed(
  () => current.value?.findings.map((f) => feedbackForFinding(f, props.feedbackItems)).find((x) => !!x) ?? null,
)
const activityIri = computed(() => (rep.value ? activityIriOfFinding(rep.value, props.facts) : null))
const dayIri = computed(() => {
  const t0 = rep.value ? findingTarget(rep.value, props.facts) : null
  return t0?.kind === 'day' ? t0.dayIri : null
})

const hasCategory = computed(
  () => !!activityIri.value && !!props.facts?.activities.find((a) => a.iri === activityIri.value)?.categoryIri,
)

const STATUS_COLOR: Record<FindingStatus, string | undefined> = { open: undefined, feedback: 'success', ignored: 'grey' }
const STATUS_ICON: Record<FindingStatus, string> = {
  open: 'mdi-circle-outline',
  feedback: 'mdi-message-check-outline',
  ignored: 'mdi-eye-off-outline',
}

function rowTitle(u: Unit): string {
  const f = u.entry.findings[0]!
  if (!u.member && u.entry.findings.length > 1) return groupLabel(t, f.title, u.entry.findings.length, u.entry.dates)
  return f.title
}
function rowSubtitle(u: Unit): string {
  if (!u.member && u.entry.findings.length > 1) return ''
  return targetLabel(t, findingTarget(u.entry.findings[0]!, props.facts))
}

// ---- edit the rule behind the finding in place (findings re-evaluate when the edit is saved) ----
const ruleEditOpen = ref(false)
const bundledRuleIds = (() => {
  try {
    return new Set(loadBundledPacks().flatMap((p) => p.rules.map((r) => r.meta.id)))
  } catch {
    return new Set<string>()
  }
})()
const canEditRule = computed(() => rep.value?.origin === 'rule' && bundledRuleIds.has(rep.value.ruleId))
const canExcludeCategory = computed(() => !!activityIri.value && rep.value?.origin === 'rule' && hasCategory.value)

// ---- editor draft (re-prefilled whenever the current entry changes) ------------------------------
const draft = ref<FeedbackDraft>({ kind: 'suggestion', scope: 'camp', text: '' })
const reason = ref('')
const reasonMissing = ref(false)
const editorOpen = ref(true)
const textField = ref<{ focus: () => void } | null>(null)
const reasonField = ref<{ focus: () => void } | null>(null)

/** Entry restricted to its open findings (a group where some days already have feedback). */
function openEntry(): FindingGroupEntry | null {
  const e = current.value
  if (!e) return null
  const open = openMembers.value
  if (!open.length) return null
  if (open.length === e.findings.length) return e
  const dates = open.flatMap((f) => {
    const target = findingTarget(f, props.facts)
    return target.kind === 'day' ? [target.date] : []
  })
  return { ...e, findings: open, dates: [...new Set(dates)].sort() }
}

function prefill() {
  reason.value = ''
  reasonMissing.value = false
  editorOpen.value = true
  const e = openEntry() ?? current.value
  if (!e) return
  const item = itemFromFindingGroup(e, props.campIri, formatDateList(e.dates))
  draft.value = { kind: item.kind, scope: item.scope, text: item.text }
}
watch(() => current.value?.key, prefill, { immediate: true })
const canActivityScope = computed(() => !!activityIri.value)
watch(
  () => [props.focusEditor, current.value?.key] as const,
  async ([focus]) => {
    if (!focus || currentStatus.value !== 'open') return
    await nextTick()
    textField.value?.focus()
  },
  { immediate: true },
)
// An external change of the key (Übersicht, back from the grid) leaves the member row it does not belong to.
watch(
  () => props.currentKey,
  (k) => {
    if (k && unit.value && !unit.value.entry.findings.some((f) => f.id === k)) unitKey.value = null
  },
)

// ---- navigation ------------------------------------------------------------------------------
function go(i: number) {
  const u = units.value[i]
  const f = u?.entry.findings[0]
  if (!u || !f) return
  unitKey.value = u.key
  emit('update:currentKey', f.id)
}
function step(dir: 1 | -1) {
  go(stepIndex(units.value.length, index.value, dir))
}
function advance() {
  const handled = new Set(current.value?.findings.map((f) => f.id) ?? [])
  const list = statuses.value.map((s, i): FindingStatus =>
    units.value[i]?.entry.findings.some((f) => handled.has(f.id)) ? 'feedback' : s,
  )
  const next = nextOpenIndex(list, index.value)
  if (next >= 0) go(next)
}
function toggleExpand() {
  const e = current.value
  if (!e) return
  const key = unit.value?.member ? (entries.value.find((x) => x.findings.some((f) => f.id === e.findings[0]?.id))?.key ?? e.key) : e.key
  if (expanded.has(key)) {
    expanded.delete(key)
    unitKey.value = key
  } else {
    expanded.add(key)
  }
}
const canExpand = computed(() => isGroup.value || !!unit.value?.member)
const expandedNow = computed(() => !!unit.value?.member || (!!current.value && expanded.has(current.value.key)))

function save() {
  const e = openEntry()
  if (!e || currentStatus.value !== 'open' || !draft.value.text.trim()) return
  advance()
  emit('saveFeedback', e, { ...draft.value, scope: draft.value.scope === 'activity' && !canActivityScope.value ? 'camp' : draft.value.scope })
}
async function ignore() {
  if (!current.value || currentStatus.value !== 'open') return
  if (hasMust.value && !reason.value.trim()) {
    reasonMissing.value = true
    editorOpen.value = true
    await nextTick()
    reasonField.value?.focus()
    return
  }
  const open = openMembers.value
  advance()
  emit('ignore', open, reason.value.trim())
}
function skip() {
  advance()
}
watch(reason, (v) => {
  if (v.trim()) reasonMissing.value = false
})

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
  else if (k === 'i') void ignore()
  else return
  e.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// keep the active list entry in view
const listEl = ref<HTMLElement | null>(null)
watch(
  () => unit.value?.key,
  async (id) => {
    if (!id) return
    await nextTick()
    listEl.value?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
  },
  { immediate: true },
)

const feedbackCount = computed(() => previewItems(props.feedbackItems).length)
function openGrid() {
  emit('openGrid', { activityIri: dayIri.value ? null : activityIri.value, dayIri: dayIri.value })
}
</script>

<template>
  <div v-if="!findings.length" class="text-body-2 text-medium-emphasis">{{ t('findings.triage.none') }}</div>
  <div v-else class="triage">
    <CoachTodoBlock :findings="todos" :camp-iri="campIri" :start-open="!entries.length" />
    <div v-if="!entries.length" class="text-body-2 text-medium-emphasis">{{ t('findings.triage.none') }}</div>

    <div v-if="entries.length" class="d-flex align-center flex-wrap ga-3 mb-3">
      <div class="text-subtitle-1 font-weight-medium" data-testid="triage-progress">
        {{ t('findings.triage.progress', { done: progress.done, total: progress.total }) }}
      </div>
      <v-progress-linear :model-value="progress.total ? (progress.done / progress.total) * 100 : 0" color="primary" height="6" rounded style="max-width: 260px" />
      <span class="text-body-2 text-medium-emphasis" data-testid="triage-counter">
        {{ t('findings.counter.topics', { count: entries.length }, entries.length) }} ·
        {{ t('findings.counter.findings', { count: topicFindings.length }, topicFindings.length) }}
      </span>
    </div>

    <v-alert v-if="entries.length && !progress.open" type="success" variant="tonal" density="compact" class="mb-3" data-testid="triage-all-done">
      {{ t('findings.triage.allDone') }}
      <template #append>
        <v-btn
          color="primary"
          variant="flat"
          size="small"
          data-testid="triage-to-feedback"
          :text="feedbackCount ? t('findings.triage.toFeedbackCount', { count: feedbackCount }, feedbackCount) : t('findings.triage.toFeedback')"
          @click="emit('toFeedback')"
        />
      </template>
    </v-alert>

    <div v-if="entries.length" class="triage-panes">
      <div ref="listEl" class="triage-list" role="listbox" :aria-label="t('findings.triage.listLabel')">
        <button
          v-for="(u, i) in units"
          :key="u.key"
          type="button"
          class="triage-item"
          :class="{ active: i === index, done: statuses[i] !== 'open', member: u.member }"
          :data-active="i === index"
          :data-status="statuses[i]"
          :data-severity="u.entry.severity"
          :data-finding-id="u.entry.findings[0]!.id"
          :data-group="!u.member && u.entry.findings.length > 1 ? u.entry.findings.length : undefined"
          :style="{ borderLeftColor: `rgb(var(--v-theme-${u.entry.findings[0]!.origin === 'manual' ? 'coach' : severityColor(u.entry.severity)}))` }"
          role="option"
          :aria-selected="i === index"
          @click="go(i)"
        >
          <v-icon :icon="STATUS_ICON[statuses[i]!]" :color="STATUS_COLOR[statuses[i]!]" size="small" class="mr-2 flex-shrink-0" />
          <span class="triage-item-text">
            <span class="d-block text-body-2" :class="rowSubtitle(u) ? 'text-truncate' : 'triage-clamp'">{{ rowTitle(u) }}</span>
            <span v-if="rowSubtitle(u)" class="d-block text-caption text-medium-emphasis text-truncate">{{ rowSubtitle(u) }}</span>
          </span>
        </button>
      </div>

      <div v-if="current && rep" class="triage-detail">
        <div class="d-flex align-center ga-2 mb-2">
          <v-chip size="small" label :color="STATUS_COLOR[currentStatus!]" variant="flat" data-testid="triage-status">
            {{ t(`findings.triage.status.${currentStatus}`) }}
          </v-chip>
          <span class="text-caption text-medium-emphasis">{{ index + 1 }} / {{ units.length }}</span>
          <v-spacer />
          <v-btn v-if="canExpand" size="small" variant="text" data-testid="triage-expand" @click="toggleExpand">
            {{ expandedNow ? t('findings.group.collapse') : t('findings.group.expand') }}
          </v-btn>
          <v-menu v-if="canEditRule || canExcludeCategory">
            <template #activator="{ props: menuProps }">
              <v-btn
                v-bind="menuProps"
                size="small"
                variant="text"
                icon="mdi-dots-vertical"
                :aria-label="t('findings.triage.more')"
                data-testid="triage-more"
              />
            </template>
            <v-list density="compact">
              <v-list-item
                v-if="canEditRule"
                prepend-icon="mdi-pencil-ruler"
                :title="t('findings.triage.editRule')"
                data-testid="edit-rule"
                @click="ruleEditOpen = true"
              />
              <v-list-item
                v-if="canExcludeCategory"
                prepend-icon="mdi-filter-remove-outline"
                :title="t('findings.categoryExclusion.forRule')"
                data-testid="exclude-category-rule"
                @click="emit('excludeCategory', rep)"
              />
            </v-list>
          </v-menu>
        </div>
        <FindingCard :finding="rep" hide-actions @open-activity="emit('openActivity', $event)" />

        <v-card variant="outlined" class="mt-3" data-testid="triage-editor">
          <v-card-text>
            <template v-if="currentStatus === 'feedback' && existingFeedback">
              <v-alert type="success" variant="tonal" density="compact" class="mb-2" :text="t('findings.triage.hasFeedback')" />
              <v-btn size="small" variant="tonal" :text="t('findings.triage.openFeedback')" @click="emit('openFeedback', existingFeedback.id)" />
            </template>
            <template v-else-if="currentStatus === 'ignored'">
              <v-alert type="info" variant="tonal" density="compact" class="mb-2">
                {{ t('findings.triage.isIgnored') }}
                <template v-if="rep.override?.reason"> {{ t('findings.overrideReason', { reason: rep.override.reason }) }}</template>
              </v-alert>
              <v-btn size="small" variant="tonal" prepend-icon="mdi-undo" :text="t('findings.removeOverride')" @click="emit('unignore', current.findings)" />
            </template>
            <template v-else-if="!editorOpen">
              <v-btn size="small" variant="tonal" :text="t('findings.triage.editorOpen')" @click="editorOpen = true" />
            </template>
            <template v-else>
              <div v-if="isGroup" class="text-caption text-medium-emphasis mb-1">{{ t('findings.triage.groupHint', { count: openMembers.length }) }}</div>
              <v-textarea
                ref="textField"
                v-model="draft.text"
                :label="t('findings.triage.text')"
                rows="3"
                auto-grow
                variant="outlined"
                density="compact"
                hide-details
                class="mb-3"
                data-testid="triage-text"
              />
              <div class="d-flex flex-wrap ga-2 mb-1">
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
              <div class="text-caption text-medium-emphasis mb-3" data-testid="triage-keys">{{ t('findings.triage.hint') }}</div>
              <div class="d-flex flex-wrap align-start ga-2">
                <v-select
                  v-model="draft.kind"
                  :items="KIND_ORDER.map((k) => ({ title: t(`feedback.kind.${k}`), value: k }))"
                  :label="t('findings.triage.kind')"
                  density="compact"
                  variant="outlined"
                  hide-details
                  style="flex: 1 1 150px"
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
                  style="flex: 1 1 150px"
                />
                <v-text-field
                  ref="reasonField"
                  v-model="reason"
                  :label="hasMust ? t('findings.triage.ignoreReasonMust') : t('findings.triage.ignoreReason')"
                  :error-messages="reasonMissing ? [t('findings.triage.reasonRequired')] : []"
                  :hide-details="!reasonMissing"
                  density="compact"
                  variant="outlined"
                  style="flex: 2 1 240px"
                  data-testid="triage-reason"
                  @keydown.enter.prevent="ignore"
                />
              </div>
            </template>
          </v-card-text>
        </v-card>

        <v-card variant="outlined" class="mt-3">
          <v-card-text>
            <div class="text-subtitle-2 mb-1">{{ t('findings.triage.activity') }}</div>
            <ActivityPreview v-if="activityIri" :facts="facts" :activity-iri="activityIri" :class-of="classOf" excerpt />
            <div v-else class="text-body-2 text-medium-emphasis">{{ t('findings.triage.noActivity') }}</div>
            <div v-if="activityIri || dayIri" class="d-flex flex-column align-start ga-1 mt-1">
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-calendar-week"
                :text="t('findings.triage.openInGrid')"
                data-testid="triage-open-grid"
                @click="openGrid"
              />
            </div>
          </v-card-text>
        </v-card>

        <RuleEditDialog v-if="canEditRule" v-model="ruleEditOpen" :rule-id="rep.ruleId" />
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
.triage-item.member {
  margin-left: 16px;
}
.triage-clamp {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
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
