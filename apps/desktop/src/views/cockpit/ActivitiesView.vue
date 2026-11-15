<script setup lang="ts">
/** /lager/:campId/aktivitaeten: all activities as a dense, sortable list with filters; row click opens the drawer. */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { campIdFromIri } from '@/domain/iri'
import { formatClock, formatDateShort, formatMinutes, SEVERITIES } from '@/domain/cockpit'
import { listDocuments } from '@/domain/documents/store'
import { triageLocation } from '@/domain/triage'
import type { CategoryClass, DocumentRecord, Finding, Iri, Severity } from '@/domain/types'
import ActivityDrawer from '@/components/cockpit/ActivityDrawer.vue'
import { useCockpit } from '@/components/cockpit/useCockpit'
import {
  DEFAULT_ROW_FILTER,
  buildRows,
  filterRows,
  sortRows,
  stateFromQuery,
  stateToQuery,
  type ActivityRow,
  type ListState,
  type RowEntry,
  type SortKey,
} from '@/components/activities/activityRows'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const { campIri, factsHandle, settings, findingsHandle } = useCockpit()
const mappingConfirmed = settings.mappingConfirmed
const { facts } = factsHandle

const state = reactive<ListState>(stateFromQuery(route.query))
const documents = ref<DocumentRecord[]>([])
const selected = ref<Iri | null>(null)
const drawer = ref(false)
async function loadDocuments() {
  try {
    documents.value = await listDocuments(campIri.value)
  } catch {
    documents.value = []
  }
}
onMounted(loadDocuments)

// Deep link from the central search: ?activity=<iri> opens that activity's drawer, then the param is dropped.
function openFromQuery() {
  const a = route.query.activity
  const iri = Array.isArray(a) ? a[0] : a
  if (!iri) return
  select(iri as Iri)
  const { activity: _drop, ...rest } = route.query
  void router.replace({ query: rest })
}
onMounted(openFromQuery)
watch(() => route.query.activity, openFromQuery)

// Filters live in the URL (replace, so back navigation leaves the tab instead of undoing keystrokes).
watch(
  () => ({ ...state }),
  (s) => {
    void router.replace({ query: stateToQuery(s, route.query) })
  },
)

const excludedAll = computed(() => findingsHandle.categoryExclusions.value.filter((e) => e.ruleId === null))
const allRows = computed(() =>
  facts.value
    ? buildRows(
        facts.value,
        findingsHandle.findings.value,
        documents.value,
        settings.classOf,
        (categoryIri) => !!categoryIri && excludedAll.value.some((e) => e.categoryIri === categoryIri),
      )
    : [],
)
const rows = computed(() => sortRows(filterRows(allRows.value, state), state.sort, state.dir))

const CLASSES: CategoryClass[] = ['LS', 'LA', 'LP', 'ES']
const classItems = computed(() => CLASSES.map((c) => ({ value: c, title: `${t(`categoryClass.${c}`)} (${c})` })))
const dayItems = computed(() =>
  (facts.value?.days ?? [])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ value: d.date, title: t('activities.day', { n: d.number, date: formatDateShort(d.date) }) })),
)
const filtered = computed(
  () => JSON.stringify({ ...state, sort: 0, dir: 0 }) !== JSON.stringify({ ...DEFAULT_ROW_FILTER, sort: 0, dir: 0 }),
)
function resetFilters() {
  Object.assign(state, DEFAULT_ROW_FILTER)
}

// The table only displays: order comes from sortRows (headers return 0 so Vuetify keeps it).
const keep = () => 0
const headers = computed(() => {
  const h = (key: SortKey, title: string, extra: Record<string, unknown> = {}) => ({
    key,
    title: t(`activities.columns.${title}`),
    sortable: true,
    sortRaw: keep,
    ...extra,
  })
  return [
    h('number', 'number', { width: 70 }),
    h('title', 'title'),
    h('findings', 'findings'),
    h('time', 'time'),
    h('category', 'category'),
    h('responsibles', 'responsibles'),
    h('progress', 'progress'),
    h('location', 'location', { minWidth: 120 }),
    h('duration', 'duration', { align: 'end' }),
  ]
})
const sortBy = computed(() => [{ key: state.sort, order: state.dir }])
function onSort(v: { key: string; order?: 'asc' | 'desc' | boolean }[]) {
  const first = v[0]
  if (!first) {
    Object.assign(state, { sort: 'time', dir: 'asc' })
    return
  }
  state.sort = first.key as SortKey
  state.dir = first.order === 'desc' ? 'desc' : 'asc'
}

