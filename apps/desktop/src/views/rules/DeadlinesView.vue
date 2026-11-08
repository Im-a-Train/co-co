<script setup lang="ts">
/**
 * /fristen: deadlines across camps (NDS, Leihmaterial, Landeskarten, Lagerbewilligung) plus the PBS
 * milestones from the bundled Hering list, with a radar (overdue / this week / next 4 weeks / later).
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import DeadlineStatusChip from '@/components/rules/DeadlineStatusChip.vue'
import { emptyCoachInputs, listCoachInputs, saveCoachInputs } from '@/domain/campFacts/store'
import { listCampSummaries } from '@/domain/rules/store'
import { computeAllDeadlines, daysBetween, deadlineStatus } from '@/domain/rules/lib/deadlines'
import { toIcs } from '@/domain/rules/ics'
import { computeMilestoneDeadlines, loadBundledMilestones, milestoneContextFromConfig, radarBucket, type RadarBucket } from '@/domain/rules/milestones'
import { listCampRuleConfigs } from '@/domain/rules/campRuleConfigStore'
import type { CampRuleConfig, CoachInputs, Deadline, Iri } from '@/domain/types'
import { useCampList } from '@/composables/useCampList'
import { commands } from '@/lib/tauri'

const { t } = useI18n()
const { camps, loading, error, load } = useCampList()

const inputsByCamp = ref<Record<Iri, CoachInputs>>({})
const inputsError = ref<string | null>(null)
const showDone = ref(false)
const lastJsByCamp = ref<Record<Iri, string | null>>({})
const ruleConfigByCamp = ref<Record<Iri, CampRuleConfig>>({})

const MILESTONES_KEY = 'co-co.deadlines.showMilestones'
function readShowMilestones(): boolean {
  try {
    return localStorage.getItem(MILESTONES_KEY) !== '0'
  } catch {
    return true
  }
}
const showMilestones = ref(readShowMilestones())
watch(showMilestones, (v) => {
  try {
    localStorage.setItem(MILESTONES_KEY, v ? '1' : '0')
  } catch {
    /* storage unavailable: the switch just is not remembered */
  }
})

const milestoneList = loadBundledMilestones()

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

onMounted(() => {
  void load()
  void loadInputs()
})
watch(camps, () => void loadInputs())

const today = computed(() => new Date().toISOString().slice(0, 10))

const campById = computed(() => new Map(camps.value.map((c) => [c.iri, c])))

const deadlineCamps = computed(() =>
  camps.value
    .filter((c) => !c.isPrototype)
    .map((c) => ({ iri: c.iri, title: c.title, start: c.start, end: c.end, lastJsDate: lastJsByCamp.value[c.iri] ?? null })),
)

const deadlines = computed<Deadline[]>(() => {
  const all = computeAllDeadlines(deadlineCamps.value, inputsByCamp.value)
  if (!showMilestones.value) return all
  const ms = deadlineCamps.value.flatMap((c) =>
    computeMilestoneDeadlines(c, inputsByCamp.value[c.iri] ?? null, milestoneList, milestoneContextFromConfig(ruleConfigByCamp.value[c.iri])),
  )
  return [...all, ...ms].sort((a, b) =>
    a.due < b.due ? -1 : a.due > b.due ? 1 : a.campTitle.localeCompare(b.campTitle) || a.kind.localeCompare(b.kind) || (a.milestoneId ?? '').localeCompare(b.milestoneId ?? ''),
  )
})

function titleOf(d: Deadline): string {
  return d.kind === 'pbs-milestone' ? (d.title ?? d.milestoneId ?? '') : t(`rules.deadlines.kind.${d.kind}`)
}

function rowKey(d: Deadline): string {
  return `${d.campIri}:${d.kind}${d.milestoneId ? `:${d.milestoneId}` : ''}`
}

const bucketFilter = ref<RadarBucket | null>(null)

const allRows = computed(() =>
  deadlines.value.map((d) => ({
    ...d,
    key: rowKey(d),
    campId: campById.value.get(d.campIri)?.id ?? d.campIri.split('/').pop() ?? '',
    status: deadlineStatus(d, today.value),
    left: daysBetween(today.value, d.due),
    bucket: radarBucket(d, today.value),
  })),
)

const rows = computed(() =>
  allRows.value.filter((r) => (showDone.value || !r.done) && (bucketFilter.value === null || r.bucket === bucketFilter.value)),
)

