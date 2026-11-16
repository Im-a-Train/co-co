<script setup lang="ts">
/**
 * /fristen: deadlines across camps (NDS, Leihmaterial, Landeskarten, Lagerbewilligung) plus the
 * milestones of the bundled lists, as ONE list grouped by radarBucket (overdue / this week / next 4
 * weeks / later). Every row except NDS-Pendenzen can be ticked off here (same storage as the checklist).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import DeadlineRow from '@/components/rules/DeadlineRow.vue'
import { emptyCoachInputs, listCoachInputs, saveCoachInputs } from '@/domain/campFacts/store'
import { listCampSummaries } from '@/domain/rules/store'
import {
  archiveDeadlines,
  computeAllDeadlines,
  daysBetween,
  deadlineStatus,
  filterDeadlines,
  isArchivedCamp,
} from '@/domain/rules/lib/deadlines'
import { toIcs } from '@/domain/rules/ics'
import { computeMilestoneDeadlines, loadBundledMilestones, milestoneContextFromConfig, radarBucket, type RadarBucket } from '@/domain/rules/milestones'
import { listCampRuleConfigs, updateCampRuleConfig } from '@/domain/rules/campRuleConfigStore'
import { withChecklistItem } from '@/domain/rules/lib/campConfigEdit'
import { loadBundledChecklist } from '@/domain/rules/lib/checklist'
import { planMilestoneToggle, withDeadlineDone } from '@/domain/rules/lib/checklistSync'
import type { Audience, CampRuleConfig, CoachInputs, Deadline, DeadlineKind, Iri } from '@/domain/types'
import { useCampList } from '@/composables/useCampList'
import { ndsTasksToDeadlines } from '@/domain/nds/tasks'
import { useNds } from '@/composables/useNds'
import { commands, errorMessage, type NdsTask } from '@/lib/tauri'

const { t } = useI18n()
const { camps, loading, error, load } = useCampList()

const inputsByCamp = ref<Record<Iri, CoachInputs>>({})
const inputsError = ref<string | null>(null)
const showDone = ref(false)
const lastJsByCamp = ref<Record<Iri, string | null>>({})
const ruleConfigByCamp = ref<Record<Iri, CampRuleConfig>>({})

const FILTERS_KEY = 'co-co.deadlines.filters'
const KIND_OPTIONS: DeadlineKind[] = ['nds-registration', 'nds-closing', 'leihmaterial', 'landeskarten', 'lagerbewilligung', 'pbs-milestone', 'nds-task']
interface StoredFilters {
  campIris: Iri[]
  kinds: DeadlineKind[]
  showArchived: boolean
  audiences: Audience[]
}
function readFilters(): StoredFilters {
  const empty: StoredFilters = { campIris: [], kinds: [], showArchived: false, audiences: ['coach'] }
  try {
    const raw = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? 'null') as Partial<StoredFilters> | null
    if (!raw || typeof raw !== 'object') return empty
    const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return {
      campIris: strs(raw.campIris),
      kinds: strs(raw.kinds).filter((k): k is DeadlineKind => (KIND_OPTIONS as string[]).includes(k)),
      showArchived: raw.showArchived === true,
      audiences: Array.isArray(raw.audiences) ? strs(raw.audiences).filter((a): a is Audience => a === 'coach' || a === 'leaders') : ['coach'],
    }
  } catch {
    return empty
  }
}
const initialFilters = readFilters()
const filterCamps = ref<Iri[]>(initialFilters.campIris)
const filterKinds = ref<DeadlineKind[]>(initialFilters.kinds)
const showArchived = ref(initialFilters.showArchived)
/**
 * Audience filter: default only coach deadlines; none selected = all. Stored as before, shown as a two-way
 * toggle, so an older stored value (e.g. only «leaders» from the former chips) is read as «all».
 */
const filterAudiences = ref<Audience[]>(initialFilters.audiences.length === 1 && initialFilters.audiences[0] === 'coach' ? ['coach'] : [])
const scope = computed<'mine' | 'all'>({
  get: () => (filterAudiences.value.length === 1 && filterAudiences.value[0] === 'coach' ? 'mine' : 'all'),
  set: (v) => {
    filterAudiences.value = v === 'mine' ? ['coach'] : []
  },
})
watch([filterCamps, filterKinds, showArchived, filterAudiences], () => {
  try {
    const v: StoredFilters = {
      campIris: [...filterCamps.value],
      kinds: [...filterKinds.value],
      showArchived: showArchived.value,
      audiences: [...filterAudiences.value],
    }
    localStorage.setItem(FILTERS_KEY, JSON.stringify(v))
  } catch {
    /* storage unavailable: the filters just are not remembered */
  }
})
/** The scope toggle shows its own state, so «Filter zurücksetzen» only covers camp and kind. */
const hasFilters = computed(() => activeCampFilter.value.length > 0 || filterKinds.value.length > 0)
function resetFilters() {
  filterCamps.value = []
  filterKinds.value = []
}
const kindItems = computed(() => KIND_OPTIONS.map((k) => ({ value: k, title: t(`rules.deadlines.kindShort.${k}`) })))