function entryLabel(e: RowEntry): string {
  const day = e.dayNumber !== null ? t('activities.entryDay', { n: e.dayNumber }) : formatDateShort(e.date)
  return `${day} ${formatClock(e.startMin)}–${formatClock(e.endMin)}`
}

function select(iri: Iri) {
  selected.value = iri
  drawer.value = true
}
function onRowClick(_e: Event, { item }: { item: ActivityRow }) {
  select(item.iri)
}
/** Stepping from the drawer (↑/↓, buttons): swap the content and keep the row visible. */
function step(iri: Iri) {
  select(iri)
  void nextTick(() => document.querySelector(`[data-iri="${CSS.escape(iri)}"]`)?.scrollIntoView({ block: 'nearest' }))
}
const order = computed(() => rows.value.map((r) => r.iri))
const rowProps = ({ item }: { item: ActivityRow }) => ({
  'data-iri': item.iri,
  class: drawer.value && selected.value === item.iri ? 'row-selected' : '',
})
function openFinding(f: Finding) {
  void router.push(triageLocation(campIri.value, f.id))
}
function checkMapping() {
  void router.push({ name: 'camp-grid', params: { campId: campIdFromIri(campIri.value) }, query: { zuordnung: '1' } })
}
// «Soll» / «Hinweis»: Muss red, Soll orange, Hinweis neutral (colour = state).
const chipColor = (s: Severity) => (s === 'must' ? 'error' : s === 'should' ? 'warning' : undefined)
const durationText = (r: ActivityRow) =>
  r.durationRepeat
    ? t('activities.durationRepeated', { count: r.durationRepeat.count, time: formatMinutes(r.durationRepeat.minutes) })
    : r.durationMinutes
      ? formatMinutes(r.durationMinutes)
      : ''

function openDocument(documentId: string | null) {
  void router.push({
    name: 'camp-documents',
    params: { campId: campIdFromIri(campIri.value) },
    query: documentId ? { doc: documentId } : {},
  })
}
function showFindings(iri: Iri) {
  void router.push({ name: 'camp-findings', params: { campId: campIdFromIri(campIri.value) }, query: { activity: iri } })
}
function showInGrid(iri: Iri) {
  void router.push({ name: 'camp-grid', params: { campId: campIdFromIri(campIri.value) }, query: { activity: iri } })
}
</script>

