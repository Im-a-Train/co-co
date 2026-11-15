<script setup lang="ts">
/**
 * /lager/:campId/checkliste: the deadlines of this camp (same computation and same storage as /fristen)
 * and the coach checklist. Linked checklist items and milestones share one done state, see
 * domain/rules/lib/checklistSync.ts; this view only runs the planned writes (sequentially).
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import CoachChecklistCard from '@/components/camps/CoachChecklistCard.vue'
import DeadlineStatusChip from '@/components/rules/DeadlineStatusChip.vue'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampRoute } from '@/composables/useCampRoute'
import { useCampRuleConfig } from '@/composables/useCampRuleConfig'
import { useCampSettings } from '@/composables/useCampSettings'
import { emptyCoachInputs } from '@/domain/campFacts/store'
import { loadBundledChecklist } from '@/domain/rules/lib/checklist'
import {
  buildChecklistRows,
  buildCustomRows,
  coachDeadlines,
  deadlineDateField,
  deadlineDateValue,
  deadlineKey,
  planItemToggle,
  planMilestoneToggle,
  showStatusChip,
  splitHidden,
  withDeadlineDate,
  withDeadlineDone,
  type ChecklistRow,
  type SyncPlan,
} from '@/domain/rules/lib/checklistSync'
import { computeDeadlines, daysBetween, deadlineStatus, type DeadlineCamp } from '@/domain/rules/lib/deadlines'
import { computeMilestoneDeadlines, loadBundledMilestones, milestoneContextFromConfig } from '@/domain/rules/milestones'
import { listCampSummaries } from '@/domain/rules/store'
import type { CoachInputs, Deadline } from '@/domain/types'

const { t } = useI18n()
const { campIri } = useCampRoute()
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

/** Hidden points/deadlines of this camp are only listed (greyed, restorable) while this is on. */
const showHidden = ref(false)
const hiddenKeys = computed(() => rc.config.value.hiddenChecklist ?? [])

const allDeadlineRows = computed(() =>
  coachDeadlines(deadlines.value).map((d) => ({
    d,
    key: deadlineKey(d),
    title: d.kind === 'pbs-milestone' ? (d.title ?? d.milestoneId ?? '') : t(`rules.deadlines.kind.${d.kind}`),
    status: deadlineStatus(d, today.value),
    left: daysBetween(today.value, d.due),
  })),
)

const deadlineSplit = computed(() => splitHidden(allDeadlineRows.value, (r) => r.key, hiddenKeys.value))
const isUnconfirmed = (d: Deadline): boolean => d.kind === 'pbs-milestone' && d.confidence === 'unverified'
/** «Auch genannt: Hering, 10.11.2030» for a milestone that also stands for de-duplicated twins of another pack. */
const alsoNamedOf = (d: Deadline): string[] => (d.alsoNamed ?? []).map((a) => t('rules.deadlines.alsoNamed', { source: a.source, date: fmt(a.due) }))
const deadlineRows = computed(() => (showHidden.value ? [...deadlineSplit.value.shown, ...deadlineSplit.value.hiddenEntries] : deadlineSplit.value.shown))
const isHidden = (key: string): boolean => hiddenKeys.value.includes(key)

const allRows = computed(() =>
  buildChecklistRows(
    rc.checklist.value.filter((i) => i.audience === 'coach'),
    rc.config.value.checklist,
    deadlines.value.filter((d) => d.kind === 'pbs-milestone'),
    today.value,
  ),
)

const rowSplit = computed(() => splitHidden(allRows.value, (r) => r.item.id, hiddenKeys.value))
const rows = computed(() => rowSplit.value.shown)
const hiddenRows = computed(() => rowSplit.value.hiddenEntries)
const customRows = computed(() => buildCustomRows(rc.config.value.customChecklist, rc.config.value.checklist, today.value))
const hiddenCount = computed(() => deadlineSplit.value.hiddenEntries.length + hiddenRows.value.length)
// The switch disappears with the last hidden entry; start hidden again when the next one is hidden.
watch(hiddenCount, (n) => {
  if (n === 0) showHidden.value = false
})

