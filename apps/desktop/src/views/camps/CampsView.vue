<script setup lang="ts">
/** /lager: Meine Lager (dates, review status, finding counts, next deadline, next step). */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import {
  approvedWithOpenMust,
  buildCampRows,
  campNext,
  campPhase,
  endedCount,
  filterCampRows,
  filterCampsByPhase,
  findingsText,
  formatIsoDate,
  sortCampRows,
  type CampRow,
} from '@/components/camps/campRows'
import { useCampList } from '@/composables/useCampList'
import { isLeaderRole } from '@/domain/selfCheck'
import { listCoachInputs } from '@/domain/campFacts/store'
import { daysBetween, deadlineStatus } from '@/domain/rules/lib/deadlines'
import { listCampSummaries } from '@/domain/rules/store'
import { reviewStatusColor } from '@/domain/rounds'
import { listAllRounds, listReviews } from '@/domain/rounds/store'
import type { CampRowSources } from '@/components/camps/campRows'

const { t } = useI18n()
const router = useRouter()
// Below lg the table is tight: «Weiter prüfen» becomes an icon button so no column is pushed off-screen.
const { lgAndUp } = useDisplay()
const { camps, loading, error, load } = useCampList()

const query = ref('')
const sources = ref<CampRowSources>({ summaries: [], reviews: [], rounds: [], inputs: [] })

async function loadSources(): Promise<void> {
  try {
    const [summaries, reviews, rounds, inputs] = await Promise.all([
      listCampSummaries(),
      listReviews(),
      listAllRounds(),
      listCoachInputs(),
    ])
    sources.value = { summaries, reviews, rounds, inputs }
  } catch {
    // Local data is optional for the list: columns fall back to «Noch nicht geprüft».
  }
}

async function refresh(force = false): Promise<void> {
  await Promise.all([load(force), loadSources()])
}
onMounted(() => void refresh())
watch(
  () => camps.value.length,
  () => void loadSources(),
)

const today = new Date().toISOString().slice(0, 10)
const rows = computed(() => sortCampRows(buildCampRows(camps.value, sources.value, today), today))

const PHASE_KEY = 'co-co.camps.phaseFilter'
function readShowEnded(): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem(PHASE_KEY) ?? 'null') as { showEnded?: unknown } | null
    return raw?.showEnded === true
  } catch {
    return false
  }
}
const showEnded = ref(readShowEnded())
watch(showEnded, () => {
  try {
    localStorage.setItem(PHASE_KEY, JSON.stringify({ showEnded: showEnded.value }))
  } catch {
    /* storage unavailable: the switch just is not remembered */
  }
})

// Search applies first; the phase filter then hides finished camps by default.
const searched = computed(() => filterCampRows(rows.value, query.value))
const visible = computed(() => filterCampsByPhase(searched.value, { showEnded: showEnded.value }, today))
const hiddenCount = computed(() => searched.value.length - visible.value.length)
const endedTotal = computed(() => endedCount(searched.value, today))
function phaseLabel(r: CampRow): string | null {
  const p = campPhase(r, today)
  return p === 'ended' || p === 'old' ? t('camps.campsView.phaseEnded') : null
}