const milestoneList = loadBundledMilestones()
/** Checklist items linked to a milestone share its done state. */
const checklistItems = loadBundledChecklist()

async function loadInputs() {
  try {
    lastJsByCamp.value = Object.fromEntries((await listCampSummaries()).map((s) => [s.campIri, s.lastJsDate ?? null]))
    inputsByCamp.value = Object.fromEntries((await listCoachInputs()).map((i) => [i.campIri, i]))
    ruleConfigByCamp.value = Object.fromEntries((await listCampRuleConfigs()).map((c) => [c.campIri, c]))
    inputsError.value = null
  } catch (e) {
    inputsError.value = e instanceof Error ? e.message : String(e)
  }
}

// NDS «Pendenzen» (red zone): component memory only, never persisted, never exported anywhere but the ICS file.
const nds = useNds()
const ndsReady = computed(() => nds.enabled.value && nds.connected.value)
/** Hint only for coaches who switched NDS on but have not connected it (NDS is off by default). */
const ndsHintVisible = computed(() => nds.enabled.value && !nds.connected.value)
const ndsTasks = ref<NdsTask[]>([])
const ndsLoadedAt = ref<Date | null>(null)
const ndsLoading = ref(false)
const ndsError = ref<string | null>(null)
async function loadNdsTasks() {
  ndsLoading.value = true
  ndsError.value = null
  try {
    ndsTasks.value = await commands.ndsFetchTasks()
    ndsLoadedAt.value = new Date()
  } catch (e) {
    ndsError.value = errorMessage(e)
  } finally {
    ndsLoading.value = false
  }
}
watch(ndsReady, (ready) => {
  if (!ready) {
    ndsTasks.value = []
    ndsLoadedAt.value = null
  }
})
const ndsDeadlines = computed<Deadline[]>(() =>
  ndsTasksToDeadlines(ndsTasks.value, today.value, { escalation: (date) => t('rules.deadlines.ndsTasks.escalation', { date: fmt(date) }) }),
)
const ndsStand = computed(() =>
  ndsLoadedAt.value
    ? t('rules.deadlines.ndsTasks.stand', {
        time: ndsLoadedAt.value.toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }),
        count: ndsDeadlines.value.length,
      })
    : null,
)

onMounted(() => {
  void nds.init()
  void load()
  void loadInputs()
})
watch(camps, () => void loadInputs())

const today = computed(() => new Date().toISOString().slice(0, 10))

const campById = computed(() => new Map(camps.value.map((c) => [c.iri, c])))

const deadlineCamps = computed(() =>
  camps.value
    .filter((c) => !c.isPrototype)
    .map((c) => ({ iri: c.iri, title: c.title, start: c.start, end: c.end, lastJsDate: lastJsByCamp.value[c.iri] ?? null, lastActivityDate: ruleConfigByCamp.value[c.iri]?.angebot?.lastActivityDate ?? null })),
)

/** Camp selector: only camps that are not archived; the autocomplete shows only with more than one. */
const campOptions = computed(() => deadlineCamps.value.filter((c) => !isArchivedCamp(c.end, today.value)).map((c) => ({ value: c.iri, title: c.title })))
/** A stored camp filter only applies while the autocomplete is shown and offers that camp (no invisible filter). */
const activeCampFilter = computed<Iri[]>(() => {
  if (campOptions.value.length <= 1) return []
  const offered = new Set(campOptions.value.map((o) => o.value))
  return filterCamps.value.filter((iri) => offered.has(iri))
})

/** Every deadline incl. archived ones (camp ended more than a month ago: done, computed, never stored). */
const allDeadlines = computed<Deadline[]>(() => {
  const all = [...computeAllDeadlines(deadlineCamps.value, inputsByCamp.value), ...ndsDeadlines.value]
  const ends = Object.fromEntries(deadlineCamps.value.map((c) => [c.iri, c.end]))
  const ms = deadlineCamps.value.flatMap((c) =>
    computeMilestoneDeadlines(c, inputsByCamp.value[c.iri] ?? null, milestoneList, milestoneContextFromConfig(ruleConfigByCamp.value[c.iri])),
  )
  const merged = [...all, ...ms].sort((a, b) =>
    a.due < b.due ? -1 : a.due > b.due ? 1 : a.campTitle.localeCompare(b.campTitle) || a.kind.localeCompare(b.kind) || (a.milestoneId ?? '').localeCompare(b.milestoneId ?? ''),
  )
  return archiveDeadlines(merged, ends, today.value)
})

