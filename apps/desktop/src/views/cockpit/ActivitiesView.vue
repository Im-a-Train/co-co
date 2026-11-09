<script setup lang="ts">
/** /lager/:campId/aktivitaeten: all activities as a dense, sortable list with filters; row click opens the drawer. */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { campIdFromIri } from '@/domain/iri'
import { formatClock, formatDateShort, formatMinutes, severityColor, SEVERITIES } from '@/domain/cockpit'
import { listDocuments } from '@/domain/documents/store'
import { triageLocation } from '@/domain/triage'
import type { CategoryClass, DocumentRecord, Finding, Iri } from '@/domain/types'
import ActivityDrawer from '@/components/cockpit/ActivityDrawer.vue'
import ManualFindingDialog from '@/components/cockpit/ManualFindingDialog.vue'
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
const { facts } = factsHandle

const state = reactive<ListState>(stateFromQuery(route.query))
const documents = ref<DocumentRecord[]>([])
const selected = ref<Iri | null>(null)
const drawer = ref(false)
const addFor = ref<ActivityRow | null>(null)
const addOpen = ref(false)
function addFinding(row: ActivityRow) {
  addFor.value = row
  addOpen.value = true
}

onMounted(async () => {
  try {
    documents.value = await listDocuments(campIri.value)
  } catch {
    documents.value = []
  }
})

// Filters live in the URL (replace, so back navigation leaves the tab instead of undoing keystrokes).
watch(
  () => ({ ...state }),
  (s) => {
    void router.replace({ query: stateToQuery(s, route.query) })
  },
)

const allRows = computed(() =>
  facts.value ? buildRows(facts.value, findingsHandle.findings.value, documents.value, settings.classOf) : [],
)
const rows = computed(() => sortRows(filterRows(allRows.value, state), state.sort, state.dir))

const CLASS_ITEMS: CategoryClass[] = ['LS', 'LA', 'LP', 'ES']
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
    h('category', 'category'),
    h('time', 'time'),
    h('duration', 'duration', { align: 'end' }),
    h('location', 'location', { minWidth: 140 }),
    h('responsibles', 'responsibles'),
    h('progress', 'progress'),
    h('findings', 'findings'),
    { key: 'manual', title: t('activities.manual.column'), sortable: false, align: 'end' as const, width: 70 },
    h('documents', 'documents', { align: 'end', title: t('activities.columns.documentsShort') }),
    { key: 'actions', title: t('activities.columns.actions'), sortable: false, align: 'end' as const, width: 96 },
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
function feedback(f: Finding) {
  void router.push(triageLocation(campIri.value, f.id, { editor: true }))
}
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
    <h1 class="text-h5 mb-1">{{ t('activities.title') }}</h1>
    <p class="text-body-2 text-medium-emphasis mb-3">{{ t('activities.intro') }}</p>

    <v-alert v-if="!facts" type="info" variant="tonal" density="compact" :text="t('cockpit.waiting')" />
    <v-alert v-else-if="!allRows.length" type="info" variant="tonal" density="compact" :text="t('activities.empty')" />
    <template v-else>
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
          :items="CLASS_ITEMS"
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
        :no-data-text="t('activities.noMatch')"
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
            <v-chip
              v-if="item.categoryClass !== 'NONE'"
              size="x-small"
              label
              variant="flat"
              class="text-white"
              :style="{ backgroundColor: item.categoryColor ?? '#9e9e9e' }"
              :text="item.categoryClass"
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
          <span class="text-no-wrap">{{ item.durationMinutes ? formatMinutes(item.durationMinutes) : '' }}</span>
        </template>
        <template #[`item.responsibles`]="{ item }">
          <span>{{ item.responsibles.join(', ') }}</span>
        </template>
        <template #[`item.findings`]="{ item }">
          <div class="d-flex ga-1">
            <template v-for="s in SEVERITIES" :key="s">
              <v-chip
                v-if="item.findings[s]"
                size="x-small"
                label
                variant="tonal"
                :color="severityColor(s)"
                :text="String(item.findings[s])"
                :title="t(`severity.${s}`)"
              />
            </template>
          </div>
        </template>
        <template #[`item.manual`]="{ item }">
          <v-chip
            v-if="item.manualCount"
            size="x-small"
            label
            variant="tonal"
            color="primary"
            prepend-icon="mdi-comment-text-outline"
            :text="String(item.manualCount)"
            :title="t('activities.manual.count', { count: item.manualCount })"
            data-testid="activity-manual-count"
          />
        </template>
        <template #[`item.documents`]="{ item }">
          <span>{{ item.documentCount || '' }}</span>
        </template>
        <template #[`item.actions`]="{ item }">
          <v-btn
            icon="mdi-comment-plus-outline"
            size="x-small"
            variant="text"
            :title="t('activities.manual.add')"
            :aria-label="t('activities.manual.add')"
            data-testid="activity-add-finding"
            @click.stop="addFinding(item)"
          />
          <v-btn
            icon="mdi-calendar-week"
            size="x-small"
            variant="text"
            :title="t('activities.showInGrid')"
            :aria-label="t('activities.showInGrid')"
            @click.stop="showInGrid(item.iri)"
          />
        </template>
      </v-data-table>
    </template>

    <ManualFindingDialog
      v-if="addFor"
      v-model="addOpen"
      :camp-iri="campIri"
      scope="activity"
      :activity-iri="addFor.iri"
      :title="addFor.title"
    />
    <ActivityDrawer
      v-model="drawer"
      :activity-iri="selected"
      :camp-iri="campIri"
      :facts="facts"
      :findings="findingsHandle.findings.value"
      :class-of="settings.classOf"
      @feedback="feedback"
      @show-findings="showFindings"
      @open-document="openDocument"
      @ai-findings="findingsHandle.addAiFindings($event)"
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
.cat-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
</style>
