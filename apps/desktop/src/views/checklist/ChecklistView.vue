<script setup lang="ts">
/**
 * /lager/:campId/checkliste: the deadlines of this camp (same computation and same storage as /fristen)
 * and the coach checklist. Linked checklist items and milestones share one done state, see
 * domain/rules/lib/checklistSync.ts; this view only runs the planned writes (sequentially).
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import CoachChecklistCard from '@/components/camps/CoachChecklistCard.vue'
import DeadlineStatusChip from '@/components/rules/DeadlineStatusChip.vue'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampRoute } from '@/composables/useCampRoute'
import { useCampRuleConfig } from '@/composables/useCampRuleConfig'
import { useCampSettings } from '@/composables/useCampSettings'
import { emptyCoachInputs } from '@/domain/campFacts/store'
import { loadBundledChecklist } from '@/domain/rules/lib/checklist'
import { buildChecklistRows, planItemToggle, planMilestoneToggle, withDeadlineDone, type ChecklistRow, type SyncPlan } from '@/domain/rules/lib/checklistSync'
import { computeDeadlines, daysBetween, deadlineStatus, type DeadlineCamp } from '@/domain/rules/lib/deadlines'
import { computeMilestoneDeadlines, loadBundledMilestones, milestoneContextFromConfig } from '@/domain/rules/milestones'
import { listCampSummaries } from '@/domain/rules/store'
import type { CoachInputs, Deadline } from '@/domain/types'

const { t } = useI18n()
const { campId, campIri } = useCampRoute()
const { facts, load: loadFacts } = useCampFacts(campIri)
const settings = useCampSettings(campIri)
const rc = useCampRuleConfig(campIri)

const lastJsDate = shallowRef<string | null>(null)
const saveError = ref<string | null>(null)
const milestoneList = loadBundledMilestones()

async function init(): Promise<void> {
  try {
    await settings.load()
    lastJsDate.value = (await listCampSummaries()).find((s) => s.campIri === campIri.value)?.lastJsDate ?? null
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  }
}
onMounted(() => {
  void loadFacts()
  void init()
})
watch(campIri, () => void init())

const today = computed(() => new Date().toISOString().slice(0, 10))

const camp = computed<DeadlineCamp | null>(() => {
  const c = facts.value?.camp
  if (!c) return null
  return { iri: c.iri, title: c.title, start: c.start, end: c.end, lastJsDate: lastJsDate.value, lastActivityDate: rc.config.value.angebot?.lastActivityDate ?? null }
})

/** Same inputs as /fristen (stored CoachInputs; milestone context from the stored config). */
const deadlines = computed<Deadline[]>(() => {
  if (!camp.value) return []
  const inputs = settings.coachInputs.value
  return [
    ...computeDeadlines(camp.value, inputs),
    ...computeMilestoneDeadlines(camp.value, inputs, milestoneList, milestoneContextFromConfig(rc.config.value)),
  ].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.kind.localeCompare(b.kind) || (a.milestoneId ?? '').localeCompare(b.milestoneId ?? '')))
})

const deadlineRows = computed(() =>
  deadlines.value.map((d) => ({
    d,
    key: `${d.kind}${d.milestoneId ? `:${d.milestoneId}` : ''}`,
    title: d.kind === 'pbs-milestone' ? (d.title ?? d.milestoneId ?? '') : t(`rules.deadlines.kind.${d.kind}`),
    status: deadlineStatus(d, today.value),
    left: daysBetween(today.value, d.due),
  })),
)

const rows = computed(() =>
  buildChecklistRows(
    rc.checklist.value,
    rc.config.value.checklist,
    deadlines.value.filter((d) => d.kind === 'pbs-milestone'),
    today.value,
  ),
)

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

/** Runs a plan: milestone (CoachInputs) first, then the checklist state, sequentially. */
async function run(plan: SyncPlan, deadline: Pick<Deadline, 'kind' | 'milestoneId'> | null, done: boolean): Promise<void> {
  saveError.value = null
  try {
    if (deadline) {
      // Plain copy: IndexedDB cannot clone Vue reactive proxies.
      const stored = settings.coachInputs.value
      const current: CoachInputs = stored ? JSON.parse(JSON.stringify(stored)) : emptyCoachInputs(campIri.value)
      await settings.saveCoachInputs(withDeadlineDone(current, deadline, done, today.value))
    }
    for (const c of plan.checklist) await rc.setChecklistItem(c.id, { done: c.done })
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  }
}

function toggleDeadline(d: Deadline, done: boolean): Promise<void> {
  if (d.kind === 'pbs-milestone' && d.milestoneId) return run(planMilestoneToggle(d.milestoneId, done, loadBundledChecklist()), d, done)
  // Other kinds have their own flag in CoachInputs (the same one «Angaben» edits) and no checklist twin.
  return run({ checklist: [] }, d, done)
}

function toggleItem(row: ChecklistRow, done: boolean): Promise<void> {
  // The milestone is only written when it is part of this camp's deadlines; the item state is written either way.
  return run(planItemToggle(row.item, done), row.deadline, done)
}
</script>

<template>
  <div data-testid="checklist-view">
    <h1 class="text-h5 mb-1">{{ t('campConfig.checklist.tabTitle') }}</h1>
    <p class="text-body-2 text-medium-emphasis mb-4">{{ t('campConfig.checklist.tabIntro') }}</p>

    <v-card variant="outlined" class="mb-4" data-testid="camp-deadlines-card">
      <v-card-title class="d-flex align-center flex-wrap ga-2 text-subtitle-1">
        <span>{{ t('campConfig.checklist.deadlinesTitle') }}</span>
        <v-spacer />
        <v-btn size="small" variant="text" append-icon="mdi-arrow-right" to="/fristen" data-testid="to-fristen">{{ t('campConfig.checklist.toFristen') }}</v-btn>
      </v-card-title>
      <v-card-text>
        <div v-if="!deadlineRows.length" class="text-body-2 text-medium-emphasis">{{ t('campConfig.checklist.deadlinesEmpty') }}</div>
        <div
          v-for="r in deadlineRows"
          :key="r.key"
          class="d-flex align-center ga-2 py-1 camp-deadline"
          :data-testid="r.d.kind === 'pbs-milestone' ? 'camp-milestone' : 'camp-deadline'"
        >
          <v-checkbox-btn
            class="flex-grow-0"
            :model-value="r.d.done"
            density="compact"
            :aria-label="t('campConfig.checklist.done')"
            data-testid="camp-deadline-done"
            @update:model-value="(v: boolean | null) => toggleDeadline(r.d, v === true)"
          />
          <div class="flex-grow-1">
            <div class="text-body-2" :class="{ 'text-medium-emphasis': r.d.done }">{{ r.title }}</div>
            <div class="text-caption text-medium-emphasis">{{ fmt(r.d.due) }} · {{ relative(r.left) }}</div>
          </div>
          <DeadlineStatusChip :status="r.status" />
        </div>
        <p class="text-caption text-medium-emphasis mt-2 mb-0">
          {{ t('campConfig.checklist.deadlinesHint') }}
          <RouterLink :to="`/lager/${campId}/angaben`">{{ t('campConfig.checklist.toInputs') }}</RouterLink>
        </p>
      </v-card-text>
    </v-card>

    <CoachChecklistCard :camp-iri="campIri" :rows="rows" :save-error="saveError" @toggle="toggleItem" />
  </div>
</template>