const BUCKETS: Exclude<RadarBucket, 'done'>[] = ['overdue', 'week', 'month', 'later']
const MAX_PER_LANE = 6
const lanes = computed(() =>
  BUCKETS.map((b) => {
    const items = allRows.value.filter((r) => r.bucket === b)
    return { bucket: b, count: items.length, items: items.slice(0, MAX_PER_LANE), more: Math.max(0, items.length - MAX_PER_LANE) }
  }),
)

function toggleBucket(b: RadarBucket) {
  bucketFilter.value = bucketFilter.value === b ? null : b
}

const highlighted = ref<string | null>(null)
async function jumpTo(key: string, bucket: RadarBucket) {
  bucketFilter.value = bucket
  highlighted.value = key
  await nextTick()
  document.getElementById(`deadline-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const saveError = ref<string | null>(null)
async function toggleMilestone(row: { campIri: Iri; milestoneId?: string; done: boolean }) {
  if (!row.milestoneId) return
  try {
    // Plain copy: IndexedDB cannot clone Vue reactive proxies.
    const stored = inputsByCamp.value[row.campIri]
    const current: CoachInputs = stored ? JSON.parse(JSON.stringify(stored)) : emptyCoachInputs(row.campIri)
    const done = { ...(current.milestonesDone ?? {}) }
    if (row.done) delete done[row.milestoneId]
    else done[row.milestoneId] = today.value
    const next: CoachInputs = { ...current, milestonesDone: done }
    await saveCoachInputs(next)
    inputsByCamp.value = { ...inputsByCamp.value, [row.campIri]: next }
    saveError.value = null
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  }
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

function relative(left: number): string {
  if (left === 0) return t('rules.deadlines.relative.today')
  if (left === 1) return t('rules.deadlines.relative.inOne')
  if (left === -1) return t('rules.deadlines.relative.agoOne')
  return left > 0 ? t('rules.deadlines.relative.in', { n: left }) : t('rules.deadlines.relative.ago', { n: -left })
}
</script>

<template>
  <div>
    <h1 class="text-h5 mb-1">{{ t('rules.deadlines.title') }}</h1>
    <p class="text-body-2 text-medium-emphasis mb-4">{{ t('rules.deadlines.intro') }}</p>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">
      {{ t('rules.deadlines.loadFailed') }}: {{ error }}
    </v-alert>
    <v-alert v-if="saveError" type="error" variant="tonal" density="compact" class="mb-4">
      {{ t('rules.deadlines.saveFailed') }}: {{ saveError }}
    </v-alert>

    <section v-if="allRows.length" class="mb-4" data-testid="radar">
      <div class="d-flex align-center mb-1">
        <h2 class="text-subtitle-1">{{ t('rules.deadlines.radar.title') }}</h2>
        <v-btn v-if="bucketFilter" size="x-small" variant="text" class="ml-2" data-testid="radar-clear" @click="bucketFilter = null">
          {{ t('rules.deadlines.radar.clearFilter') }}
        </v-btn>
      </div>
      <p class="text-caption text-medium-emphasis mb-2">{{ t('rules.deadlines.radar.filterHint') }}</p>
      <v-row dense>
        <v-col v-for="lane in lanes" :key="lane.bucket" cols="12" sm="6" md="3">
          <v-card
            variant="outlined"
            :color="bucketFilter === lane.bucket ? 'primary' : undefined"
            class="h-100"
            :data-testid="`radar-${lane.bucket}`"
          >
            <button type="button" class="radar-head d-flex align-center pa-2 w-100" :data-testid="`radar-head-${lane.bucket}`" @click="toggleBucket(lane.bucket)">
              <span class="text-body-2 font-weight-medium">{{ t(`rules.deadlines.radar.bucket.${lane.bucket}`) }}</span>
              <v-spacer />
              <v-chip size="x-small" label :color="lane.bucket === 'overdue' && lane.count ? 'error' : undefined" :data-testid="`radar-count-${lane.bucket}`">{{ lane.count }}</v-chip>
            </button>
            <v-divider />
            <div class="pa-2">
              <div v-if="!lane.count" class="text-caption text-medium-emphasis">{{ t('rules.deadlines.radar.empty') }}</div>
              <button
                v-for="item in lane.items"
                :key="item.key"
                type="button"
                class="radar-item text-left w-100 mb-1"
                data-testid="radar-item"
                @click="jumpTo(item.key, lane.bucket)"
              >
                <div class="text-caption text-truncate">{{ item.campTitle }}</div>
                <div class="text-body-2 text-truncate">{{ titleOf(item) }}</div>
                <div class="text-caption text-medium-emphasis">{{ fmt(item.due) }} · {{ relative(item.left) }}</div>
              </button>
              <div v-if="lane.more" class="text-caption text-medium-emphasis">+ {{ lane.more }}</div>
            </div>
          </v-card>
        </v-col>
      </v-row>
    </section>

    <div class="d-flex align-center flex-wrap ga-4 mb-2">
      <v-switch v-model="showDone" :label="t('rules.deadlines.showDone')" density="compact" hide-details color="primary" />
      <v-switch
        v-model="showMilestones"
        :label="t('rules.deadlines.showMilestones')"
        density="compact"
        hide-details
        color="primary"
        data-testid="milestones-switch"
      />
      <v-spacer />
      <v-progress-circular v-if="loading" indeterminate size="20" width="2" />
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
    </div>
    <v-alert v-if="exportMessage" type="success" variant="tonal" density="compact" class="mb-2" data-testid="export-message">{{ exportMessage }}</v-alert>
    <v-alert v-if="exportError" type="error" variant="tonal" density="compact" class="mb-2" data-testid="export-error">
      {{ t('rules.deadlines.exportFailed') }}: {{ exportError }}
    </v-alert>

    <v-alert
      v-if="!loading && !error && allRows.length === 0"
      type="info"
      variant="tonal"
      density="compact"
      :text="t('rules.deadlines.empty')"
    />

    <v-card v-else-if="rows.length" variant="outlined">
      <v-table density="compact">
        <thead>
          <tr>
            <th>{{ t('rules.deadlines.columns.due') }}</th>
            <th>{{ t('rules.deadlines.columns.camp') }}</th>
            <th>{{ t('rules.deadlines.columns.kind') }}</th>
            <th>{{ t('rules.deadlines.columns.status') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :id="`deadline-${row.key}`"
            :key="row.key"
            :class="{ 'deadline-highlight': highlighted === row.key }"
            :data-testid="row.kind === 'pbs-milestone' ? 'milestone-row' : 'deadline-row'"
          >
            <td class="text-no-wrap">
              {{ fmt(row.due) }}
              <div class="text-caption text-medium-emphasis">{{ relative(row.left) }}</div>
            </td>
            <td>
              <RouterLink :to="`/lager/${row.campId}/angaben`" :title="t('rules.deadlines.openCamp')">{{ row.campTitle }}</RouterLink>
            </td>
            <td>
              {{ titleOf(row) }}
              <v-chip
                v-if="row.kind === 'pbs-milestone' && row.confidence === 'unverified'"
                size="x-small"
                label
                color="warning"
                variant="tonal"
                class="ml-1"
                :title="t('rules.deadlines.unconfirmedHint')"
                data-testid="unverified-badge"
              >
                {{ t('rules.deadlines.unconfirmed') }}
              </v-chip>
              <div v-if="row.ruleId" class="text-caption text-medium-emphasis">
                {{ t('rules.deadlines.rule', { id: row.ruleId }) }}
              </div>
              <div v-if="row.kind === 'pbs-milestone' && row.source" class="text-caption">
                <a :href="row.source.url" target="_blank" rel="noopener noreferrer">{{ t('rules.deadlines.sourceLink', { title: row.source.title }) }}</a>
              </div>
            </td>
            <td class="text-no-wrap">
              <DeadlineStatusChip :status="row.status" />
              <v-btn
                v-if="row.kind === 'pbs-milestone'"
                size="x-small"
                variant="text"
                class="ml-1"
                data-testid="milestone-toggle"
                @click="toggleMilestone(row)"
              >
                {{ row.done ? t('rules.deadlines.markUndone') : t('rules.deadlines.markDone') }}
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </div>
</template>

<style scoped>
.radar-head,
.radar-item {
  background: none;
  border: 0;
  cursor: pointer;
  color: inherit;
}
.radar-item {
  border-radius: 4px;
  padding: 2px 4px;
}
.radar-item:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.deadline-highlight {
  background: rgba(var(--v-theme-primary), 0.12);
}
</style>
