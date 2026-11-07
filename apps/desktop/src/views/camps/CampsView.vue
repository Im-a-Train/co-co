<script setup lang="ts">
/** /lager: Meine Lager (role, dates, review status, finding counts, next deadline). */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { buildCampRows, filterCampRows, formatIsoDate, sortCampRows, type CampRow } from '@/components/camps/campRows'
import { useCampList } from '@/composables/useCampList'
import { isLeaderRole } from '@/domain/selfCheck'
import { listCoachInputs } from '@/domain/campFacts/store'
import { daysBetween, deadlineStatus } from '@/domain/rules/deadlines'
import { listCampSummaries } from '@/domain/rules/store'
import { listAllRounds, listReviews } from '@/domain/rounds/store'
import type { CampRowSources } from '@/components/camps/campRows'

const { t } = useI18n()
const router = useRouter()
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
    // Local data is optional for the list: columns fall back to '–'.
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

const rows = computed(() => sortCampRows(buildCampRows(camps.value, sources.value)))
const visible = computed(() => filterCampRows(rows.value, query.value))
const today = new Date().toISOString().slice(0, 10)

function open(r: CampRow): void {
  void router.push(`/lager/${r.id}/uebersicht`)
}
function openSelfCheck(r: CampRow): void {
  void router.push(`/lager/${r.id}/selbstcheck`)
}
function dates(r: CampRow): string {
  return r.start ? `${formatIsoDate(r.start)} – ${formatIsoDate(r.end ?? r.start)}` : t('camps.campsView.noDates')
}
function roleColor(role: string | null): string {
  return role === 'manager' ? 'primary' : role === 'member' ? 'secondary' : 'default'
}
function reviewColor(s: string): string {
  return s === 'bewilligt' ? 'success' : s === 'neu' ? 'default' : 'warning'
}
function deadlineText(r: CampRow): string {
  const d = r.nextDeadline
  if (!d) return t('camps.campsView.deadline.none')
  return `${t(`camps.campsView.deadline.kind.${d.kind}`)} ${formatIsoDate(d.due)}`
}
function deadlineColor(r: CampRow): string {
  const s = r.nextDeadline ? deadlineStatus(r.nextDeadline, today) : 'done'
  return s === 'overdue' ? 'error' : s === 'soon' ? 'warning' : 'default'
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
        prepend-icon="mdi-refresh"
        variant="tonal"
        :loading="loading"
        data-testid="camps-refresh"
        @click="refresh(true)"
      >
        {{ t('camps.campsView.refresh') }}
      </v-btn>
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
          <th>{{ t('camps.campsView.columns.role') }}</th>
          <th>{{ t('camps.campsView.columns.review') }}</th>
          <th>{{ t('camps.campsView.columns.findings') }}</th>
          <th>{{ t('camps.campsView.columns.deadline') }}</th>
          <th>{{ t('camps.campsView.columns.changes') }}</th>
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
          <td>
            <div class="font-weight-medium">
              {{ r.title }}
              <v-chip v-if="r.isPrototype" size="x-small" class="ml-1">{{ t('camps.campsView.prototype') }}</v-chip>
            </div>
            <div v-if="r.motto" class="text-caption text-medium-emphasis">{{ r.motto }}</div>
          </td>
          <td class="text-no-wrap">{{ dates(r) }}</td>
          <td>
            <v-chip v-if="r.role" size="small" :color="roleColor(r.role)" variant="tonal">
              {{ t(`camps.campsView.role.${r.role}`) }}
            </v-chip>
            <span v-else>–</span>
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
          </td>
          <td>
            <v-chip size="small" :color="reviewColor(r.review)" variant="tonal">{{ t(`reviewStatus.${r.review}`) }}</v-chip>
          </td>
          <td class="text-no-wrap">
            <template v-if="r.counts">
              <v-chip size="small" color="error" variant="tonal" class="mr-1" :title="t('camps.campsView.findings.must', { n: r.counts.must })">{{ r.counts.must }}</v-chip>
              <v-chip size="small" color="warning" variant="tonal" class="mr-1" :title="t('camps.campsView.findings.should', { n: r.counts.should })">{{ r.counts.should }}</v-chip>
              <v-chip size="small" color="info" variant="tonal" :title="t('camps.campsView.findings.hint', { n: r.counts.hint })">{{ r.counts.hint }}</v-chip>
            </template>
            <span v-else :title="t('camps.campsView.findings.neverEvaluated')">–</span>
          </td>
          <td>
            <v-chip v-if="r.nextDeadline" size="small" :color="deadlineColor(r)" variant="tonal">
              {{ deadlineText(r) }}
              <template v-if="overdueDays(r) > 0"> ({{ t('camps.campsView.deadline.overdue') }})</template>
            </v-chip>
            <span v-else class="text-medium-emphasis">{{ t('camps.campsView.deadline.none') }}</span>
          </td>
          <td class="text-no-wrap">
            {{ r.lastRoundAt ? t('camps.campsView.round.since', { date: formatIsoDate(r.lastRoundAt) }) : t('camps.campsView.round.none') }}
          </td>
        </tr>
      </tbody>
    </v-table>
  </div>
</template>
