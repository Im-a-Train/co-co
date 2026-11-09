<script setup lang="ts">
/** /lager/:campId/uebersicht: KPIs (findings, valid J+S days, J+S time per day, changes since last round, mapping status). */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { progressOf, statusesOf } from '@/domain/triage'
import { isDocumentReviewed, reviewProgress } from '@/domain/cockpit/progress'
import { listDocuments } from '@/domain/documents/store'
import { splitHidden } from '@/domain/rules/lib/checklistSync'
import type { DocumentRecord } from '@/domain/types'
import { useCampRuleConfig } from '@/composables/useCampRuleConfig'
import { useFeedback } from '@/composables/useFeedback'
import { useManualFindings } from '@/composables/useManualFindings'
import { useRounds } from '@/composables/useRounds'
import { campIdFromIri } from '@/domain/iri'
import {
  diffTotal,
  formatDateShort,
  formatMinutes,
  jsDayBars,
  mappingStatus,
  roundDeltaParams,
  meterThresholdPercent,
} from '@/domain/cockpit'
import DataSourcesCard from '@/components/cockpit/DataSourcesCard.vue'
import ReviewProgressCard from '@/components/cockpit/ReviewProgressCard.vue'
import KpiTile from '@/components/cockpit/KpiTile.vue'
import { useCockpit } from '@/components/cockpit/useCockpit'

const { t } = useI18n()
const { campIri, factsHandle, settings, findingsHandle } = useCockpit()
const { facts } = factsHandle
const { counts, jsDays, findings } = findingsHandle
const { diffSinceLastRound, rounds, review, load: loadRounds } = useRounds(campIri)
// useRounds keeps module-level caches that only fill on load(): load them for this camp.
onMounted(() => void loadRounds())
watch(campIri, () => void loadRounds())
const delta = computed(() => roundDeltaParams(rounds.value, diffSinceLastRound.value))

const params = computed(() => ({ campId: campIdFromIri(campIri.value) }))
const bars = computed(() => jsDayBars(jsDays.value))
const threshold = computed(() => {
  const max = Math.max(360, ...bars.value.map((b) => b.minutes))
  return meterThresholdPercent(max)
})
const changes = computed(() => diffTotal(diffSinceLastRound.value))
const map = computed(() =>
  facts.value
    ? mappingStatus(facts.value, settings.mapping.value?.entries, settings.mappingConfirmed.value)
    : null,
)
const inputsMissing = computed(() => !settings.coachInputs.value)

// Review progress inputs
const feedback = useFeedback(campIri)
const manual = useManualFindings(campIri)
const rc = useCampRuleConfig(campIri)
const documents = ref<DocumentRecord[]>([])
async function loadDocuments() {
  try {
    documents.value = await listDocuments(campIri.value)
  } catch {
    documents.value = []
  }
}
onMounted(() => void loadDocuments())
watch(campIri, () => void loadDocuments())

const progress = computed(() => {
  const fb = feedback.items.value
  const tri = progressOf(statusesOf(findings.value, fb))
  // Same items as the Checkliste tab (M17): coach points only, minus hidden ones, plus the coach's own points.
  const hidden = rc.config.value.hiddenChecklist ?? []
  const checklistItems = splitHidden(
    rc.checklist.value.filter((i) => i.audience === 'coach'),
    (i) => i.id,
    hidden,
  ).shown
  const states = rc.config.value.checklist ?? {}
  const custom = (rc.config.value.customChecklist ?? []).filter((c) => !hidden.includes(c.id))
  const customDone = custom.filter((c) => states[c.id]?.done === true).length
  // Same done state as ChecklistView (checklistSync): a milestone-linked item is also done when its milestone is.
  const milestonesDone = settings.coachInputs.value?.milestonesDone ?? {}
  const itemDone = (i: { id: string; milestone?: string | null }) =>
    states[i.id]?.done === true || (!!i.milestone && Object.prototype.hasOwnProperty.call(milestonesDone, i.milestone))
  return reviewProgress({
    reviewStatus: review.value?.status ?? null,
    mappingConfirmed: settings.mappingConfirmed.value,
    coachInputsPresent: !!settings.coachInputs.value,
    triage: { done: tri.done, total: tri.total },
    manualFindingCount: manual.items.value.length,
    documents: {
      total: documents.value.length,
      reviewed: documents.value.filter((d) => isDocumentReviewed(d, manual.byDocument.value.get(d.id)?.length ?? 0)).length,
    },
    checklist: {
      done: checklistItems.filter(itemDone).length + customDone,
      total: checklistItems.length + custom.length,
    },
    feedback: {
      total: fb.length,
      draft: fb.filter((i) => i.status === 'draft').length,
      posted: fb.filter((i) => i.status === 'posted').length,
      sent: fb.filter((i) => i.status === 'sent').length,
    },
    rounds: rounds.value.length,
  })
})
</script>

