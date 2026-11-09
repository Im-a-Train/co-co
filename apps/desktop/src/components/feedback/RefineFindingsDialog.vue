<script setup lang="ts">
/**
 * "Befunde übernehmen": all findings without feedback (manual first, then open rule/AI findings), grouped like
 * the feedback structure, each with an editable text. Emits the new items; the parent persists them.
 */
import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFindings } from '@/composables/useFindings'
import { useManualFindings } from '@/composables/useManualFindings'
import type { NewFeedback } from '@/composables/useFeedback'
import { itemFromFinding, KIND_ORDER } from '@/domain/feedback'
import { groupFeedback, type FeedbackStructure } from '@/domain/feedback/structure'
import { manualToFinding } from '@/domain/manualFindings'
import { findingStatus } from '@/domain/triage'
import type { CampFacts, DocumentRecord, FeedbackItem, FeedbackKind, Finding, Iri, ManualFindingCategory } from '@/domain/types'

type DocLike = Pick<DocumentRecord, 'id' | 'name' | 'activityIris'>

const props = defineProps<{
  modelValue: boolean
  campIri: Iri
  facts: CampFacts | null
  feedbackItems: FeedbackItem[]
  documents?: DocLike[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; submit: [items: NewFeedback[]] }>()

const { t } = useI18n()
const findingsHandle = useFindings(() => props.campIri)
const manual = useManualFindings(() => props.campIri)

interface Row {
  /** Finding id, also the id of the draft item. */
  id: string
  finding: Finding
  draft: FeedbackItem
}

function categoryLabel(c: ManualFindingCategory): string {
  return t(`findings.manual.category.${c}`)
}

function toRows(findings: Finding[]): Row[] {
  return findings.map((finding) => {
    const draft = itemFromFinding(finding, props.campIri)
    draft.id = finding.id
    return { id: finding.id, finding, draft }
  })
}

const documentNames = computed(() => Object.fromEntries((props.documents ?? []).map((d) => [d.id, d.name])))

const manualRows = computed<Row[]>(() =>
  toRows(
    manual.items.value
      .map((mf) => manualToFinding(mf, { facts: props.facts, documentNames: documentNames.value, categoryLabel }))
      .filter((f) => findingStatus(f, props.feedbackItems) === 'open'),
  ),
)
const autoRows = computed<Row[]>(() =>
  toRows(
    findingsHandle.findings.value.filter(
      (f) => f.origin !== 'manual' && findingStatus(f, props.feedbackItems) === 'open',
    ),
  ),
)
const rowById = computed(() => new Map([...manualRows.value, ...autoRows.value].map((r) => [r.id, r])))

// Per-row editable state, keyed by finding id (survives recomputation of the rows).
const selected = reactive<Record<string, boolean>>({})
const texts = reactive<Record<string, string>>({})
const kinds = reactive<Record<string, FeedbackKind>>({})

watch(
  [manualRows, autoRows],
  () => {
    for (const r of manualRows.value) init(r, true)
    for (const r of autoRows.value) init(r, false)
  },
  { immediate: true },
)
function init(r: Row, preselect: boolean) {
  if (r.id in selected) return
  selected[r.id] = preselect
  texts[r.id] = r.draft.text
  kinds[r.id] = r.draft.kind
}

interface SectionView {
  key: 'manual' | 'auto'
  label: string
  structure: FeedbackStructure
  count: number
}
function structureOf(rows: Row[]): FeedbackStructure {
  return groupFeedback(rows.map((r) => r.draft), props.facts, props.documents ?? [])
}
const sections = computed<SectionView[]>(() => {
  const out: SectionView[] = []
  if (manualRows.value.length > 0) {
    out.push({ key: 'manual', label: t('feedback.refine.manualSection'), structure: structureOf(manualRows.value), count: manualRows.value.length })
  }
  if (autoRows.value.length > 0) {
    out.push({ key: 'auto', label: t('feedback.refine.autoSection'), structure: structureOf(autoRows.value), count: autoRows.value.length })
  }
  return out
})

const allIds = computed(() => [...manualRows.value, ...autoRows.value].map((r) => r.id))
const selectedIds = computed(() => allIds.value.filter((id) => selected[id] && (texts[id] ?? '').trim() !== ''))
function setAll(value: boolean) {
  for (const id of allIds.value) selected[id] = value
}

function close() {
  emit('update:modelValue', false)
}
function submit() {
  const out: NewFeedback[] = []
  for (const id of selectedIds.value) {
    const r = rowById.value.get(id)
    if (!r) continue
    const d = r.draft
    const nf: NewFeedback = { scope: d.scope, kind: kinds[id] ?? d.kind, text: (texts[id] ?? '').trim() }
    if (d.activityIri) nf.activityIri = d.activityIri
    if (d.ruleId) nf.ruleId = d.ruleId
    if (d.findingId) nf.findingId = d.findingId
    if (d.manualFindingId) nf.manualFindingId = d.manualFindingId
    if (d.documentId) nf.documentId = d.documentId
    if (d.documentAnchor) nf.documentAnchor = d.documentAnchor
    if (d.redDerived) nf.redDerived = true
    out.push(nf)
  }
  if (out.length === 0) return
  emit('submit', out)
  close()
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="900" scrollable @update:model-value="emit('update:modelValue', $event)">
    <v-card data-testid="refine-dialog">
      <v-card-title>{{ t('feedback.refine.title') }}</v-card-title>
      <v-card-subtitle class="text-wrap">{{ t('feedback.refine.hint') }}</v-card-subtitle>
      <v-card-text>
        <v-progress-linear v-if="findingsHandle.evaluating.value" indeterminate class="mb-2" />
        <div v-if="findingsHandle.evaluating.value && sections.length === 0" class="text-medium-emphasis">{{ t('feedback.refine.loading') }}</div>
        <div v-else-if="sections.length === 0" class="text-medium-emphasis" data-testid="refine-empty">{{ t('feedback.refine.empty') }}</div>

        <div v-else class="d-flex ga-2 mb-3 align-center">
          <v-btn size="small" variant="text" @click="setAll(true)">{{ t('feedback.refine.selectAll') }}</v-btn>
          <v-btn size="small" variant="text" @click="setAll(false)">{{ t('feedback.refine.selectNone') }}</v-btn>
          <v-spacer />
          <span class="text-caption text-medium-emphasis">{{ t('feedback.refine.selected', { n: selectedIds.length }) }}</span>
        </div>

        <section v-for="s in sections" :key="s.key" class="mb-4" :data-testid="`refine-section-${s.key}`">
          <h3 class="text-subtitle-1 mb-2">{{ s.label }} ({{ s.count }})</h3>

          <template v-if="s.structure.general.length > 0">
            <div class="text-subtitle-2 mt-2">{{ t('feedback.structure.general') }}</div>
            <div v-for="i in s.structure.general" :key="i.id" class="refine-row">
              <v-checkbox v-model="selected[i.id]" density="compact" hide-details :data-testid="`refine-check-${i.id}`" />
              <div class="flex-grow-1">
                <div class="text-caption text-medium-emphasis">{{ rowById.get(i.id)?.finding.title }}</div>
                <v-textarea v-model="texts[i.id]" :label="t('feedback.refine.textLabel')" auto-grow rows="1" density="compact" variant="outlined" hide-details />
              </div>
              <v-select v-model="kinds[i.id]" :items="KIND_ORDER.map((k) => ({ title: t(`feedback.kind.${k}`), value: k }))" density="compact" variant="outlined" hide-details class="refine-kind" />
            </div>
          </template>

          <template v-for="day in s.structure.days" :key="day.dayIri ?? 'none'">
            <div class="text-subtitle-2 mt-3">{{ day.label }}</div>
            <div v-for="a in day.activities" :key="a.activityIri" class="ms-3">
              <div class="text-body-2 font-weight-medium mt-1">{{ a.number ? `${a.number} ` : '' }}{{ a.title }}</div>
              <div v-for="i in a.items" :key="i.id" class="refine-row">
                <v-checkbox v-model="selected[i.id]" density="compact" hide-details :data-testid="`refine-check-${i.id}`" />
                <div class="flex-grow-1">
                  <div class="text-caption text-medium-emphasis">{{ rowById.get(i.id)?.finding.title }}</div>
                  <v-textarea v-model="texts[i.id]" :label="t('feedback.refine.textLabel')" auto-grow rows="1" density="compact" variant="outlined" hide-details />
                </div>
                <v-select v-model="kinds[i.id]" :items="KIND_ORDER.map((k) => ({ title: t(`feedback.kind.${k}`), value: k }))" density="compact" variant="outlined" hide-details class="refine-kind" />
              </div>
            </div>
          </template>
        </section>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">{{ t('feedback.cancel') }}</v-btn>
        <v-btn variant="flat" color="primary" :disabled="selectedIds.length === 0" data-testid="refine-submit" @click="submit">
          {{ t('feedback.refine.submit', { n: selectedIds.length }) }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.refine-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 4px;
}
.refine-kind {
  max-width: 140px;
  flex: 0 0 140px;
}
</style>
