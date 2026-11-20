<script setup lang="ts">
/** /lager/:campId/uebersicht: verdict + next step, KPIs by state (findings, valid J+S days, changes since last round), J+S time per day. */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ModuleId } from '@/domain/types'
import type { JsDayReason } from '@/domain/rules/lib/jsDays'
import { useCampRuleConfig } from '@/composables/useCampRuleConfig'
import { useReviewProgress } from '@/composables/useReviewProgress'
import { useRounds } from '@/composables/useRounds'
import { campIdFromIri } from '@/domain/iri'
import {
  diffTotal,
  formatClock,
  formatDateShort,
  formatMinutes,
  jsDayBars,
  meterThresholdPercent,
  minutesOfDay,
  roundDeltaParams,
} from '@/domain/cockpit'
import DataSourcesCard from '@/components/cockpit/DataSourcesCard.vue'
import ReviewProgressCard from '@/components/cockpit/ReviewProgressCard.vue'
import KpiTile from '@/components/cockpit/KpiTile.vue'
import { useCockpit } from '@/components/cockpit/useCockpit'

const { t } = useI18n()
const { campIri, factsHandle, settings, findingsHandle } = useCockpit()
const { facts } = factsHandle
const { counts, jsDays, jsMinDays } = findingsHandle
const { diffSinceLastRound, rounds, load: loadRounds } = useRounds(campIri)
// useRounds keeps module-level caches that only fill on load(): load them for this camp.
onMounted(() => void loadRounds())
watch(campIri, () => void loadRounds())
const delta = computed(() => roundDeltaParams(rounds.value, diffSinceLastRound.value))

const { progress, verdict, suggestedModules, missingInputs, triageOpen } = useReviewProgress(campIri, {
  findings: findingsHandle,
  settings,
})
const rc = useCampRuleConfig(campIri)
const suggestedNames = computed(() =>
  suggestedModules.value.map((id) => rc.modules.value.find((m) => m.id === id)?.title ?? id),
)
/** «Alle übernehmen»: every suggested module becomes 'on' (explicit coach action; one write at a time). */
const accepting = ref(false)
async function acceptModules(): Promise<void> {
  if (accepting.value) return
  accepting.value = true
  try {
    for (const id of [...suggestedModules.value]) await rc.setModule(id as ModuleId, 'on')
  } finally {
    accepting.value = false
  }
}

const params = computed(() => ({ campId: campIdFromIri(campIri.value) }))
const confirmed = computed(() => settings.mappingConfirmed.value)
const bars = computed(() => jsDayBars(jsDays.value))
const threshold = computed(() => {
  const max = Math.max(360, ...bars.value.map((b) => b.minutes))
  return meterThresholdPercent(max)
})
const changes = computed(() => diffTotal(diffSinceLastRound.value))

// KPI colour = state (red: open Muss, orange: open Soll / below minimum, neutral at 0).
const mustColor = computed(() => (counts.value.must > 0 ? 'error' : undefined))
const shouldColor = computed(() => (counts.value.should > 0 ? 'warning' : undefined))
const provisional = computed(() => (confirmed.value ? undefined : t('cockpit.overview.kpi.provisional')))
const mustSubtitle = computed(() =>
  [counts.value.overridden ? t('cockpit.overview.kpi.overridden', { count: counts.value.overridden }) : null, provisional.value]
    .filter(Boolean)
    .join(' · ') || undefined,
)
const jsTile = computed(() => {
  if (!confirmed.value) return { value: '–', subtitle: t('cockpit.overview.kpi.validDaysPending'), color: undefined }
  const r = jsDays.value
  if (!r) return { value: '–', subtitle: t('cockpit.overview.kpi.validDaysMissing'), color: undefined }
  const ok = r.validDayCount >= jsMinDays.value
  return {
    value: t('cockpit.overview.kpi.validDaysOf', { valid: r.validDayCount, total: r.totalDayCount }),
    subtitle: t(ok ? 'cockpit.overview.kpi.validDaysOk' : 'cockpit.overview.kpi.validDaysNeeded', { min: jsMinDays.value }),
    color: ok ? 'success' : 'warning',
  }
})
const changesSubtitle = computed(() => {
  const d = delta.value
  if (!d) return undefined
  return changes.value === 0
    ? t('cockpit.overview.kpi.changesNoneSince', { n: d.n })
    : t('cockpit.overview.kpi.changesDetail', { added: d.added, changed: d.changed, removed: d.removed })
})

