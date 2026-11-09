<script setup lang="ts">
/** /lager/:campId/befunde: triage ("Befunde durchgehen") or the grouped list with filters, ignore and Feedback erstellen. */
import { computed, nextTick, reactive, ref, watch } from 'vue'
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
import { activityIriOfFinding, gridLocationFromFinding, recallPosition, rememberPosition, statusesOf } from '@/domain/triage'
import { useFeedback } from '@/composables/useFeedback'
import type { ActivityFact, Finding, Iri, RuleGroup } from '@/domain/types'
import { loadBundledPacks, modulesOf } from '@/domain/rules/packs'
import { loadEffectivePacks } from '@/domain/rules/editsStore'
import { useRuleEdits } from '@/composables/useRuleEdits'
import AiCampReviewButton from '@/components/ai/AiCampReviewButton.vue'
import AiSafetyReviewButton from '@/components/ai/AiSafetyReviewButton.vue'
import { createFeedbackFromFinding } from '@/components/cockpit/feedbackAction'
import FindingCard from '@/components/cockpit/FindingCard.vue'
import FindingTriage, { type FeedbackDraft } from '@/components/cockpit/FindingTriage.vue'
import CategoryExclusionDialog from '@/components/cockpit/CategoryExclusionDialog.vue'
import OverrideDialog from '@/components/cockpit/OverrideDialog.vue'
import RuleEditDialog from '@/components/rules/RuleEditDialog.vue'
import SeverityChip from '@/components/cockpit/SeverityChip.vue'
import { tryAction, useCockpit } from '@/components/cockpit/useCockpit'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const { campIri, factsHandle, settings, findingsHandle } = useCockpit()
const { facts } = factsHandle
const { findings, evaluating, disabledRules, disablePrompt } = findingsHandle
const { excludedCount, categoryExclusions } = findingsHandle
const classOf = settings.classOf
const feedbackHandle = useFeedback(campIri)

const filter = reactive<FindingFilter>({
  ...DEFAULT_FINDING_FILTER,
  severities: [...DEFAULT_FINDING_FILTER.severities],
  groups: [],
  activityIri: typeof route.query.activity === 'string' ? route.query.activity : null,
})
/** Module filter options: the modules of the loaded rule packs (catalog v2). */
const groupOptions: RuleGroup[] = (() => {
  try {
    return modulesOf(loadBundledPacks()).map((m) => m.id)
  } catch {
    return []
  }
})()

const visible = computed(() => filterFindings(findings.value, filter))
const groups = computed(() => groupBySeverity(visible.value))
const activityTitle = computed(() => (facts.value && filter.activityIri ? activityLabel(facts.value, filter.activityIri) : ''))

const error = ref<string | null>(null)
const overrideTarget = ref<Finding | null>(null)
const overrideOpen = ref(false)
const disabledDialog = ref(false)
const exclusionDialog = ref(false)
const notice = ref<string | null>(null)
const ruleEdits = useRuleEdits()
const editRuleId = ref<string | null>(null)
const editRuleOpen = ref(false)
function editRule(f: Finding) {
  editRuleId.value = f.ruleId
  editRuleOpen.value = true
}
const allRules = computed(() => {
  void ruleEdits.version.value
  return loadEffectivePacks()
    .flatMap((p) => p.rules)
    .map((r) => ({ id: r.meta.id, title: r.meta.title }))
})
/** Category IRI of the activity a rule finding is about (null for camp/day findings). */
function categoryIriOf(f: Finding): Iri | null {
  const actIri = activityIriOfFinding(f, facts.value)
  return facts.value?.activities.find((a) => a.iri === actIri)?.categoryIri ?? null
}
const canExclude = (f: Finding) => f.origin === 'rule' && !!categoryIriOf(f)
async function excludeForRule(f: Finding) {
  const cat = categoryIriOf(f)
  if (!cat) return
  const c = facts.value?.categories.find((x) => x.iri === cat)
  error.value = await tryAction(() => findingsHandle.excludeCategory(cat, f.ruleId))
  if (!error.value) notice.value = t('findings.categoryExclusion.forRuleDone', { category: c ? `${c.short} ${c.name}`.trim() : cat, ruleId: f.ruleId })
}