function open(r: CampRow): void {
  void router.push(`/lager/${r.id}/uebersicht`)
}
function openSelfCheck(r: CampRow): void {
  void router.push(`/lager/${r.id}/selbstcheck`)
}
function dates(r: CampRow): string {
  // Non-breaking space before the dash: a narrow column breaks after «–», never between it and the start date.
  return r.start ? `${formatIsoDate(r.start)}\u00a0– ${formatIsoDate(r.end ?? r.start)}` : t('camps.campsView.noDates')
}
function roleColor(role: string | null): string {
  return role === 'manager' ? 'primary' : 'secondary'
}
/** Same colours as the status pill in the camp header; approved with an open Muss is a warning. */
function reviewColor(r: CampRow): string | undefined {
  if (approvedWithOpenMust(r) > 0) return 'warning'
  // «Neu» stays a plain chip (the shared 'grey' reads as disabled in a tonal chip).
  return r.review === 'neu' ? undefined : reviewStatusColor(r.review)
}
function reviewText(r: CampRow): string {
  const must = approvedWithOpenMust(r)
  return must > 0 ? t('camps.campsView.approvedMust', { n: must, status: t(`reviewStatus.${r.review}`) }) : t(`reviewStatus.${r.review}`)
}
/** One text per non-empty bucket; each renders as a no-wrap span so a line breaks only between buckets. */
function findingParts(c: { must: number; should: number; hint: number }): string[] {
  return [
    c.must > 0 ? t('camps.campsView.findings.text.must', { n: c.must }) : null,
    c.should > 0 ? t('camps.campsView.findings.text.should', { n: c.should }) : null,
    c.hint > 0 ? t('camps.campsView.findings.text.hint', { n: c.hint }, c.hint) : null,
  ].filter((x): x is string => x !== null)
}
function findingsClass(r: CampRow): string {
  const f = findingsText(r.counts)
  return f?.tone === 'error' ? 'text-error font-weight-medium' : f?.tone === 'warning' ? 'text-warning font-weight-medium' : ''
}
function nextText(r: CampRow): string {
  const n = campNext(r)
  return t(`camps.campsView.next.${n.key}`, n.params)
}
function deadlineText(r: CampRow): string {
  const d = r.nextDeadline
  if (!d) return t('camps.campsView.deadline.none')
  return `${t(`camps.campsView.deadline.kind.${d.kind}`)} ${formatIsoDate(d.due)}`
}
function deadlineColor(r: CampRow): string | undefined {
  const s = r.nextDeadline ? deadlineStatus(r.nextDeadline, today) : 'done'
  return s === 'overdue' ? 'error' : s === 'soon' ? 'warning' : undefined
}
function overdueDays(r: CampRow): number {
  return r.nextDeadline ? Math.max(0, daysBetween(r.nextDeadline.due, today)) : 0
}
</script>