const clock = (iso: string) => formatClock(minutesOfDay(iso))
function whyText(r: JsDayReason): string {
  const k = 'cockpit.overview.jsTime.why.'
  switch (r.code) {
    case 'fewUnits':
      return t(`${k}fewUnits`, { units: r.units, required: r.required }, r.units)
    case 'tooShort':
      return t(`${k}tooShort`, { time: formatMinutes(r.minutes), required: formatMinutes(r.required) })
    case 'shortUnit':
      return t(`${k}shortUnit`, { start: clock(r.start), end: clock(r.end), minutes: r.minutes, required: r.required })
    case 'gap':
      return t(`${k}gap`, { start: clock(r.start), end: clock(r.end), minutes: r.minutes, required: r.required })
    case 'combinedOnly':
      return t(`${k}combinedOnly`)
    case 'bwz':
      return r.minutes > 0 ? t(`${k}bwz`, { bwz: r.minutes, required: r.required }) : t(`${k}bwzMissing`, { required: r.required })
  }
}
function barTitle(b: (typeof bars.value)[number]): string {
  const day = t('cockpit.overview.jsTime.day', { n: b.number })
  const time = formatMinutes(b.minutes)
  if (b.valid) return t('cockpit.overview.jsTime.tooltipValid', { day, time })
  const reasons = b.reasons.map(whyText).join('; ')
  return reasons ? t('cockpit.overview.jsTime.tooltip', { day, time, reasons }) : t('cockpit.overview.jsTime.tooltipInvalid', { day, time })
}
</script>

<template>
  <div>
    <v-alert v-if="!facts" type="info" variant="tonal" density="compact" :text="t('cockpit.overview.noFacts')" />

    <template v-else>
      <ReviewProgressCard
        v-if="progress"
        :progress="progress"
        :params="params"
        :verdict="verdict"
        :mapping-confirmed="confirmed"
        :missing-inputs="missingInputs"
        :triage-open="triageOpen"
        :suggested-names="suggestedNames"
        :accepting="accepting"
        @accept-modules="acceptModules"
      />

      <v-row dense class="mb-2">
        <v-col cols="6" md="3">
          <KpiTile
            :title="t('cockpit.overview.kpi.must')"
            :value="counts.must"
            :color="mustColor"
            icon="mdi-alert-octagon-outline"
            :subtitle="mustSubtitle"
            :to="{ name: 'camp-findings', params }"
          />
        </v-col>
        <v-col cols="6" md="3">
          <KpiTile
            :title="t('cockpit.overview.kpi.should')"
            :value="counts.should"
            :color="shouldColor"
            icon="mdi-alert-outline"
            :subtitle="provisional"
            :to="{ name: 'camp-findings', params }"
          />
        </v-col>
        <v-col cols="6" md="3">
          <KpiTile
            :title="t('cockpit.overview.kpi.hint')"
            :value="counts.hint"
            icon="mdi-information-outline"
            :to="{ name: 'camp-findings', params }"
          />
        </v-col>
        <v-col cols="6" md="3">
          <KpiTile
            :title="t('cockpit.overview.kpi.validDays')"
            :value="jsTile.value"
            :subtitle="jsTile.subtitle"
            :color="jsTile.color"
            icon="mdi-calendar-check-outline"
            :to="{ name: 'camp-grid', params }"
          />
        </v-col>
        <v-col v-if="rounds.length > 0" cols="12" md="6">
          <KpiTile
            :title="t('cockpit.overview.kpi.changes')"
            :value="changes ?? '–'"
            icon="mdi-history"
            :subtitle="changesSubtitle"
            :to="{ name: 'camp-rounds', params }"
          />
        </v-col>
      </v-row>

      <DataSourcesCard :camp-iri="campIri" :params="params" />

      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">{{ t('cockpit.overview.jsTime.title') }}</v-card-title>
        <v-card-text>
          <div v-if="!confirmed" class="text-body-2 text-medium-emphasis" data-testid="overview-jstime-pending">
            {{ t('cockpit.overview.jsTime.pending') }}
          </div>
          <div v-else-if="!bars.length" class="text-body-2 text-medium-emphasis">{{ t('cockpit.overview.jsTime.empty') }}</div>
          <div v-else class="js-bars" :style="{ '--thr': `${threshold}%` }">
            <div v-for="b in bars" :key="b.date" class="js-bar" :title="barTitle(b)">
              <div class="js-bar-track">
                <div class="js-bar-fill" :class="b.valid ? 'bg-success' : 'bg-warning'" :style="{ height: `${b.percent}%` }" />
                <div class="js-bar-line" :style="{ bottom: threshold + '%' }" />
              </div>
              <div class="text-caption">{{ formatDateShort(b.date) }}</div>
              <div class="text-caption text-medium-emphasis">{{ formatMinutes(b.minutes) }}</div>
            </div>
          </div>
          <div v-if="confirmed && bars.length" class="text-caption text-medium-emphasis mt-1">
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