const archivedCount = computed(() => new Set(allDeadlines.value.filter((d) => d.archived).map((d) => d.campIri)).size)

/** Deadlines after archive switch, scope and camp/kind filters: feeds the grouped list and the ICS export. */
const deadlines = computed<Deadline[]>(() =>
  filterDeadlines(
    allDeadlines.value.filter(
      (d) => (showArchived.value || !d.archived) && (!filterAudiences.value.length || filterAudiences.value.includes(d.audience ?? 'coach')),
    ),
    { campIris: activeCampFilter.value, kinds: filterKinds.value, statuses: [] },
    today.value,
  ),
)

function titleOf(d: Deadline): string {
  return d.kind === 'pbs-milestone' || d.kind === 'nds-task' ? (d.title ?? d.milestoneId ?? '') : t(`rules.deadlines.kind.${d.kind}`)
}

function rowKey(d: Deadline): string {
  return `${d.campIri}:${d.kind}${d.milestoneId ? `:${d.milestoneId}` : ''}`
}

const allRows = computed(() =>
  deadlines.value.map((d) => {
    const builtIn = d.kind !== 'pbs-milestone' && d.kind !== 'nds-task'
    return {
      ...d,
      key: rowKey(d),
      campId: campById.value.get(d.campIri)?.id ?? d.campIri.split('/').pop() ?? '',
      status: deadlineStatus(d, today.value),
      left: daysBetween(today.value, d.due),
      bucket: radarBucket(d, today.value),
      title: builtIn ? t(`rules.deadlines.kindTitle.${d.kind}`) : titleOf(d),
      ...(builtIn ? { titleHint: t(`rules.deadlines.kind.${d.kind}`) } : {}),
    }
  }),
)

const rows = computed(() => allRows.value.filter((r) => showDone.value || !r.done || r.archived))

type GroupBucket = RadarBucket
const GROUP_ORDER: GroupBucket[] = ['overdue', 'week', 'month', 'later', 'done']
const groups = computed(() =>
  GROUP_ORDER.map((bucket) => ({ bucket, items: rows.value.filter((r) => r.bucket === bucket) })).filter((g) => g.bucket !== 'done' || g.items.length > 0),
)
/** «Später» is collapsed by default, unless nothing is due before it (off-season: the page would show no row). */
const openState = ref<Partial<Record<GroupBucket, boolean>>>({})
const nothingDueSoon = computed(() => !rows.value.some((r) => r.bucket === 'overdue' || r.bucket === 'week' || r.bucket === 'month'))
const isOpen = (b: GroupBucket): boolean => openState.value[b] ?? (b !== 'later' || nothingDueSoon.value)
function toggleGroup(b: GroupBucket) {
  openState.value = { ...openState.value, [b]: !isOpen(b) }
}

const summary = computed(() => ({
  week: allRows.value.filter((r) => r.bucket === 'week').length,
  overdue: allRows.value.filter((r) => r.bucket === 'overdue').length,
}))
/** The asterisk legend only while an asterisk is on screen (not for rows inside a collapsed group). */
const legendVisible = computed(() => rows.value.some((r) => isOpen(r.bucket) && r.kind === 'pbs-milestone' && r.confidence === 'unverified'))

type DeadlineRowData = Deadline & { title: string }
const saveError = ref<string | null>(null)

/** Writes the done state of any deadline (same storage as the camp checklist); milestones also sync their checklist twins. */
async function toggleDone(row: DeadlineRowData, done: boolean): Promise<boolean> {
  if (row.kind === 'nds-task') return false
  try {
    // Plain copy: IndexedDB cannot clone Vue reactive proxies.
    const stored = inputsByCamp.value[row.campIri]
    const current: CoachInputs = stored ? JSON.parse(JSON.stringify(stored)) : emptyCoachInputs(row.campIri)
    // withDeadlineDone also writes a milestone's skipped twins (alsoNamed), so their old ticks cannot resurface.
    const next = withDeadlineDone(current, row, done, today.value)
    await saveCoachInputs(next)
    inputsByCamp.value = { ...inputsByCamp.value, [row.campIri]: next }
    // Linked checklist items share the state (sequential: the stores are not written atomically).
    if (row.milestoneId) {
      for (const c of planMilestoneToggle(row.milestoneId, done, checklistItems).checklist) {
        await updateCampRuleConfig(row.campIri, (cfg) => withChecklistItem(cfg, c.id, { done: c.done }))
      }
    }
    saveError.value = null
    return true
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
    return false
  }
}