async function setHidden(key: string, hidden: boolean): Promise<void> {
  saveError.value = null
  try {
    await rc.setChecklistHidden(key, hidden)
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
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

/** Runs a plan: milestone (CoachInputs) first, then the checklist state, sequentially. */
async function run(plan: SyncPlan, deadline: Pick<Deadline, 'kind' | 'milestoneId' | 'alsoNamed'> | null, done: boolean): Promise<void> {
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

/** Inline date of a deadline row: NDS «angemeldet/abgeschlossen am», Leih-/Landeskarten «Lieferdatum». */
async function setDeadlineDate(d: Deadline, value: string): Promise<void> {
  saveError.value = null
  try {
    const stored = settings.coachInputs.value
    const current: CoachInputs = stored ? JSON.parse(JSON.stringify(stored)) : emptyCoachInputs(campIri.value)
    await settings.saveCoachInputs(withDeadlineDate(current, d.kind, value || null))
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  }
}
const dateValueOf = (d: Deadline): string => deadlineDateValue(settings.coachInputs.value, d.kind) ?? ''
/**
 * Saves the inline date on blur / Enter only: Chromium fires `change` on every keystroke of the year
 * (0002, 0020, …), which would store a half-typed date and re-sort the row away from the cursor.
 */
function commitDate(d: Deadline, e: Event): void {
  const value = (e.target as HTMLInputElement).value
  if (value !== dateValueOf(d)) void setDeadlineDate(d, value)
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
    <p class="text-body-2 text-medium-emphasis mb-1">{{ t('campConfig.checklist.tabIntro') }}</p>
    <p class="text-caption text-medium-emphasis mb-2" data-testid="checklist-leaders-caption">{{ t('campConfig.checklist.leadersCaption') }}</p>
    <v-switch
      v-if="hiddenCount > 0"
      v-model="showHidden"
      :label="t('campConfig.checklist.showHidden', { n: hiddenCount })"
      density="compact"
      hide-details
      color="primary"
      class="mb-2"
      data-testid="show-hidden-switch"
    />

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
          :class="{ 'text-disabled': isHidden(r.key) }"
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
            <div class="text-body-2" :class="{ 'text-medium-emphasis': r.d.done }">
              {{ r.title }}
              <v-chip
                v-if="isUnconfirmed(r.d)"
                size="x-small"
                label
                variant="tonal"
                class="ml-1"
                :title="t('rules.deadlines.unconfirmedHint', { source: r.d.source?.title ?? '' })"
                data-testid="unverified-badge"
              >
                {{ t('campConfig.checklist.unconfirmed') }}
              </v-chip>
            </div>
            <div class="text-caption text-medium-emphasis">
              {{ fmt(r.d.due) }} · {{ relative(r.left) }}
              <span v-for="a in alsoNamedOf(r.d)" :key="a" data-testid="deadline-also-named"> · {{ a }}</span>
            </div>
            <div v-if="deadlineDateField(r.d.kind) === 'done' && r.d.done" class="d-flex align-center flex-wrap ga-2 mt-1" data-testid="deadline-done-date">
              <label class="text-caption" :for="`done-${r.key}`">{{ t(`campConfig.checklist.doneOn.${r.d.kind}`) }}</label>
              <input
                :id="`done-${r.key}`"
                type="date"
                class="cl-date"
                :value="dateValueOf(r.d)"
                data-testid="deadline-done-date-input"
                @blur="(e: Event) => commitDate(r.d, e)"
                @keydown.enter="(e: Event) => commitDate(r.d, e)"
              />
            </div>
            <div v-else-if="deadlineDateField(r.d.kind) === 'delivery'" class="d-flex align-center flex-wrap ga-2 mt-1" data-testid="deadline-delivery">
              <label class="text-caption" :for="`delivery-${r.key}`">{{ t('campConfig.checklist.deliveryLabel') }}</label>
              <input
                :id="`delivery-${r.key}`"
                type="date"
                class="cl-date"
                :value="dateValueOf(r.d)"
                :title="t('campConfig.checklist.deliveryHint')"
                data-testid="deadline-delivery-input"
                @blur="(e: Event) => commitDate(r.d, e)"
                @keydown.enter="(e: Event) => commitDate(r.d, e)"
              />
            </div>
          </div>
          <DeadlineStatusChip v-if="showStatusChip(r.status)" :status="r.status" />
          <v-btn
            v-if="!isHidden(r.key)"
            icon="mdi-eye-off-outline"
            size="x-small"
            variant="text"
            :title="t('campConfig.checklist.hide')"
            :aria-label="t('campConfig.checklist.hide')"
            data-testid="deadline-hide"
            @click="setHidden(r.key, true)"
          />
          <v-btn v-else size="x-small" variant="text" data-testid="deadline-restore" @click="setHidden(r.key, false)">{{ t('campConfig.checklist.restore') }}</v-btn>
        </div>
      </v-card-text>
    </v-card>

    <CoachChecklistCard
      :camp-iri="campIri"
      :rows="rows"
      :hidden-rows="showHidden ? hiddenRows : []"
      :custom-rows="customRows"
      :save-error="saveError"
      @toggle="toggleItem"
    />
  </div>
</template>

<style scoped>
.cl-date {
  border: 1px solid rgba(var(--v-border-color), 0.4);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 0.8125rem;
  color: inherit;
  background: transparent;
}
</style>