<template>
  <div>
    <div class="d-flex align-center flex-wrap ga-3 mb-4">
      <h1 class="text-h5 flex-grow-1">{{ t('camps.campsView.title') }}</h1>
      <v-text-field
        v-model="query"
        :label="t('camps.campsView.search')"
        prepend-inner-icon="mdi-magnify"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        style="max-width: 320px"
        data-testid="camps-search"
      />
      <v-btn
        icon="mdi-refresh"
        variant="tonal"
        :loading="loading"
        :aria-label="t('camps.campsView.refresh')"
        data-testid="camps-refresh"
        @click="refresh(true)"
      >
        <v-icon icon="mdi-refresh" />
        <v-tooltip activator="parent" location="bottom">{{ t('camps.campsView.refresh') }}</v-tooltip>
      </v-btn>
    </div>

    <div v-if="endedTotal > 0 || showEnded" class="d-flex align-center flex-wrap ga-3 mb-2" data-testid="camps-phase-filter">
      <v-switch
        v-model="showEnded"
        :label="t('camps.campsView.showEnded', { n: endedTotal })"
        color="primary"
        density="compact"
        hide-details
        data-testid="camps-show-ended"
      />
      <span v-if="hiddenCount > 0" class="text-caption text-medium-emphasis" data-testid="camps-hidden-hint">
        {{ t('camps.campsView.hiddenHint', { n: hiddenCount }) }}
        <v-btn size="x-small" variant="text" data-testid="camps-show-hidden" @click="showEnded = true">{{ t('camps.campsView.showHidden') }}</v-btn>
      </span>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="camps-error">
      <div>{{ t('camps.failed') }}</div>
      <div class="text-caption">{{ error }}</div>
      <template #append>
        <v-btn variant="text" @click="refresh(true)">{{ t('common.retry') }}</v-btn>
      </template>
    </v-alert>

    <div v-if="loading && camps.length === 0" class="text-center pa-8" data-testid="camps-loading">
      <v-progress-circular indeterminate class="mb-2" />
      <div class="text-medium-emphasis">{{ t('camps.campsView.loading') }}</div>
    </div>

    <v-sheet v-else-if="!error && camps.length === 0" class="text-center pa-8" border rounded data-testid="camps-empty">
      <v-icon icon="mdi-tent" size="48" class="mb-2" />
      <div class="text-h6">{{ t('camps.campsView.emptyTitle') }}</div>
      <div class="text-medium-emphasis">{{ t('camps.campsView.emptyText') }}</div>
    </v-sheet>

    <div v-else-if="camps.length > 0 && visible.length === 0" class="text-medium-emphasis pa-4">
      {{ t('camps.campsView.noMatch') }}
    </div>

    <v-table v-else-if="visible.length > 0" hover data-testid="camps-table">
      <thead>
        <tr>
          <th>{{ t('camps.campsView.columns.camp') }}</th>
          <th>{{ t('camps.campsView.columns.dates') }}</th>
          <th>{{ t('camps.campsView.columns.review') }}</th>
          <th>{{ t('camps.campsView.columns.findings') }}</th>
          <th>{{ t('camps.campsView.columns.deadline') }}</th>
          <th>{{ t('camps.campsView.columns.next') }}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in visible"
          :key="r.iri"
          class="cursor-pointer"
          tabindex="0"
          :aria-label="`${t('camps.campsView.open')}: ${r.title}`"
          data-testid="camp-row"
          @click="open(r)"
          @keydown.enter="open(r)"
        >
          <td style="min-width: 12rem">
            <div class="font-weight-medium">
              {{ r.title }}
              <v-chip v-if="r.isPrototype" size="x-small" class="ml-1">{{ t('camps.campsView.prototype') }}</v-chip>
              <v-chip v-if="phaseLabel(r)" size="x-small" variant="tonal" class="ml-1">{{ phaseLabel(r) }}</v-chip>
              <v-chip
                v-if="r.role && isLeaderRole(r.role)"
                size="x-small"
                :color="roleColor(r.role)"
                variant="tonal"
                class="ml-1"
                data-testid="camp-role-chip"
              >
                {{ t(`camps.campsView.roleChip.${r.role}`) }}
              </v-chip>
              <v-btn
                v-if="isLeaderRole(r.role)"
                size="x-small"
                variant="text"
                class="ml-1"
                prepend-icon="mdi-clipboard-check-outline"
                data-testid="camp-selfcheck-link"
                @click.stop="openSelfCheck(r)"
                @keydown.enter.stop
              >
                {{ t('selfCheck.campsLink') }}
              </v-btn>
            </div>
            <div v-if="r.motto" class="text-caption text-medium-emphasis">{{ r.motto }}</div>
          </td>
          <td :class="{ 'text-no-wrap': lgAndUp }">{{ dates(r) }}</td>
          <td>
            <v-chip size="small" :color="reviewColor(r)" variant="tonal">{{ reviewText(r) }}</v-chip>
          </td>
          <td data-testid="camp-findings-text">
            <span v-if="r.counts && findingsText(r.counts)" :class="findingsClass(r)">
              <template v-if="r.counts.must + r.counts.should + r.counts.hint === 0">{{ t('camps.campsView.findings.text.none') }}</template>
              <template v-else>
                <template v-for="(part, i) in findingParts(r.counts)" :key="i">
                  <template v-if="i > 0">{{ ' · ' }}</template>
                  <span class="text-no-wrap">{{ part }}</span>
                </template>
              </template>
            </span>
            <span v-else class="text-medium-emphasis" :title="t('camps.campsView.findings.neverEvaluated')">
              {{ t('camps.campsView.findings.text.notChecked') }}
            </span>
          </td>
          <td>
            <v-chip v-if="r.nextDeadline" size="small" :color="deadlineColor(r)" variant="tonal">
              {{ deadlineText(r) }}
              <template v-if="overdueDays(r) > 0"> ({{ t('camps.campsView.deadline.overdue') }})</template>
            </v-chip>
            <span v-else class="text-medium-emphasis">{{ t('camps.campsView.deadline.none') }}</span>
          </td>
          <td data-testid="camp-next">{{ nextText(r) }}</td>
          <td class="text-no-wrap text-right">
            <v-btn
              v-if="lgAndUp"
              size="small"
              variant="text"
              append-icon="mdi-chevron-right"
              data-testid="camp-continue"
              @click.stop="open(r)"
              @keydown.enter.stop
            >
              {{ t('camps.campsView.continue') }}
            </v-btn>
            <v-btn
              v-else
              size="small"
              variant="text"
              icon="mdi-chevron-right"
              :aria-label="t('camps.campsView.continue')"
              :title="t('camps.campsView.continue')"
              data-testid="camp-continue"
              @click.stop="open(r)"
              @keydown.enter.stop
            />
          </td>
        </tr>
      </tbody>
    </v-table>
  </div>
</template>