<template>
  <div class="activities-view">
    <p class="text-body-2 text-medium-emphasis mb-3">{{ t('activities.intro') }}</p>

    <v-alert v-if="!facts" type="info" variant="tonal" density="compact" :text="t('cockpit.waiting')" />
    <v-alert v-else-if="!allRows.length" type="info" variant="tonal" density="compact" :text="t('activities.empty')" />
    <template v-else>
      <v-alert
        v-if="!mappingConfirmed"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-3"
        :text="t('activities.mappingPending')"
        data-testid="activities-mapping-pending"
      >
        <template #append>
          <v-btn variant="text" size="small" :text="t('activities.mappingCheck')" data-testid="activities-mapping-check" @click="checkMapping" />
        </template>
      </v-alert>
      <div class="d-flex flex-wrap align-center ga-3 mb-2">
        <v-text-field
          v-model="state.q"
          :label="t('activities.search')"
          prepend-inner-icon="mdi-magnify"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="filter-search"
          data-testid="activities-search"
        />
        <v-select
          v-model="state.categoryClass"
          :items="classItems"
          :label="t('activities.filters.class')"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="filter-select"
          data-testid="activities-class"
        />
        <v-select
          v-model="state.date"
          :items="dayItems"
          :label="t('activities.filters.day')"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="filter-select"
          data-testid="activities-day"
        />
        <v-checkbox
          v-model="state.onlyFindings"
          :label="t('activities.filters.onlyFindings')"
          density="compact"
          hide-details
          data-testid="activities-only-findings"
        />
        <v-checkbox
          v-model="state.noResponsible"
          :label="t('activities.filters.noResponsible')"
          density="compact"
          hide-details
          data-testid="activities-no-responsible"
        />
        <v-btn v-if="filtered" variant="text" size="small" :text="t('activities.filters.reset')" @click="resetFilters" />
      </div>
      <div class="text-caption text-medium-emphasis mb-2" data-testid="activities-count">
        {{ t('activities.count', { shown: rows.length, total: allRows.length }) }}
      </div>

      <v-data-table
        :headers="headers"
        :items="rows"
        item-value="iri"
        density="compact"
        class="activities-table"
        :items-per-page="-1"
        hide-default-footer
        must-sort
        :sort-by="sortBy"
        :no-data-text="state.onlyFindings && !mappingConfirmed ? t('activities.noFindingsYet') : t('activities.noMatch')"
        :row-props="rowProps"
        hover
        @update:sort-by="onSort"
        @click:row="onRowClick"
      >
        <template #[`item.number`]="{ item }">
          <span class="text-no-wrap">{{ item.number ?? '' }}</span>
        </template>
        <template #[`item.title`]="{ item }">
          <span class="font-weight-medium">{{ item.title }}</span>
        </template>
        <template #[`item.category`]="{ item }">
          <div v-if="item.categoryShort" class="d-flex align-center ga-1 text-no-wrap">
            <span class="cat-dot" :style="{ backgroundColor: item.categoryColor ?? '#9e9e9e' }" />
            <span>{{ item.categoryShort }}</span>
            <v-icon
              v-if="item.categoryExcluded"
              icon="mdi-eye-off"
              size="x-small"
              :title="t('activities.categoryExcluded')"
              :aria-label="t('activities.categoryExcluded')"
              data-testid="activity-category-excluded"
            />
            <v-chip
              v-if="item.categoryClass !== 'NONE'"
              size="x-small"
              label
              :variant="mappingConfirmed ? 'flat' : 'outlined'"
              :class="mappingConfirmed ? 'text-white' : ''"
              :style="mappingConfirmed ? { backgroundColor: item.categoryColor ?? '#9e9e9e' } : {}"
              :text="mappingConfirmed ? item.categoryClass : `${item.categoryClass}?`"
              :title="mappingConfirmed ? undefined : t('activities.classGuess')"
              data-testid="activity-class-chip"
            />
          </div>
        </template>
        <template #[`item.time`]="{ item }">
          <div v-if="item.entries.length" class="text-no-wrap">
            {{ entryLabel(item.entries[0]!) }}
            <v-chip
              v-if="item.entries.length > 1"
              size="x-small"
              label
              :text="t('activities.moreEntries', { count: item.entries.length - 1 })"
              :title="item.entries.map(entryLabel).join('\n')"
            />
          </div>
        </template>
        <template #[`item.duration`]="{ item }">
          <span class="text-no-wrap">{{ durationText(item) }}</span>
        </template>
        <template #[`item.responsibles`]="{ item }">
          <span>{{ item.responsibles.join(', ') }}</span>
        </template>
        <template #[`item.findings`]="{ item }">
          <div class="d-flex align-center ga-1 text-no-wrap">
            <template v-for="s in SEVERITIES" :key="s">
              <v-chip
                v-if="item.findings[s]"
                size="x-small"
                label
                variant="tonal"
                :color="chipColor(s)"
                :text="t('activities.findingsChip', { count: item.findings[s], severity: t(`severity.${s}`) })"
              />
            </template>
            <span
              v-if="item.manualCount"
              class="count-icon text-primary"
              :title="t('activities.manual.count', { count: item.manualCount })"
              data-testid="activity-manual-count"
            >
              <v-icon icon="mdi-comment-text-outline" size="x-small" />{{ item.manualCount }}
            </span>
            <span
              v-if="item.documentCount"
              class="count-icon text-medium-emphasis"
              :title="t('activities.documentCount', { count: item.documentCount })"
              data-testid="activity-doc-count"
            >
              <v-icon icon="mdi-file-document-outline" size="x-small" />{{ item.documentCount }}
            </span>
          </div>
        </template>
      </v-data-table>
    </template>

    <ActivityDrawer
      v-model="drawer"
      :activity-iri="selected"
      :camp-iri="campIri"
      :facts="facts"
      :findings="findingsHandle.findings.value"
      :class-of="settings.classOf"
      :order="order"
      step-keys="vertical"
      can-show-in-grid
      @select="step"
      @open-finding="openFinding"
      @show-findings="showFindings"
      @show-in-grid="showInGrid"
      @open-document="openDocument"
      @ai-findings="findingsHandle.addAiFindings($event)"
      @linked="loadDocuments"
    />
  </div>
</template>

<style scoped>
.activities-view {
  min-width: 0;
  max-width: 100%;
}
.filter-search {
  flex: 1 1 260px;
  min-width: 200px;
  max-width: 360px;
}
.filter-select {
  flex: 0 1 180px;
  min-width: 140px;
}
.activities-table :deep(tbody tr) {
  cursor: pointer;
}
.activities-table :deep(td),
.activities-table :deep(th) {
  padding: 0 8px !important;
}
.activities-table :deep(td) {
  vertical-align: middle;
}
.activities-table :deep(tbody tr.row-selected) {
  background: rgba(var(--v-theme-primary), 0.1);
}
.count-icon {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 0.75rem;
}
.cat-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
</style>