// ---- triage / list mode ----------------------------------------------------------------------------
const hasActivityFilter = typeof route.query.activity === 'string'
const explicitMode = ref<'triage' | 'list' | null>(
  route.query.ansicht === 'liste' ? 'list' : typeof route.query.befund === 'string' ? 'triage' : null,
)
const statuses = computed(() => statusesOf(findings.value, feedbackHandle.items.value))
const hasOpen = computed(() => statuses.value.includes('open'))
/** Natural default: triage while there is something to do (decided once, so it does not flip when the last one is done). */
const autoMode = ref<'triage' | 'list' | null>(null)
watch(
  findings,
  (list) => {
    if (autoMode.value || !list.length) return
    autoMode.value = hasOpen.value && !hasActivityFilter ? 'triage' : 'list'
  },
  { immediate: true },
)
const mode = computed<'triage' | 'list'>(() => explicitMode.value ?? autoMode.value ?? 'list')
function setMode(m: 'triage' | 'list') {
  explicitMode.value = m
}

const requestedKey = ref<string | null>(typeof route.query.befund === 'string' ? route.query.befund : null)
const focusEditorKey = route.query.editor === '1' && typeof route.query.befund === 'string' ? route.query.befund : null

const triageFindings = computed(() => {
  const iri = filter.activityIri
  if (!iri) return findings.value
  return findings.value.filter((f) => f.targets.includes(iri) || activityIriOfFinding(f, facts.value) === iri)
})
const triageKey = computed<string | null>({
  get() {
    const list = triageFindings.value
    const k = requestedKey.value ?? recallPosition(campIri.value)
    if (k && list.some((f) => f.id === k)) return k
    const firstOpen = list.findIndex((f) => statusesOf([f], feedbackHandle.items.value)[0] === 'open')
    return list[firstOpen >= 0 ? firstOpen : 0]?.id ?? null
  },
  set(v) {
    requestedKey.value = v
  },
})
watch(triageKey, (k) => {
  if (!k) return
  rememberPosition(campIri.value, k)
  if (mode.value === 'triage' && route.query.befund !== k) {
    void router.replace({ query: { ...route.query, befund: k, editor: undefined } })
  }
})
watch(
  () => route.query.befund,
  (k) => {
    if (typeof k === 'string' && k !== requestedKey.value) requestedKey.value = k
  },
)

async function triageSave(f: Finding, draft: FeedbackDraft) {
  const activityIri = draft.scope === 'activity' ? (activityIriOfFinding(f, facts.value) ?? undefined) : undefined
  error.value = await tryAction(() =>
    feedbackHandle.add({
      scope: activityIri ? 'activity' : 'camp',
      kind: draft.kind,
      text: draft.text.trim(),
      activityIri,
      ruleId: f.ruleId,
      findingId: f.id,
    }),
  )
}
function openFeedbackItem(id: string) {
  void router.push({ name: 'camp-feedback', params: { campId: campIdFromIri(campIri.value) }, query: { item: id } })
}

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
/** Jump to the grid; the origin is carried along so the grid can offer «Zurück zum Befund». */
function openActivity(iri: Iri, findingId?: string) {
  const id = findingId ?? triageKey.value
  if (id) rememberPosition(campIri.value, id)
  if (!id) {
    void router.push({ name: 'camp-grid', params: { campId: campIdFromIri(campIri.value) }, query: { activity: iri } })
    return
  }
  void router.push(
    gridLocationFromFinding(campIri.value, id, iri, { list: mode.value === 'list', filterActivity: filter.activityIri }),
  )
}

/** Coming back in list mode: scroll to and focus the finding's card. */
const listTarget = typeof route.query.befund === 'string' && route.query.ansicht === 'liste' ? route.query.befund : null
watch(
  [mode, groups],
  async () => {
    if (!listTarget || mode.value !== 'list') return
    await nextTick()
    const el = document.querySelector<HTMLElement>(`[data-finding-id="${CSS.escape(listTarget)}"]`)
    if (!el || el.dataset.scrolled) return
    el.dataset.scrolled = '1'
    el.scrollIntoView?.({ block: 'center' })
    el.focus({ preventScroll: true })
  },
  { immediate: true, flush: 'post' },
)
function addAi(list: Finding[]) {
  void tryAction(() => findingsHandle.addAiFindings(list))
}
</script>

