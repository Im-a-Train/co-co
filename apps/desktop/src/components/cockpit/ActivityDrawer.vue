<script setup lang="ts">
/**
 * Activity details drawer (GP and DP). Non-modal on wide windows: the page stays usable, a click on another block / row
 * swaps the content, Esc closes, ↑/↓ (DP) or ←/→ (GP) step to the previous / next activity.
 * Order: header (title, actions) · meta + dates · Befunde · Coach-Befunde · Ablauf / Sicherheit · «Markierungen und Dokumente».
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDisplay } from 'vuetify'
import { useManualFindings } from '@/composables/useManualFindings'
import { dateOf, findingsForActivity, formatClock, formatDateShort, minutesOfDay, responsibleNames, severityColor } from '@/domain/cockpit'
import { listDocuments, saveDocument } from '@/domain/documents/store'
import { ecampActivityUrl } from '@/domain/ecampLinks'
import { groupFindings, type FindingGroupEntry } from '@/domain/triage'
import { commands } from '@/lib/tauri'
import type { CampFacts, CategoryClass, DocumentRecord, Finding, Iri, Severity } from '@/domain/types'
import AiSafetyReviewButton from '@/components/ai/AiSafetyReviewButton.vue'
import { sharedTimeRange } from '@/components/activities/activityRows'
import ActivityTagEditor from './ActivityTagEditor.vue'
import ManualFindingDialog from './ManualFindingDialog.vue'
import ManualFindingList from './ManualFindingList.vue'

const props = defineProps<{
  modelValue: boolean
  activityIri: Iri | null
  campIri: Iri
  facts: CampFacts | null
  findings: Finding[]
  classOf: (categoryIri: Iri | null) => CategoryClass
  /** Set when the grid was opened from a finding: shows «Zurück zum Befund». */
  origin?: { ruleId: string; title: string } | null
  /** Activities in navigation order (the views pass the list order / chronological order); enables prev / next. */
  order?: Iri[]
  /** Arrow keys that step through `order`: ↑/↓ in the list, ←/→ in the grid. */
  stepKeys?: 'vertical' | 'horizontal'
  /** Offer «Im GP anzeigen» (the DP; the GP is already there). */
  canShowInGrid?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** Open a finding in the triage (Befunde tab). */
  openFinding: [finding: Finding]
  showFindings: [activityIri: Iri]
  showInGrid: [activityIri: Iri]
  /** Jump to the documents tab (documentId selects a document there). */
  openDocument: [documentId: string | null]
  aiFindings: [findings: Finding[]]
  backToFinding: []
  /** Step to another activity (prev / next, arrow keys). */
  select: [activityIri: Iri]
  /** A document was linked to an activity (views refresh their document counts). */
  linked: []
}>()
const { t } = useI18n()

// Wide windows: non-modal (no scrim, page stays clickable). Narrow ones fall back to the overlay drawer.
const { width } = useDisplay()
const narrow = computed(() => width.value < 1100)

const activity = computed(() => props.facts?.activities.find((a) => a.iri === props.activityIri) ?? null)
const category = computed(() => props.facts?.categories.find((c) => c.iri === activity.value?.categoryIri) ?? null)
const own = computed(() =>
  props.activityIri ? findingsForActivity(props.findings, props.activityIri).filter((f) => f.origin !== 'manual') : [],
)
const activityFindings = computed(() => own.value.filter((f) => f.scope !== 'day'))
const dayFindings = computed(() => own.value.filter((f) => f.scope === 'day'))
/** Same-rule day findings are one row with their dates (contract decision 4), e.g. «Gültiger J+S-Lagertag · 25.01., 27.01.». */
const dayGroups = computed(() => groupFindings(dayFindings.value, props.facts))
const groupDates = (g: FindingGroupEntry) => g.dates.map(formatDateShort).join(', ')
const manualHandle = useManualFindings(() => props.campIri)
const manualOwn = computed(() => (props.activityIri ? (manualHandle.byActivity.value.get(props.activityIri) ?? []) : []))
const addOpen = ref(false)

// ---- header: eCamp link, prev / next -----------------------------------------------------------------------
const ecampUrl = computed(() => (props.facts && props.activityIri ? ecampActivityUrl(props.facts, props.activityIri) : null))
const openError = ref<string | null>(null)
async function openInEcamp() {
  if (!ecampUrl.value) return
  openError.value = null
  try {
    await commands.openEcampUrl(ecampUrl.value)
  } catch (e) {
    openError.value = `${t('feedback.openInEcampFailed')}: ${e instanceof Error ? e.message : String(e)}`
  }
}