<template>
  <div>
    <h1 class="text-h5 mb-4">{{ t('cockpit.overview.title') }}</h1>

    <v-alert v-if="!facts" type="info" variant="tonal" density="compact" :text="t('cockpit.overview.noFacts')" />

    <template v-else>
      <v-alert
        v-if="map && !map.confirmed"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-3"
        :text="t('cockpit.overview.mappingBanner')"
      >
        <template #append>
          <v-btn size="small" variant="text" :to="{ name: 'camp-mapping', params }" :text="t('cockpit.overview.kpi.mappingOpen')" />
        </template>
      </v-alert>
      <v-alert
        v-if="inputsMissing"
        type="info"
        variant="tonal"
        density="compact"
        class="mb-3"
        :text="t('cockpit.overview.inputsBanner')"
      >
        <template #append>
          <v-btn size="small" variant="text" :to="{ name: 'camp-inputs', params }" :text="t('campTabs.inputs')" />
        </template>
      </v-alert>

      <ReviewProgressCard :progress="progress" :params="params" />

      <v-row dense class="mb-2">
        <v-col cols="6" md="3">
          <KpiTile
            :title="t('cockpit.overview.kpi.must')"
            :value="counts.must"
            color="error"
            icon="mdi-alert-octagon-outline"
            :subtitle="counts.overridden ? t('cockpit.overview.kpi.overridden', { count: counts.overridden }) : undefined"
            :to="{ name: 'camp-findings', params }"
          />
        </v-col>
        <v-col cols="6" md="3">
          <KpiTile
            :title="t('cockpit.overview.kpi.should')"
            :value="counts.should"
            color="warning"
            icon="mdi-alert-outline"
            :to="{ name: 'camp-findings', params }"
          />
        </v-col>
        <v-col cols="6" md="3">
          <KpiTile
            :title="t('cockpit.overview.kpi.hint')"
            :value="counts.hint"
            color="info"
            icon="mdi-information-outline"
            :to="{ name: 'camp-findings', params }"
          />
        </v-col>
        <v-col cols="6" md="3">
          <KpiTile
            :title="t('cockpit.overview.kpi.validDays')"
            :value="jsDays ? t('cockpit.overview.kpi.validDaysOf', { valid: jsDays.validDayCount, total: jsDays.totalDayCount }) : '–'"
            :subtitle="jsDays ? undefined : t('cockpit.overview.kpi.validDaysMissing')"
            color="success"
            icon="mdi-calendar-check-outline"
            :to="{ name: 'camp-grid', params }"
          />
        </v-col>
        <v-col cols="12" md="6">
          <KpiTile
            :title="t('cockpit.overview.kpi.changes')"
            :value="changes ?? '–'"
            icon="mdi-history"
            :subtitle="
              delta
                ? t('cockpit.overview.kpi.changesSince', delta)
                : rounds.length
                  ? undefined
                  : t('cockpit.overview.kpi.changesNone')
            "
            :to="{ name: 'camp-rounds', params }"
          />
        </v-col>
        <v-col v-if="map" cols="12" md="6">
          <KpiTile
            :title="t('cockpit.overview.kpi.mapping')"
            :value="map.confirmed ? t('common.yes') : t('common.no')"
            :color="map.confirmed ? 'success' : 'warning'"
            icon="mdi-shape-outline"
            :subtitle="
              map.confirmed
                ? t('cockpit.overview.kpi.mappingConfirmed', { mapped: map.mapped, total: map.total })
                : t('cockpit.overview.kpi.mappingUnconfirmed', { mapped: map.mapped, total: map.total })
            "
            :to="{ name: 'camp-mapping', params }"
          />
        </v-col>
      </v-row>

      <DataSourcesCard :camp-iri="campIri" :params="params" />

      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">{{ t('cockpit.overview.jsTime.title') }}</v-card-title>
        <v-card-text>
          <div v-if="!bars.length" class="text-body-2 text-medium-emphasis">{{ t('cockpit.overview.jsTime.empty') }}</div>
          <div v-else class="js-bars" :style="{ '--thr': `${threshold}%` }">
            <div
              v-for="b in bars"
              :key="b.date"
              class="js-bar"
              :title="`${t('cockpit.overview.jsTime.day', { n: b.number })}: ${formatMinutes(b.minutes)} (${b.valid ? t('cockpit.overview.jsTime.valid') : t('cockpit.overview.jsTime.invalid')})`"
            >
              <div class="js-bar-track">
                <div class="js-bar-fill" :class="b.valid ? 'bg-success' : 'bg-warning'" :style="{ height: `${b.percent}%` }" />
                <div class="js-bar-line" :style="{ bottom: threshold + '%' }" />
              </div>
              <div class="text-caption">{{ formatDateShort(b.date) }}</div>
              <div class="text-caption text-medium-emphasis">{{ formatMinutes(b.minutes) }}</div>
            </div>
          </div>
          <div v-if="bars.length" class="text-caption text-medium-emphasis mt-1">
            {{ t('cockpit.overview.jsTime.threshold') }}
          </div>
        </v-card-text>
      </v-card>
    </template>
  </div>
</template>

<style scoped>
.js-bars {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  overflow-x: auto;
}
.js-bar {
  flex: 1 1 0;
  min-width: 44px;
  text-align: center;
}
.js-bar-track {
  position: relative;
  height: 120px;
  border-radius: 4px;
  background: rgba(var(--v-border-color), 0.15);
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}
.js-bar-fill {
  width: 100%;
}
.js-bar-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: rgb(var(--v-theme-on-surface));
}
</style>
