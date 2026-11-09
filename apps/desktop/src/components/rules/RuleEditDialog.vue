<script setup lang="ts">
/** Edit one rule in the Regelbuch (ADR 0013): texts, severity, validity, sources; diff/history; thresholds; AI update. */
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAi } from '@/composables/useAi'
import { useResources } from '@/composables/useResources'
import { useRuleEdits } from '@/composables/useRuleEdits'
import { validateRuleEditPatch } from '@/domain/rules/edits'
import { knownSourceKeys, resetRuleEdit, saveRuleEdit } from '@/domain/rules/editsStore'
import { loadBundledPacks } from '@/domain/rules/packs'
import { getSourceRegistry } from '@/domain/rules/packs/registry'
import type { RuleMeta } from '@/domain/types'
import RuleAiPanel from './RuleAiPanel.vue'
import RuleDiffList from './RuleDiffList.vue'
import RuleParamsPanel from './RuleParamsPanel.vue'
import { formOf, patchOfForm, type RuleForm } from './ruleDiff'

type Tab = 'edit' | 'changes' | 'params' | 'ai'
const props = defineProps<{ modelValue: boolean; ruleId: string | null; initialTab?: Tab }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; changed: [] }>()
const { t } = useI18n()
const edits = useRuleEdits()
const resources = useResources()
const { ready: aiReady } = useAi()

const tab = ref<Tab>('edit')
const saving = ref(false)
const saveError = ref<string | null>(null)
const notice = ref<string | null>(null)
const confirmReset = ref(false)

const bundled = computed<RuleMeta | null>(() => {
  for (const p of loadBundledPacks()) for (const r of p.rules) if (r.meta.id === props.ruleId) return r.meta
  return null
})
const effective = computed<RuleMeta | null>(() => {
  for (const p of edits.packs()) for (const r of p.rules) if (r.meta.id === props.ruleId) return r.meta
  return null
})
const record = computed(() => edits.edits().find((e) => e.ruleId === props.ruleId) ?? null)
const skipped = computed(() => edits.skipped().find((e) => e.ruleId === props.ruleId) ?? null)

const form = reactive<RuleForm & { reason: string; resourceKeys: string[] }>({ ...formOf(emptyMeta()), reason: '', resourceKeys: [] })
function emptyMeta(): RuleMeta {
  return { id: '', version: '', module: 'js', group: 'js', status: 'active', kind: 'hard', title: '', description: '', message: '', severity: 'hint', confidence: 'heuristic', scope: 'camp', sources: [], source: { title: '', url: '' } }
}
function loadForm() {
  const m = effective.value
  if (!m) return
  Object.assign(form, formOf(m), { reason: '', resourceKeys: [...(record.value?.resourceKeys ?? [])] })
}
watch(
  () => [props.modelValue, props.ruleId] as const,
  ([open]) => {
    if (!open) return
    tab.value = props.initialTab ?? 'edit'
    saveError.value = notice.value = null
    loadForm()
  },
  { immediate: true },
)

const sourceItems = computed(() => {
  void resources.version.value
  return getSourceRegistry().records.map((r) => ({ value: r.key, title: `${r.key} – ${r.title}${r.edition ? ` (${r.edition})` : ''}` }))
})
const resourceItems = computed(() => sourceItems.value)

const patch = computed(() => (bundled.value ? patchOfForm(form, bundled.value) : {}))
const errors = computed(() => {
  const b = bundled.value
  if (!b) return []
  void resources.version.value
  return validateRuleEditPatch(b, patch.value, 'manual', knownSourceKeys())
})
const mustHint = computed(() => form.severity === 'must' && form.confidence !== 'verified')
const bundleMoved = computed(() => !!record.value && !!bundled.value && record.value.baseVersion !== bundled.value.version)