const position = computed(() => (props.order && props.activityIri ? props.order.indexOf(props.activityIri) : -1))
const prevIri = computed(() => (position.value > 0 ? (props.order![position.value - 1] ?? null) : null))
const nextIri = computed(() => (position.value >= 0 && props.order ? (props.order[position.value + 1] ?? null) : null))
const canStep = computed(() => !!props.order && props.order.length > 1 && position.value >= 0)
const stepIcons = computed(() => (props.stepKeys === 'horizontal' ? ['mdi-chevron-left', 'mdi-chevron-right'] : ['mdi-chevron-up', 'mdi-chevron-down']))

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}
/** Esc closes first (before «Zurück zum Befund»); arrows step. Open dialogs / menus keep their own keys. */
function onKey(e: KeyboardEvent) {
  if (!props.modelValue || !activity.value || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return
  // Open dialogs / menus keep their keys; a hovered tooltip or a snackbar does not block them.
  if (document.querySelector('.v-overlay--active:not(.v-tooltip):not(.v-snackbar)')) return
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('update:modelValue', false)
    return
  }
  const [prevKey, nextKey] = props.stepKeys === 'horizontal' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
  const target = e.key === prevKey ? prevIri.value : e.key === nextKey ? nextIri.value : null
  if (!props.stepKeys || (e.key !== prevKey && e.key !== nextKey)) return
  e.preventDefault()
  if (target) emit('select', target)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// ---- meta + dates ---------------------------------------------------------------------------------------------
const meta = computed(() => {
  const a = activity.value
  if (!a || !props.facts) return ''
  const people = props.activityIri ? responsibleNames(props.facts, a.iri) : []
  const cls = category.value ? t(`categoryClass.${props.classOf(category.value.iri)}`) : ''
  const who = people.length ? people.join(', ') : t('cockpit.drawer.noResponsibles')
  return [category.value?.short, cls, a.location, who].filter(Boolean).join(' · ')
})

interface Entry {
  iri: Iri
  date: string
  dayNumber: number | null
  startMin: number
  endMin: number
  number: string | null
}
const entries = computed<Entry[]>(() =>
  (props.facts?.scheduleEntries ?? [])
    .filter((e) => e.activityIri === props.activityIri)
    .map((e) => ({
      iri: e.iri,
      date: dateOf(e.start),
      dayNumber: e.dayNumber,
      startMin: minutesOfDay(e.start),
      endMin: minutesOfDay(e.end),
      number: e.number,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin),
)
const dayLabel = (e: Entry) => (e.dayNumber !== null ? t('activities.entryDay', { n: e.dayNumber }) : formatDateShort(e.date))
const timeLabel = (e: { startMin: number; endMin: number }) => `${formatClock(e.startMin)}–${formatClock(e.endMin)}`
/** «4 Termine: Tag 1, 2, 4, 7 · 08:00–18:00» when all entries share the time of day, else one line per entry. */
const dateLines = computed<string[]>(() => {
  const list = entries.value
  if (!list.length) return []
  const shared = sharedTimeRange(list)
  if (shared && list.length > 1) {
    const allNumbered = list.every((e) => e.dayNumber !== null)
    const days = allNumbered ? `${t('activities.entryDay', { n: list.map((e) => e.dayNumber).join(', ') })}` : list.map((e) => formatDateShort(e.date)).join(', ')
    return [`${t('cockpit.drawer.dates', { count: list.length, days })} · ${timeLabel(shared)}`]
  }
  return list.map((e) => t('cockpit.drawer.dateLine', { day: dayLabel(e), time: timeLabel(e), number: e.number ? ` · ${e.number}` : '' }))
})

// ---- Ablauf / Sicherheit -----------------------------------------------------------------------------------------
const MAX = 320
const showAll = ref(false)
watch(
  () => props.activityIri,
  () => {
    showAll.value = false
  },
)
function cut(raw: string): string {
  const text = raw.replace(/\n\s*\n+/g, '\n').trim()
  if (showAll.value || text.length <= MAX) return text
  return `${text.slice(0, MAX).trimEnd()} …`
}
const storyboard = computed(() => cut(activity.value?.content.storyboardText ?? ''))
const safety = computed(() => cut(activity.value?.content.safetyText ?? ''))
const isLong = computed(
  () =>
    (activity.value?.content.storyboardText ?? '').replace(/\n\s*\n+/g, '\n').trim().length > MAX ||
    (activity.value?.content.safetyText ?? '').replace(/\n\s*\n+/g, '\n').trim().length > MAX,
)

// ---- findings ---------------------------------------------------------------------------------------------------
/** Colour = state: only Muss is red, Soll orange, Hinweis neutral. */
const dotColor = (s: Severity) => (s === 'hint' ? 'grey' : severityColor(s))

// ---- documents: linked ones + manual link (local co-co data, no eCamp write) ---------------------------------------
const allDocs = ref<DocumentRecord[]>([])
const docs = computed(() => allDocs.value.filter((d) => !!props.activityIri && d.activityIris.includes(props.activityIri)))
const linkable = computed(() => allDocs.value.filter((d) => !!props.activityIri && !d.activityIris.includes(props.activityIri)))
const linkError = ref<string | null>(null)
const linkMenu = ref(false)
async function loadDocs() {
  try {
    allDocs.value = await listDocuments(props.campIri)
  } catch {
    allDocs.value = []
  }
}
watch(
  () => [props.modelValue, props.activityIri] as const,
  async ([open, iri]) => {
    linkError.value = null
    if (!open || !iri) {
      allDocs.value = []
      return
    }
    await loadDocs()
  },
  { immediate: true },
)
/** Same effect as useDocuments().confirmLink: adds the activity to the document and drops its suggestion. */
async function linkDocument(d: DocumentRecord) {
  const iri = props.activityIri
  if (!iri) return
  linkMenu.value = false
  linkError.value = null
  try {
    await saveDocument({
      ...d,
      activityIris: d.activityIris.includes(iri) ? d.activityIris : [...d.activityIris, iri],
      linkSuggestions: d.linkSuggestions.filter((s) => s.activityIri !== iri),
    })
    await loadDocs()
    emit('linked')
  } catch (e) {
    linkError.value = `${t('cockpit.drawer.linkFailed')}: ${e instanceof Error ? e.message : String(e)}`
  }
}
</script>

<template>
  <v-navigation-drawer
    :model-value="modelValue"
    location="right"
    :temporary="narrow"
    :scrim="narrow"
    :mobile="false"
    width="440"
    data-testid="activity-drawer"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="activity" class="pa-4">
      <template v-if="origin && narrow">
        <v-btn
          color="primary"
          variant="flat"
          size="small"
          prepend-icon="mdi-arrow-left"
          :text="t('findings.backToFinding.button')"
          data-testid="drawer-back-to-finding"
          @click="emit('backToFinding')"
        />
        <div class="text-caption text-medium-emphasis mt-1 mb-2">
          {{ t('findings.backToFinding.context', origin) }}
        </div>
      </template>

      <!-- (1) header: step, title, close -->
      <div class="d-flex align-start ga-1">
        <div class="text-h6 flex-grow-1 drawer-title" data-testid="drawer-title">{{ activity.title }}</div>
        <v-btn
          v-if="canStep"
          :icon="stepIcons[0]"
          variant="text"
          size="small"
          :disabled="!prevIri"
          :title="t('cockpit.drawer.prev')"
          :aria-label="t('cockpit.drawer.prev')"
          data-testid="drawer-prev"
          @click="prevIri && emit('select', prevIri)"
        />
        <v-btn
          v-if="canStep"
          :icon="stepIcons[1]"
          variant="text"
          size="small"
          :disabled="!nextIri"
          :title="t('cockpit.drawer.next')"
          :aria-label="t('cockpit.drawer.next')"
          data-testid="drawer-next"
          @click="nextIri && emit('select', nextIri)"
        />
        <v-btn icon="mdi-close" variant="text" size="small" :title="t('common.close')" :aria-label="t('common.close')" data-testid="drawer-close" @click="emit('update:modelValue', false)" />
      </div>
      <div class="d-flex flex-wrap align-center ga-1 mb-2">
        <v-btn
          icon="mdi-open-in-new"
          variant="tonal"
          size="small"
          :disabled="!ecampUrl"
          :title="t('cockpit.drawer.openInEcamp')"
          :aria-label="t('cockpit.drawer.openInEcamp')"
          data-testid="drawer-open-ecamp"
          @click="openInEcamp"
        />
        <v-btn
          icon="mdi-comment-plus-outline"
          variant="tonal"
          size="small"
          :title="t('findings.manual.add')"
          :aria-label="t('findings.manual.add')"
          data-testid="drawer-header-add-finding"
          @click="addOpen = true"
        />
        <v-btn
          v-if="canShowInGrid"
          icon="mdi-calendar-week"
          variant="tonal"
          size="small"
          :title="t('activities.showInGrid')"
          :aria-label="t('activities.showInGrid')"
          data-testid="drawer-show-in-grid"
          @click="emit('showInGrid', activity.iri)"
        />
        <v-menu v-model="linkMenu" :close-on-content-click="false" location="bottom start">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              icon="mdi-link-plus"
              variant="tonal"
              size="small"
              :title="t('cockpit.drawer.linkDocument')"
              :aria-label="t('cockpit.drawer.linkDocument')"
              data-testid="drawer-link-document"
            />
          </template>
          <v-list density="compact" max-height="320" min-width="260" data-testid="drawer-link-list">
            <v-list-subheader>{{ t('cockpit.drawer.linkDocument') }}</v-list-subheader>
            <template v-if="!allDocs.length">
              <v-list-item :title="t('cockpit.drawer.linkEmpty')" disabled />
              <v-list-item
                prepend-icon="mdi-file-document-multiple-outline"
                :title="t('cockpit.drawer.openDocuments')"
                data-testid="drawer-link-to-documents"
                @click="emit('openDocument', null)"
              />
            </template>
            <v-list-item v-else-if="!linkable.length" :title="t('cockpit.drawer.linkNone')" disabled />
            <v-list-item
              v-for="d in linkable"
              :key="d.id"
              prepend-icon="mdi-file-document-outline"
              :title="d.name"
              :data-testid="`drawer-link-${d.id}`"
              @click="linkDocument(d)"
            />
          </v-list>
        </v-menu>
      </div>
      <v-alert v-if="openError" type="error" variant="tonal" density="compact" class="mb-2" closable :text="openError" @click:close="openError = null" />
      <v-alert v-if="linkError" type="error" variant="tonal" density="compact" class="mb-2" closable :text="linkError" @click:close="linkError = null" />

      <div v-if="meta" class="text-body-2" data-testid="drawer-meta">{{ meta }}</div>
      <div v-for="(line, i) in dateLines" :key="i" class="text-body-2 text-medium-emphasis" data-testid="drawer-dates">{{ line }}</div>

      <!-- (2) findings -->
      <div class="d-flex align-center mt-4 mb-1">
        <div class="text-subtitle-2 flex-grow-1">{{ t('cockpit.drawer.findings') }} ({{ activityFindings.length }})</div>
        <v-btn v-if="activityFindings.length" size="small" variant="text" :text="t('cockpit.drawer.allFindings')" @click="emit('showFindings', activity.iri)" />
      </div>
      <div v-if="!activityFindings.length" class="text-body-2 text-medium-emphasis mb-2">{{ t('cockpit.drawer.noFindings') }}</div>
      <div class="finding-rows mb-2" data-testid="drawer-findings">
        <button
          v-for="f in activityFindings"
          :key="f.id"
          type="button"
          class="finding-row"
          :title="t('cockpit.drawer.openFinding')"
          data-testid="drawer-finding-row"
          @click="emit('openFinding', f)"
        >
          <v-icon icon="mdi-circle" size="x-small" :color="dotColor(f.severity)" :title="t(`severity.${f.severity}`)" />
          <span class="finding-row-title">{{ f.title }}</span>
          <span class="text-caption text-medium-emphasis text-no-wrap">{{ f.ruleId }}</span>
          <v-icon icon="mdi-chevron-right" size="small" class="text-medium-emphasis" />
        </button>
      </div>

      <template v-if="dayGroups.length">
        <div class="text-subtitle-2 mt-3 mb-1">{{ t('cockpit.drawer.dayFindings') }} ({{ dayGroups.length }})</div>
        <div class="finding-rows mb-2" data-testid="drawer-day-findings">
          <button
            v-for="g in dayGroups"
            :key="g.key"
            type="button"
            class="finding-row"
            :title="t('cockpit.drawer.openFinding')"
            data-testid="drawer-finding-row"
            @click="emit('openFinding', g.findings[0]!)"
          >
            <v-icon icon="mdi-circle" size="x-small" :color="dotColor(g.severity)" :title="t(`severity.${g.severity}`)" />
            <span class="finding-row-title">
              {{ g.findings[0]!.title }}
              <span v-if="g.dates.length" class="text-medium-emphasis" data-testid="drawer-day-finding-dates">· {{ groupDates(g) }}</span>
            </span>
            <span class="text-caption text-medium-emphasis text-no-wrap">{{ g.ruleId }}</span>
            <v-icon icon="mdi-chevron-right" size="small" class="text-medium-emphasis" />
          </button>
        </div>
      </template>

      <!-- (3) Coach-Befunde -->
      <div class="d-flex align-center mt-4 mb-2">
        <div class="text-subtitle-2 flex-grow-1">{{ t('cockpit.drawer.manual.title') }} ({{ manualOwn.length }})</div>
        <v-btn
          size="small"
          variant="tonal"
          color="primary"
          prepend-icon="mdi-comment-plus-outline"
          :text="t('findings.manual.add')"
          data-testid="drawer-add-finding"
          @click="addOpen = true"
        />
      </div>
      <ManualFindingList v-if="manualOwn.length" :camp-iri="campIri" :items="manualOwn" compact class="mb-3" data-testid="drawer-manual-list" />
      <ManualFindingDialog v-model="addOpen" :camp-iri="campIri" scope="activity" :activity-iri="activity.iri" :title="activity.title" />

      <!-- (4) Ablauf / Sicherheit -->
      <div class="text-subtitle-2 mt-4">{{ t('cockpit.drawer.storyboard') }}</div>
      <div v-if="storyboard" class="text-body-2 text-pre-wrap mb-3" data-testid="drawer-storyboard">{{ storyboard }}</div>
      <div v-else class="text-body-2 text-medium-emphasis mb-3">{{ t('cockpit.drawer.noStoryboard') }}</div>

      <div class="text-subtitle-2">{{ t('cockpit.drawer.safety') }}</div>
      <div v-if="safety" class="text-body-2 text-pre-wrap mb-2" data-testid="drawer-safety">{{ safety }}</div>
      <div v-else class="text-body-2 text-warning mb-2" data-testid="drawer-no-safety">{{ t('cockpit.drawer.noSafety') }}</div>
      <v-btn
        v-if="isLong"
        size="small"
        variant="text"
        class="mb-2"
        :prepend-icon="showAll ? 'mdi-chevron-up' : 'mdi-chevron-down'"
        :text="showAll ? t('cockpit.drawer.showLess') : t('cockpit.drawer.showAll')"
        data-testid="drawer-show-all"
        @click="showAll = !showAll"
      />
      <div class="mb-3">
        <AiSafetyReviewButton :activity="activity" :facts="facts" @findings="emit('aiFindings', $event)" />
      </div>

      <!-- (5) collapsed: tags + documents -->
      <v-expansion-panels variant="accordion" flat class="drawer-more">
        <v-expansion-panel>
          <v-expansion-panel-title class="px-0 text-subtitle-2" data-testid="drawer-more">{{ t('cockpit.drawer.more') }}</v-expansion-panel-title>
          <v-expansion-panel-text>
            <ActivityTagEditor :camp-iri="campIri" :activity-iri="activity.iri" :category-class="category ? classOf(category.iri) : null" />

            <div class="text-subtitle-2">{{ t('cockpit.drawer.documents') }}</div>
            <div v-if="docs.length" class="d-flex flex-wrap ga-1 mb-2" data-testid="drawer-docs">
              <v-chip
                v-for="d in docs"
                :key="d.id"
                size="small"
                prepend-icon="mdi-file-document-outline"
                :text="d.name"
                @click="emit('openDocument', d.id)"
              />
            </div>
            <div v-else class="text-body-2 text-medium-emphasis mb-2">{{ t('cockpit.drawer.noDocuments') }}</div>
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-file-document-multiple-outline"
              :text="t('cockpit.drawer.openDocuments')"
              @click="emit('openDocument', docs[0]?.id ?? null)"
            />
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </div>
  </v-navigation-drawer>
</template>

<style scoped>
.drawer-title {
  overflow-wrap: anywhere;
  padding-top: 4px;
}
.finding-rows {
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 6px;
}
.finding-rows:empty {
  display: none;
}
.finding-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  text-align: left;
  font-size: 0.875rem;
  cursor: pointer;
  background: transparent;
  color: inherit;
}
.finding-row + .finding-row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.finding-row:hover,
.finding-row:focus-visible {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.finding-row-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}
.drawer-more :deep(.v-expansion-panel-text__wrapper) {
  padding-left: 0;
  padding-right: 0;
}
</style>
