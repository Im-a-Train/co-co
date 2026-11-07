<script setup lang="ts">
/** /lager/:campId/befunde: findings grouped by severity, filters, overrides, Feedback erstellen. */
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import {
  DEFAULT_FINDING_FILTER,
  activityLabel,
  filterFindings,
  groupBySeverity,
  type FindingFilter,
} from '@/domain/cockpit'
import { campIdFromIri } from '@/domain/iri'
import type { ActivityFact, Finding, Iri, RuleGroup } from '@/domain/types'
import AiSafetyReviewButton from '@/components/ai/AiSafetyReviewButton.vue'
import { createFeedbackFromFinding } from '@/components/cockpit/feedbackAction'
import FindingCard from '@/components/cockpit/FindingCard.vue'
import OverrideDialog from '@/components/cockpit/OverrideDialog.vue'
import SeverityChip from '@/components/cockpit/SeverityChip.vue'
import { tryAction, useCockpit } from '@/components/cockpit/useCockpit'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const { campIri, factsHandle, findingsHandle } = useCockpit()
const { facts } = factsHandle
const { findings, evaluating } = findingsHandle

const filter = reactive<FindingFilter>({
  ...DEFAULT_FINDING_FILTER,
  severities: [...DEFAULT_FINDING_FILTER.severities],
  groups: [],
  activityIri: typeof route.query.activity === 'string' ? route.query.activity : null,
})
const groupOptions: RuleGroup[] = ['js', 'completeness', 'safety', 'best-practice']

const visible = computed(() => filterFindings(findings.value, filter))
const groups = computed(() => groupBySeverity(visible.value))
const activityTitle = computed(() => (facts.value && filter.activityIri ? activityLabel(facts.value, filter.activityIri) : ''))

const error = ref<string | null>(null)
const overrideTarget = ref<Finding | null>(null)
const overrideOpen = ref(false)

/** The AI safety review works on one activity: offered when the list is filtered to an activity. */
const aiActivityFact = computed<ActivityFact | null>(
  () => facts.value?.activities.find((a) => a.iri === filter.activityIri) ?? null,
)

function askOverride(f: Finding) {
  overrideTarget.value = f
  overrideOpen.value = true
}
async function doOverride(f: Finding, reason: string) {
  error.value = await tryAction(() => findingsHandle.override(f, reason))
}
async function undoOverride(f: Finding) {
  error.value = await tryAction(() => findingsHandle.removeOverride(f))
}
async function feedback(f: Finding) {
  error.value = await createFeedbackFromFinding(router, campIri.value, f)
}
function openActivity(iri: Iri) {
  void router.push({ name: 'camp-grid', params: { campId: campIdFromIri(campIri.value) }, query: { activity: iri } })
}
function addAi(list: Finding[]) {
  void tryAction(() => findingsHandle.addAiFindings(list))
}
</script>

<template>
  <div>
    <h1 class="text-h5 mb-3">{{ t('findings.title') }}</h1>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-3"
      closable
      :text="t('findings.actionFailed', { error })"
      @click:close="error = null"
    />

    <div class="d-flex flex-wrap align-center ga-3 mb-3">
      <v-text-field
        v-model="filter.search"
        :label="t('findings.filters.search')"
        prepend-inner-icon="mdi-magnify"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        style="max-width: 260px"
      />
      <v-chip-group v-model="filter.severities" multiple selected-class="text-primary">
        <v-chip v-for="s in ['must', 'should', 'hint'] as const" :key="s" :value="s" filter variant="outlined" size="small">
          {{ t(`severity.${s}`) }}
        </v-chip>
      </v-chip-group>
      <v-chip-group v-model="filter.groups" multiple selected-class="text-primary">
        <v-chip v-for="g in groupOptions" :key="g" :value="g" filter variant="outlined" size="small">
          {{ t(`findings.group.${g}`) }}
        </v-chip>
      </v-chip-group>
      <v-switch v-model="filter.showOverridden" :label="t('findings.filters.showOverridden')" density="compact" hide-details color="primary" />
    </div>

    <v-chip
      v-if="filter.activityIri"
      closable
      class="mb-3"
      prepend-icon="mdi-filter-outline"
      :text="t('findings.filters.activity', { title: activityTitle })"
      @click:close="filter.activityIri = null"
    />

    <v-progress-linear v-if="evaluating" indeterminate class="mb-2" />

    <div v-if="aiActivityFact" class="mb-3 d-flex align-center ga-2">
      <span class="text-caption text-medium-emphasis">{{ t('findings.ai.title') }}</span>
      <AiSafetyReviewButton :activity="aiActivityFact" :facts="facts" @findings="addAi" />
    </div>

    <v-alert v-if="!groups.length && !evaluating" type="info" variant="tonal" density="compact">
      {{ findings.length ? t('findings.empty') : t('findings.emptyAll') }}
    </v-alert>

    <section v-for="g in groups" :key="g.severity" class="mb-5">
      <h2 class="text-h6 d-flex align-center ga-2 mb-2">
        <SeverityChip :severity="g.severity" :count="g.findings.length" />
      </h2>
      <div class="d-flex flex-column ga-2">
        <FindingCard
          v-for="f in g.findings"
          :key="f.id"
          :finding="f"
          @feedback="feedback"
          @override="askOverride"
          @remove-override="undoOverride"
          @open-activity="openActivity"
        />
      </div>
    </section>

    <OverrideDialog v-model="overrideOpen" :finding="overrideTarget" @confirm="doOverride" />
  </div>
</template>