async function save() {
  if (!bundled.value || errors.value.length) return
  saving.value = true
  saveError.value = notice.value = null
  try {
    const rec = await saveRuleEdit(bundled.value.id, patch.value, { origin: 'manual', reason: form.reason, resourceKeys: form.resourceKeys })
    notice.value = rec ? t('rules.edit.saved') : t('rules.edit.noChange')
    loadForm()
    emit('changed')
    if (rec) emit('update:modelValue', false)
  } catch (e) {
    saveError.value = `${t('rules.edit.saveFailed')}: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    saving.value = false
  }
}

async function doReset() {
  if (!bundled.value) return
  confirmReset.value = false
  try {
    await resetRuleEdit(bundled.value.id)
    loadForm()
    emit('changed')
    emit('update:modelValue', false)
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  }
}

function addSource() {
  form.sources.push({ key: '', page: '', quote: '' })
}
function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' })
}
const SEVERITIES = ['must', 'should', 'hint'] as const
const CONFIDENCES = ['verified', 'best-practice', 'heuristic', 'unverified', 'conflict'] as const
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="920" scrollable data-testid="rule-edit-dialog" @update:model-value="emit('update:modelValue', $event)">
    <v-card v-if="bundled && effective">
      <v-card-title class="d-flex align-center ga-2 flex-wrap">
        <span>{{ t('rules.edit.dialogTitle', { id: bundled.id }) }}</span>
        <v-chip v-if="record" size="x-small" color="warning" label>{{ t('rules.edit.chip') }}</v-chip>
      </v-card-title>
      <v-tabs v-model="tab" density="compact">
        <v-tab value="edit" data-testid="rule-tab-edit">{{ t('rules.edit.tabs.edit') }}</v-tab>
        <v-tab value="changes" data-testid="rule-tab-changes">{{ t('rules.edit.tabs.changes') }}</v-tab>
        <v-tab v-if="bundled.params?.length" value="params" data-testid="rule-tab-params">{{ t('rules.edit.tabs.params') }}</v-tab>
        <v-tab v-if="aiReady" value="ai" data-testid="rule-tab-ai">{{ t('rules.edit.tabs.ai') }}</v-tab>
      </v-tabs>
      <v-divider />
      <v-card-text class="pt-4">
        <v-window v-model="tab" :touch="false">
          <v-window-item value="edit" eager>
            <p class="text-body-2 text-medium-emphasis mb-3">{{ t('rules.edit.intro') }}</p>
            <v-alert v-if="skipped" type="warning" variant="tonal" density="compact" class="mb-3" :text="t('rules.edit.skipped', { errors: skipped.errors.join(' ') })" />
            <v-alert v-if="bundleMoved && record" type="warning" variant="tonal" density="compact" class="mb-3" :text="t('rules.edit.bundledChanged', { from: record.baseVersion, to: bundled.version })" />
            <v-text-field v-model="form.title" :label="t('rules.edit.fields.title')" density="compact" variant="outlined" data-testid="rule-edit-title" />
            <v-textarea v-model="form.description" :label="t('rules.edit.fields.description')" rows="3" auto-grow density="compact" variant="outlined" />
            <v-textarea v-model="form.message" :label="t('rules.edit.fields.message')" :hint="t('rules.edit.hints.placeholders')" persistent-hint rows="2" auto-grow density="compact" variant="outlined" class="mb-3" />
            <v-textarea v-model="form.feedbackText" :label="t('rules.edit.fields.feedbackText')" :hint="t('rules.edit.hints.feedbackText')" persistent-hint rows="2" auto-grow density="compact" variant="outlined" class="mb-3" data-testid="rule-edit-feedback-text" />
            <template v-if="Object.keys(form.variants).length">
              <div class="text-subtitle-2 mb-1">{{ t('rules.edit.fields.variants') }}</div>
              <v-textarea v-for="(_, name) in form.variants" :key="name" v-model="form.variants[name]" :label="String(name)" rows="1" auto-grow density="compact" variant="outlined" />
            </template>
            <div class="d-flex flex-wrap ga-3">
              <v-select v-model="form.severity" :items="SEVERITIES.map((s) => ({ value: s, title: t(`severity.${s}`) }))" :label="t('rules.edit.fields.severity')" density="compact" variant="outlined" class="flex-1-1" style="min-width: 10rem" data-testid="rule-edit-severity" />
              <v-select v-model="form.confidence" :items="CONFIDENCES.map((s) => ({ value: s, title: t(`confidence.${s}`) }))" :label="t('rules.edit.fields.confidence')" :hint="mustHint ? t('rules.edit.hints.mustNeedsVerified') : undefined" :persistent-hint="mustHint" density="compact" variant="outlined" class="flex-1-1" style="min-width: 10rem" data-testid="rule-edit-confidence" />
              <v-select v-model="form.status" :items="(['active', 'retired'] as const).map((s) => ({ value: s, title: t(`rules.edit.status.${s}`) }))" :label="t('rules.edit.fields.status')" density="compact" variant="outlined" class="flex-1-1" style="min-width: 10rem" />
            </div>
            <div class="d-flex flex-wrap ga-3">
              <v-text-field v-model="form.validFrom" :label="t('rules.edit.fields.validFrom')" :hint="t('rules.edit.hints.date')" persistent-hint density="compact" variant="outlined" class="flex-1-1" style="min-width: 10rem" />
              <v-text-field v-model="form.validTo" :label="t('rules.edit.fields.validTo')" :hint="t('rules.edit.hints.date')" persistent-hint density="compact" variant="outlined" class="flex-1-1" style="min-width: 10rem" />
            </div>

            <div class="text-subtitle-2 mt-4 mb-1">{{ t('rules.edit.fields.sources') }}</div>
            <div v-for="(s, i) in form.sources" :key="i" class="d-flex flex-wrap align-start ga-2 mb-1" :data-testid="`rule-edit-source-${i}`">
              <v-select v-model="s.key" :items="sourceItems" :label="t('rules.edit.sources.key')" density="compact" variant="outlined" hide-details style="min-width: 16rem; flex: 2" />
              <v-text-field v-model="s.page" :label="t('rules.edit.sources.page')" density="compact" variant="outlined" hide-details style="min-width: 8rem; flex: 1" />
              <v-text-field v-model="s.quote" :label="t('rules.edit.sources.quote')" density="compact" variant="outlined" hide-details style="min-width: 12rem; flex: 2" />
              <v-btn icon="mdi-close" size="small" variant="text" :aria-label="t('rules.edit.sources.remove')" @click="form.sources.splice(i, 1)" />
            </div>
            <v-btn size="small" variant="text" prepend-icon="mdi-plus" :text="t('rules.edit.sources.add')" @click="addSource" />

            <v-combobox v-model="form.tags" :label="t('rules.edit.fields.tags')" multiple chips closable-chips density="compact" variant="outlined" class="mt-3" />
            <v-select v-model="form.resourceKeys" :items="resourceItems" :label="t('rules.edit.fields.resourceKeys')" multiple chips closable-chips density="compact" variant="outlined" />
            <v-text-field v-model="form.reason" :label="t('rules.edit.fields.reason')" :hint="t('rules.edit.hints.reason')" persistent-hint density="compact" variant="outlined" data-testid="rule-edit-reason" />

            <v-alert v-if="errors.length" type="error" variant="tonal" density="compact" class="mt-3" data-testid="rule-edit-errors">
              <strong>{{ t('rules.edit.errorsTitle') }}</strong>
              <ul class="ml-4">
                <li v-for="e in errors" :key="e">{{ e }}</li>
              </ul>
            </v-alert>
            <v-alert v-if="saveError" type="error" variant="tonal" density="compact" class="mt-3" :text="saveError" />
          </v-window-item>

          <v-window-item value="changes">
            <h3 class="text-subtitle-1 mb-2">{{ t('rules.edit.diff.title') }}</h3>
            <RuleDiffList :before="bundled" :after="effective" />
            <template v-if="record">
              <div class="text-body-2 mt-3 mb-1">
                <v-chip size="x-small" label>{{ t(`rules.edit.history.by.${record.updatedBy}`) }}</v-chip>
                {{ fmtDate(record.updatedAt) }}<span v-if="record.reason"> – {{ record.reason }}</span>
              </div>
              <h3 class="text-subtitle-1 mt-4 mb-2">{{ t('rules.edit.history.title') }}</h3>
              <p v-if="!record.history?.length" class="text-body-2 text-medium-emphasis">{{ t('rules.edit.history.empty') }}</p>
              <v-list v-else density="compact" data-testid="rule-history">
                <v-list-item v-for="(h, i) in record.history" :key="i" :subtitle="Object.keys(h.patch).join(', ')">
                  <v-list-item-title>
                    <v-chip size="x-small" label class="mr-2">{{ t(`rules.edit.history.by.${h.updatedBy}`) }}</v-chip>{{ fmtDate(h.updatedAt) }}<span v-if="h.reason"> – {{ h.reason }}</span>
                  </v-list-item-title>
                </v-list-item>
              </v-list>
              <v-btn class="mt-3" size="small" variant="tonal" color="warning" prepend-icon="mdi-restore" :text="t('rules.edit.reset')" data-testid="rule-edit-reset" @click="confirmReset = true" />
            </template>
          </v-window-item>

          <v-window-item v-if="bundled.params?.length" value="params">
            <RuleParamsPanel :meta="effective" @saved="emit('changed')" />
          </v-window-item>

          <v-window-item v-if="aiReady" value="ai">
            <RuleAiPanel :meta="effective" @applied="emit('changed')" />
          </v-window-item>
        </v-window>
      </v-card-text>
      <v-divider />
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :text="t('common.close')" @click="emit('update:modelValue', false)" />
        <v-btn v-if="tab === 'edit'" color="primary" variant="flat" :disabled="errors.length > 0" :loading="saving" :text="t('rules.edit.save')" data-testid="rule-edit-save" @click="save" />
      </v-card-actions>
    </v-card>

    <v-dialog v-model="confirmReset" max-width="460">
      <v-card :title="t('rules.edit.resetConfirmTitle')" :text="t('rules.edit.resetConfirmText', { title: bundled?.title ?? '' })">
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :text="t('common.cancel')" @click="confirmReset = false" />
          <v-btn color="warning" variant="flat" :text="t('rules.edit.reset')" data-testid="rule-edit-reset-confirm" @click="doReset" />
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>
