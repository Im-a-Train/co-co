<script setup lang="ts">
/** /lager/:campId/selbstcheck: leader self-check («Entwurfsrunde»), progress, report and history. */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import KpiTile from '@/components/cockpit/KpiTile.vue'
import SelfCheckHistory from '@/components/selfCheck/SelfCheckHistory.vue'
import SelfCheckProgressList from '@/components/selfCheck/SelfCheckProgressList.vue'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampRoute } from '@/composables/useCampRoute'
import { useFindings } from '@/composables/useFindings'
import { useSelfCheck } from '@/composables/useSelfCheck'
import { diffTotal } from '@/domain/cockpit'
import { copyText } from '@/lib/clipboard'

const { t } = useI18n()
const { campIri } = useCampRoute()
const { facts } = useCampFacts(campIri)
const { counts, jsDays } = useFindings(campIri)
const sc = useSelfCheck(campIri)

const dialog = ref(false)
const note = ref('')
const busy = ref(false)
const failed = ref(false)
const includeRed = ref(false)
const copied = ref<'ok' | 'fail' | null>(null)

onMounted(() => void sc.load())
watch(campIri, () => void sc.load())

const changed = computed(() => (sc.diffSinceLatest.value ? diffTotal(sc.diffSinceLatest.value) : null))
const reportText = computed(() => sc.report({ includeRedDerived: includeRed.value }))
const jsValue = computed(() =>
  jsDays.value
    ? t('selfCheck.kpi.jsDaysValue', { valid: jsDays.value.validDayCount, total: jsDays.value.totalDayCount })
    : '–',
)
const lastDate = computed(() =>
  sc.latest.value ? new Date(sc.latest.value.createdAt).toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' }) : '',
)

async function start() {
  busy.value = true
  failed.value = false
  try {
    await sc.startRun(note.value.trim())
    dialog.value = false
    note.value = ''
  } catch {
    failed.value = true
  } finally {
    busy.value = false
  }
}
async function copy() {
  copied.value = (await copyText(reportText.value)) ? 'ok' : 'fail'
}
</script>

<template>
  <div>
    <div class="d-flex align-center flex-wrap ga-3 mb-2">
      <h1 class="text-h5 flex-grow-1">{{ t('selfCheck.title') }}</h1>
      <v-btn
        color="primary"
        prepend-icon="mdi-clipboard-check-outline"
        :disabled="!facts"
        data-testid="selfcheck-start"
        @click="dialog = true"
      >
        {{ t('selfCheck.run.button') }}
      </v-btn>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-4" data-testid="selfcheck-intro">
      {{ sc.isLeader.value ? t('selfCheck.introLeader') : t('selfCheck.introCoach') }}
    </p>

    <v-alert v-if="failed || sc.error.value" type="error" variant="tonal" density="compact" class="mb-4">
      {{ t('selfCheck.run.failed') }}
    </v-alert>

    <v-row dense class="mb-4">
      <v-col cols="6" md="3"><KpiTile :title="t('selfCheck.kpi.must')" :value="counts.must" color="error" /></v-col>
      <v-col cols="6" md="3"><KpiTile :title="t('selfCheck.kpi.should')" :value="counts.should" color="warning" /></v-col>
      <v-col cols="6" md="3"><KpiTile :title="t('selfCheck.kpi.hint')" :value="counts.hint" color="info" /></v-col>
      <v-col cols="6" md="3"><KpiTile :title="t('selfCheck.kpi.jsDays')" :value="jsValue" /></v-col>
    </v-row>

    <h2 class="text-h6 mb-2">{{ t('selfCheck.progress.title') }}</h2>
    <div v-if="sc.progress.value" class="mb-6">
      <div class="text-caption text-medium-emphasis mb-2">
        {{ t('selfCheck.progress.since', { date: lastDate }) }} ·
        <span data-testid="selfcheck-changed">
          {{ t('selfCheck.kpi.changed') }}: {{ changed ?? '–' }}
        </span>
      </div>
      <SelfCheckProgressList :progress="sc.progress.value" :camp-iri="campIri" />
    </div>
    <div v-else class="text-medium-emphasis mb-6" data-testid="selfcheck-no-run">{{ t('selfCheck.progress.noRun') }}</div>

    <h2 class="text-h6 mb-2">{{ t('selfCheck.report.title') }}</h2>
    <v-sheet border rounded class="pa-4 mb-6">
      <div class="d-flex align-center flex-wrap ga-3 mb-2">
        <v-switch
          v-model="includeRed"
          :label="t('selfCheck.report.includeRed')"
          color="primary"
          density="compact"
          hide-details
          data-testid="selfcheck-include-red"
        />
        <v-spacer />
        <v-btn
          variant="tonal"
          prepend-icon="mdi-content-copy"
          :disabled="!reportText"
          data-testid="selfcheck-copy"
          @click="copy"
        >
          {{ t('selfCheck.report.copy') }}
        </v-btn>
      </div>
      <div class="text-caption text-medium-emphasis mb-2">{{ t('selfCheck.report.redHint') }}</div>
      <v-alert v-if="copied" :type="copied === 'ok' ? 'success' : 'error'" variant="tonal" density="compact" class="mb-2">
        {{ copied === 'ok' ? t('selfCheck.report.copied') : t('selfCheck.report.copyFailed') }}
      </v-alert>
      <pre class="selfcheck-report" data-testid="selfcheck-report">{{ reportText }}</pre>
    </v-sheet>

    <h2 class="text-h6 mb-2">{{ t('selfCheck.history.title') }}</h2>
    <SelfCheckHistory :runs="sc.runs.value" @delete="(id) => void sc.deleteRun(id)" />

    <v-dialog v-model="dialog" max-width="480">
      <v-card :title="t('selfCheck.run.dialogTitle')">
        <v-card-text>
          <v-textarea
            v-model="note"
            :label="t('selfCheck.run.note')"
            rows="2"
            auto-grow
            hide-details
            data-testid="selfcheck-note"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="busy" @click="dialog = false">{{ t('selfCheck.run.cancel') }}</v-btn>
          <v-btn color="primary" :loading="busy" data-testid="selfcheck-confirm" @click="start">{{ t('selfCheck.run.confirm') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.selfcheck-report {
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 0.875rem;
  max-height: 420px;
  overflow: auto;
}
</style>