<template>
  <div>
    <div class="d-flex align-center flex-wrap ga-3 mb-3">
      <h1 class="text-h5">{{ t('findings.title') }}</h1>
      <v-btn-toggle
        :model-value="mode"
        mandatory
        density="compact"
        variant="outlined"
        divided
        color="primary"
        @update:model-value="setMode"
      >
        <v-btn value="triage" prepend-icon="mdi-format-list-checks" :text="t('findings.mode.triage')" data-testid="mode-triage" />
        <v-btn value="list" prepend-icon="mdi-view-list-outline" :text="t('findings.mode.list')" data-testid="mode-list" />
      </v-btn-toggle>
      <v-spacer />
      <AiCampReviewButton :facts="facts" :findings="findings" @findings="addAi" />
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-filter-remove-outline"
        :text="t('findings.categoryExclusion.button')"
        data-testid="category-exclusion-open"
        @click="exclusionDialog = true"
      />
      <v-chip
        v-if="disabledRules.length"
        size="small"
        variant="tonal"
        prepend-icon="mdi-cancel"
        data-testid="disabled-note"
        @click="disabledDialog = true"
      >
        {{ t('findings.disabledNote', { count: disabledRules.length }, disabledRules.length) }}
        · {{ t('findings.disabledManage') }}
      </v-chip>
    </div>

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

    <v-alert
      v-if="excludedCount > 0"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-3"
      data-testid="exclusion-info"
    >
      {{ t('findings.categoryExclusion.info', { count: excludedCount }, excludedCount) }}
      <template #append>
        <v-btn size="small" variant="text" :text="t('findings.categoryExclusion.manage')" data-testid="exclusion-manage" @click="exclusionDialog = true" />
      </template>
    </v-alert>

    <v-alert v-if="disablePrompt" type="warning" variant="tonal" density="compact" class="mb-3" data-testid="disable-prompt">
      {{ t('findings.disablePrompt.text', { title: disablePrompt.title, count: disablePrompt.count }) }}
      <template #append>
        <div class="d-flex flex-wrap ga-1">
          <v-btn size="small" variant="tonal" :text="t('findings.disablePrompt.camp')" data-testid="disable-camp" @click="findingsHandle.answerDisablePrompt('camp')" />
          <v-btn size="small" variant="tonal" :text="t('findings.disablePrompt.all')" data-testid="disable-all" @click="findingsHandle.answerDisablePrompt('all')" />
          <v-btn size="small" variant="text" :text="t('findings.disablePrompt.no')" data-testid="disable-no" @click="findingsHandle.answerDisablePrompt('no')" />
        </div>
      </template>
    </v-alert>

    <v-progress-linear v-if="evaluating" indeterminate class="mb-2" />

    <FindingTriage
      v-if="mode === 'triage'"
      v-model:current-key="triageKey"
      :findings="triageFindings"
      :camp-iri="campIri"
      :facts="facts"
      :feedback-items="feedbackHandle.items.value"
      :class-of="classOf"
      :focus-editor="triageKey === focusEditorKey"
      @save-feedback="triageSave"
      @ignore="doOverride"
      @unignore="undoOverride"
      @open-activity="(iri: string) => openActivity(iri)"
      @open-feedback="openFeedbackItem"
      @exclude-category="excludeForRule"
    />

    <template v-else>
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
            {{ t(`rules.catalog.module.${g}`) }}
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
            :data-finding-id="f.id"
            tabindex="-1"
            class="finding-card"
            @feedback="feedback"
            @override="askOverride"
            :can-exclude-category="canExclude(f)"
            @exclude-category="excludeForRule"
            @edit-rule="editRule"
            @remove-override="undoOverride"
            @open-activity="(iri: string) => openActivity(iri, f.id)"
          />
        </div>
      </section>
    </template>

    <RuleEditDialog v-if="editRuleId" v-model="editRuleOpen" :rule-id="editRuleId" />

    <CategoryExclusionDialog
      v-model="exclusionDialog"
      :categories="facts?.categories ?? []"
      :exclusions="categoryExclusions"
      :rules="allRules"
      @exclude="(cat: string, ruleId: string | null) => findingsHandle.excludeCategory(cat, ruleId)"
      @include="(cat: string, ruleId: string | null) => findingsHandle.includeCategory(cat, ruleId)"
    />
    <v-snackbar :model-value="!!notice" timeout="4000" @update:model-value="notice = null">{{ notice }}</v-snackbar>

    <OverrideDialog v-model="overrideOpen" :finding="overrideTarget" @confirm="doOverride" />

    <v-dialog v-model="disabledDialog" max-width="520">
      <v-card :title="t('findings.disabledDialog.title')">
        <v-list>
          <v-list-item
            v-for="r in disabledRules"
            :key="r.ruleId"
            :title="r.title"
            :subtitle="`${r.ruleId} · ${r.global ? t('findings.disabledDialog.scopeAll') : t('findings.disabledDialog.scopeCamp')}`"
          >
            <template #append>
              <v-btn size="small" variant="tonal" :text="t('findings.disabledDialog.enable')" @click="findingsHandle.enableRule(r.ruleId, r.global)" />
            </template>
          </v-list-item>
        </v-list>
        <v-card-actions>
          <v-spacer />
          <v-btn :text="t('findings.disabledDialog.close')" @click="disabledDialog = false" />
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