const snackOpen = ref(false)
const snackText = ref('')
const lastTicked = ref<DeadlineRowData | null>(null)
async function onToggle(row: DeadlineRowData, done: boolean) {
  const ok = await toggleDone(row, done)
  if (!ok || !done) return
  lastTicked.value = row
  snackText.value = t('rules.deadlines.doneSnack', { title: row.title, camp: row.campTitle })
  snackOpen.value = true
}
async function undo() {
  const row = lastTicked.value
  snackOpen.value = false
  lastTicked.value = null
  if (row) await toggleDone(row, false)
}

const exportMessage = ref<string | null>(null)
const exportError = ref<string | null>(null)
async function exportIcs() {
  exportMessage.value = null
  exportError.value = null
  try {
    const ics = toIcs(deadlines.value, { titleOf, now: new Date(), calendarName: t('rules.deadlines.exportCalendarName') })
    const path = await commands.saveTextFile('co-co-fristen.ics', ics)
    exportMessage.value = path ? t('rules.deadlines.exportSaved', { path }) : t('rules.deadlines.exportCancelled')
  } catch (e) {
    exportError.value = e instanceof Error ? e.message : String(e)
  }
}


function fmt(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

</script>

<template>
  <div>
    <h1 class="text-h5 mb-1">{{ t('rules.deadlines.title') }}</h1>
    <p class="text-body-2 text-medium-emphasis mb-1">{{ t('rules.deadlines.intro') }}</p>
    <p v-if="allDeadlines.length" class="text-body-2 font-weight-medium mb-3" data-testid="deadlines-summary">
      {{ t('rules.deadlines.summary', { week: summary.week, overdue: summary.overdue }) }}
    </p>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">
      {{ t('rules.deadlines.loadFailed') }}: {{ error }}
    </v-alert>
    <v-alert v-if="saveError" type="error" variant="tonal" density="compact" class="mb-4">
      {{ t('rules.deadlines.saveFailed') }}: {{ saveError }}
    </v-alert>

    <div class="d-flex align-center flex-wrap ga-3 mb-2" data-testid="deadline-filters">
      <v-autocomplete
        v-if="campOptions.length > 1"
        v-model="filterCamps"
        :items="campOptions"
        :label="t('rules.deadlines.filters.camps')"
        :placeholder="t('rules.deadlines.filters.allCamps')"
        persistent-placeholder
        multiple
        chips
        closable-chips
        clearable
        density="compact"
        variant="outlined"
        hide-details
        style="min-width: 240px; max-width: 420px"
        data-testid="filter-camps"
      />
      <v-btn-toggle v-model="scope" mandatory density="compact" variant="outlined" divided color="primary" data-testid="filter-scope">
        <v-btn value="mine" size="small" data-testid="scope-mine">{{ t('rules.deadlines.scopeMine') }}</v-btn>
        <v-btn value="all" size="small" data-testid="scope-all">{{ t('rules.deadlines.scopeAll') }}</v-btn>
      </v-btn-toggle>
      <v-btn v-if="hasFilters" size="small" variant="text" data-testid="filters-reset" @click="resetFilters">
        {{ t('rules.deadlines.filters.reset') }}
      </v-btn>
      <v-spacer />
      <v-progress-circular v-if="loading" indeterminate size="20" width="2" />
      <v-btn
        v-if="ndsReady"
        size="small"
        variant="text"
        prepend-icon="mdi-shield-lock-outline"
        :loading="ndsLoading"
        data-testid="nds-tasks-load"
        @click="loadNdsTasks"
      >
        {{ ndsLoadedAt ? t('rules.deadlines.ndsTasks.reload') : t('rules.deadlines.ndsTasks.load') }}
      </v-btn>
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-calendar-export"
        :disabled="!deadlines.length"
        data-testid="export-ics"
        @click="exportIcs"
      >
        {{ t('rules.deadlines.exportIcs') }}
      </v-btn>
      <v-menu :close-on-content-click="false">
        <template #activator="{ props: menuProps }">
          <v-btn v-bind="menuProps" size="small" variant="text" append-icon="mdi-menu-down" data-testid="deadlines-more">
            {{ t('rules.deadlines.more') }}
          </v-btn>
        </template>
        <v-card min-width="280" class="pa-3">
          <v-select
            v-model="filterKinds"
            :items="kindItems"
            :label="t('rules.deadlines.filters.kinds')"
            :placeholder="t('rules.deadlines.filters.allKinds')"
            persistent-placeholder
            multiple
            chips
            closable-chips
            clearable
            density="compact"
            variant="outlined"
            hide-details
            class="mb-2"
            data-testid="filter-kinds"
          />
          <v-switch v-model="showDone" :label="t('rules.deadlines.showDone')" density="compact" hide-details color="primary" data-testid="done-switch" />
          <v-switch
            v-model="showArchived"
            :label="t('rules.deadlines.showArchived') + (archivedCount ? ` (${archivedCount})` : '')"
            :title="t('rules.deadlines.archivedHint')"
            density="compact"
            hide-details
            color="primary"
            data-testid="archived-switch"
          />
        </v-card>
      </v-menu>
    </div>
    <div v-if="ndsHintVisible" class="text-caption text-medium-emphasis mb-2" data-testid="nds-tasks-hint">
      {{ t('rules.deadlines.ndsTasks.notConnected') }}
      <RouterLink to="/einstellungen">{{ t('rules.deadlines.ndsTasks.toSettings') }}</RouterLink>
    </div>
    <div v-else-if="ndsReady && ndsStand" class="text-caption text-medium-emphasis mb-2" data-testid="nds-tasks-stand">
      {{ ndsStand }}. {{ t('rules.deadlines.ndsTasks.hint') }}
    </div>
    <v-alert v-if="ndsError" type="error" variant="tonal" density="compact" class="mb-2" data-testid="nds-tasks-error">
      {{ t('rules.deadlines.ndsTasks.loadFailed') }}: {{ ndsError }}
    </v-alert>
    <v-alert v-if="exportMessage" type="success" variant="tonal" density="compact" class="mb-2" data-testid="export-message">{{ exportMessage }}</v-alert>
    <v-alert v-if="exportError" type="error" variant="tonal" density="compact" class="mb-2" data-testid="export-error">
      {{ t('rules.deadlines.exportFailed') }}: {{ exportError }}
    </v-alert>

    <v-alert
      v-if="!loading && !error && allDeadlines.length === 0"
      type="info"
      variant="tonal"
      density="compact"
      :text="t('rules.deadlines.empty')"
    />
    <v-alert
      v-else-if="!loading && !error && allRows.length === 0"
      type="info"
      variant="tonal"
      density="compact"
      :text="t('rules.deadlines.filters.noMatch')"
      data-testid="filters-no-match"
    />

    <template v-else-if="allDeadlines.length">
      <p v-if="legendVisible" class="text-caption text-medium-emphasis mb-2" data-testid="legend-unconfirmed">{{ t('rules.deadlines.legendUnconfirmed') }}</p>
      <section v-for="g in groups" :key="g.bucket" class="mb-3" :data-testid="`group-${g.bucket}`">
        <div v-if="!g.items.length" class="text-body-2 text-medium-emphasis px-1" :data-testid="`group-empty-${g.bucket}`">
          {{ g.bucket === 'overdue' ? t('rules.deadlines.groups.emptyOverdue') : t('rules.deadlines.groups.empty', { bucket: t(`rules.deadlines.groups.${g.bucket}`) }) }}
        </div>
        <template v-else>
          <button
            type="button"
            class="group-head d-flex align-center w-100 px-1 py-1"
            :aria-expanded="isOpen(g.bucket)"
            :data-testid="`group-head-${g.bucket}`"
            @click="toggleGroup(g.bucket)"
          >
            <v-icon :icon="isOpen(g.bucket) ? 'mdi-chevron-down' : 'mdi-chevron-right'" size="small" class="mr-1" />
            <span class="text-subtitle-2" :class="{ 'text-warning': g.bucket === 'overdue' }">
              {{ t('rules.deadlines.groups.title', { bucket: t(`rules.deadlines.groups.${g.bucket}`), n: g.items.length }) }}
            </span>
          </button>
          <v-card v-if="isOpen(g.bucket)" variant="outlined" class="mt-1">
            <DeadlineRow v-for="row in g.items" :key="row.key" :row="row" @toggle="onToggle" />
          </v-card>
        </template>
      </section>
    </template>

    <v-snackbar v-model="snackOpen" :timeout="5000" data-testid="done-snackbar">
      {{ snackText }}
      <template #actions>
        <v-btn variant="text" data-testid="done-undo" @click="undo">{{ t('rules.deadlines.undo') }}</v-btn>
      </template>
    </v-snackbar>
  </div>
</template>

<style scoped>
.group-head {
  background: none;
  border: 0;
  cursor: pointer;
  color: inherit;
  text-align: left;
}
</style>
