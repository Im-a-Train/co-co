<script setup lang="ts">
/**
 * Thresholds (pack params) a rule reads. Params with overridable admin/coach can be changed globally via
 * settings.ruleParams; params with overridable none stay read-only.
 */
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRuleEdits } from '@/composables/useRuleEdits'
import { getAppSettings, updateAppSettings } from '@/domain/storage/settings'
import { rowValue } from '@/domain/rules/lib/params'
import type { ParamDef, ParamValue, RuleMeta } from '@/domain/types'

const props = defineProps<{ meta: RuleMeta }>()
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()
const edits = useRuleEdits()

const stored = ref<Record<string, ParamValue>>({})
const raw = reactive<Record<string, string>>({})
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

const today = () => new Date().toISOString().slice(0, 10)
const fmt = (v: ParamValue): string => (typeof v === 'string' ? v : JSON.stringify(v))

const defs = computed<ParamDef[]>(() => {
  const all = edits.packs().flatMap((p) => p.params ?? [])
  return (props.meta.params ?? []).map((k) => all.find((d) => d.key === k)).filter((d): d is ParamDef => !!d)
})
const defaultOf = (d: ParamDef): ParamValue => rowValue(d, today())?.value ?? null

async function load() {
  try {
    stored.value = { ...((await getAppSettings()).ruleParams ?? {}) }
  } catch {
    stored.value = {}
  }
  for (const d of defs.value) raw[d.key] = fmt(d.key in stored.value ? stored.value[d.key] : defaultOf(d))
}
watch(() => props.meta.id, load, { immediate: true })

function parse(d: ParamDef, text: string): ParamValue | undefined {
  const def = defaultOf(d)
  let v: ParamValue
  try {
    v = JSON.parse(text) as ParamValue
  } catch {
    if (typeof def !== 'string') return undefined
    v = text
  }
  if (def !== null && (typeof v !== typeof def || Array.isArray(v) !== Array.isArray(def))) return undefined
  if (typeof v === 'number' && !Number.isFinite(v)) return undefined
  return v
}

async function persist(next: Record<string, ParamValue>) {
  await updateAppSettings({ ruleParams: next })
  stored.value = next
  notice.value = t('rules.edit.params.saved')
  emit('saved')
}
async function save(d: ParamDef) {
  error.value = notice.value = null
  const v = parse(d, raw[d.key] ?? '')
  if (v === undefined) {
    error.value = `${d.label}: ${t('rules.edit.params.invalid')}`
    return
  }
  const next = { ...stored.value }
  if (JSON.stringify(v) === JSON.stringify(defaultOf(d))) delete next[d.key]
  else next[d.key] = v
  try {
    await persist(next)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
async function reset(d: ParamDef) {
  error.value = notice.value = null
  const next = { ...stored.value }
  delete next[d.key]
  raw[d.key] = fmt(defaultOf(d))
  try {
    await persist(next)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <div data-testid="rule-params">
    <p class="text-body-2 text-medium-emphasis mb-3">{{ t('rules.edit.params.intro') }}</p>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3" :text="error" />
    <v-alert v-if="notice" type="success" variant="tonal" density="compact" class="mb-3" :text="notice" closable @click:close="notice = null" />
    <p v-if="!defs.length" class="text-body-2">{{ t('rules.edit.params.none') }}</p>
    <v-card v-for="d in defs" :key="d.key" variant="outlined" class="mb-3 pa-3" :data-testid="`param-${d.key}`">
      <div class="d-flex flex-wrap align-center ga-2 mb-1">
        <strong>{{ d.label }}</strong>
        <code class="text-caption">{{ d.key }}</code>
        <v-chip size="x-small" label variant="tonal">{{ t(`rules.edit.params.overridable.${d.overridable}`) }}</v-chip>
        <v-chip v-if="d.key in stored" size="x-small" label color="warning">{{ t('rules.edit.params.changed') }}</v-chip>
      </div>
      <p v-if="d.description" class="text-caption text-medium-emphasis mb-2">{{ d.description }}</p>
      <div class="text-body-2 mb-2">
        {{ t('rules.edit.params.default') }}: <code>{{ fmt(defaultOf(d)) }}</code>
        <span v-if="d.unit"> {{ d.unit }}</span>
        <template v-if="d.key in stored">
          · {{ t('rules.edit.params.current') }}: <code>{{ fmt(stored[d.key]) }}</code>
        </template>
      </div>
      <p v-if="d.overridable === 'none'" class="text-caption text-medium-emphasis mb-0">{{ t('rules.edit.params.readonly') }}</p>
      <div v-else class="d-flex flex-wrap align-center ga-2">
        <v-text-field v-model="raw[d.key]" :label="d.unit ? `${t('rules.edit.params.current')} (${d.unit})` : t('rules.edit.params.current')" density="compact" variant="outlined" hide-details style="max-width: 18rem" />
        <v-btn size="small" variant="tonal" :text="t('rules.edit.params.save')" @click="save(d)" />
        <v-btn v-if="d.key in stored" size="small" variant="text" :text="t('rules.edit.params.reset')" @click="reset(d)" />
      </div>
    </v-card>
  </div>
</template>
