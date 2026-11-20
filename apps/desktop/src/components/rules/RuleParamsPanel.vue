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
const { t, te } = useI18n()
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

/** How a param is edited: one number field, one number field per key (e.g. Stufe), or raw text/JSON. */
type ParamKind = 'number' | 'map' | 'window' | 'months' | 'windows' | 'text'
interface TimeWindow {
  from: string
  to: string
}
interface NamedWindow extends TimeWindow {
  id: string
  label: string
}
const isWindow = (v: unknown): v is TimeWindow =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as TimeWindow).from === 'string' && typeof (v as TimeWindow).to === 'string'
const isMonths = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 12)
const isNamedWindows = (v: unknown): v is NamedWindow[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => isWindow(x) && typeof (x as NamedWindow).id === 'string' && typeof (x as NamedWindow).label === 'string')
function kindOf(d: ParamDef): ParamKind {
  const def = defaultOf(d)
  if (typeof def === 'number') return 'number'
  if (isWindow(def)) return 'window'
  if (d.unit === 'months' && isMonths(def)) return 'months'
  if (isNamedWindows(def)) return 'windows'
  if (def && typeof def === 'object' && !Array.isArray(def)) {
    const vals = Object.values(def as Record<string, unknown>)
    if (vals.length && vals.every((x) => typeof x === 'number')) return 'map'
  }
  return 'text'
}
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/
const winRaw = reactive<Record<string, TimeWindow>>({})
const monthSel = reactive<Record<string, number[]>>({})
const winsRaw = reactive<Record<string, NamedWindow[]>>({})
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const monthItems = computed(() => MONTHS.map((m) => ({ title: t(`rules.edit.params.month.${m}`), value: m })))
const monthShort = (m: number) => t(`rules.edit.params.monthShort.${m}`)
const windowText = (w: TimeWindow) => `${w.from}–${w.to}`
/** Readable default: «05:00–14:00», «Nov., Dez., Jan.», «Morgen 00:00–12:00, …»; raw JSON only for unknown shapes. */
function defaultText(d: ParamDef): string {
  const def = defaultOf(d)
  switch (kindOf(d)) {
    case 'window':
      return windowText(def as unknown as TimeWindow)
    case 'months':
      return (def as number[]).map(monthShort).join(', ')
    case 'windows':
      return (def as unknown as NamedWindow[]).map((w) => `${w.label} ${windowText(w)}`).join(', ')
    default:
      return fmt(def)
  }
}
const mapRaw = reactive<Record<string, Record<string, string>>>({})
const asMap = (v: ParamValue): Record<string, number> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {})

/** German unit label; '' for unknown or unit-less params. `map` names the unit of numeric maps (hours per Stufe) only. */
function unitLabel(d: ParamDef): string {
  if (d.unit === 'map' && kindOf(d) !== 'map') return ''
  const k = `rules.edit.params.unit.${d.unit}`
  return te(k) ? t(k) : ''
}
/** Defaults of a numeric map, e.g. «Biber 11 h, Wölfe 10 h». */
function mapDefaultText(d: ParamDef): string {
  const unit = unitLabel(d)
  return Object.entries(asMap(defaultOf(d)))
    .map(([k, v]) => `${keyLabel(k)} ${v}${unit ? ` ${unit}` : ''}`)
    .join(', ')
}
/** Label of one map key: Stufen use the camp-input names, anything else shows the key. */
function keyLabel(k: string): string {
  const key = `camps.inputs.stufe.${k}`
  return te(key) ? t(key) : k
}

function fill(d: ParamDef) {
  const cur = d.key in stored.value ? stored.value[d.key] : defaultOf(d)
  raw[d.key] = fmt(cur)
  const kind = kindOf(d)
  if (kind === 'window') winRaw[d.key] = isWindow(cur) ? { from: cur.from, to: cur.to } : { ...(defaultOf(d) as unknown as TimeWindow) }
  if (kind === 'months') monthSel[d.key] = isMonths(cur) ? [...cur] : [...(defaultOf(d) as number[])]
  if (kind === 'windows') {
    const def = defaultOf(d) as unknown as NamedWindow[]
    const now = isNamedWindows(cur) ? cur : def
    winsRaw[d.key] = def.map((w) => {
      const c = now.find((x) => x.id === w.id) ?? w
      return { id: w.id, label: w.label, from: c.from, to: c.to }
    })
  }
  if (kindOf(d) === 'map') {
    const def = asMap(defaultOf(d))
    const now = asMap(cur)
    mapRaw[d.key] = Object.fromEntries(Object.keys(def).map((k) => [k, String(now[k] ?? def[k])]))
  }
}

async function load() {
  // Fill right away: the map fields bind to mapRaw before the stored values arrive.
  for (const d of defs.value) fill(d)
  try {
    stored.value = { ...((await getAppSettings()).ruleParams ?? {}) }
  } catch {
    stored.value = {}
  }
  for (const d of defs.value) fill(d)
}
watch(() => props.meta.id, load, { immediate: true })

function parse(d: ParamDef): ParamValue | undefined {
  const kind = kindOf(d)
  if (kind === 'number') {
    const text = (raw[d.key] ?? '').trim().replace(',', '.')
    if (!text) return undefined
    const n = Number(text)
    return Number.isFinite(n) ? n : undefined
  }
  if (kind === 'map') {
    const out: Record<string, number> = {}
    for (const [k, text] of Object.entries(mapRaw[d.key] ?? {})) {
      const clean = text.trim().replace(',', '.')
      const n = Number(clean)
      if (!clean || !Number.isFinite(n)) return undefined
      out[k] = n
    }
    return out
  }
  if (kind === 'window') {
    const w = winRaw[d.key]
    return w && TIME_RE.test(w.from.trim()) && TIME_RE.test(w.to.trim()) ? { from: w.from.trim(), to: w.to.trim() } : undefined
  }
  if (kind === 'months') {
    const sel = new Set(monthSel[d.key] ?? [])
    if (!sel.size) return undefined
    const def = defaultOf(d) as number[]
    if (sel.size === def.length && def.every((m) => sel.has(m))) return [...def]
    return [...sel].sort((a, b) => a - b)
  }
  if (kind === 'windows') {
    const rows = winsRaw[d.key] ?? []
    if (!rows.every((w) => TIME_RE.test(w.from.trim()) && TIME_RE.test(w.to.trim()))) return undefined
    return rows.map((w) => ({ id: w.id, label: w.label, from: w.from.trim(), to: w.to.trim() }))
  }
  const def = defaultOf(d)
  let v: ParamValue
  try {
    v = JSON.parse(raw[d.key] ?? '') as ParamValue
  } catch {
    if (typeof def !== 'string') return undefined
    v = raw[d.key] ?? ''
  }
  if (def !== null && (typeof v !== typeof def || Array.isArray(v) !== Array.isArray(def))) return undefined
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
  const v = parse(d)
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
  try {
    await persist(next)
    fill(d)
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
        <v-chip size="x-small" label variant="tonal">{{ t(`rules.edit.params.overridable.${d.overridable}`) }}</v-chip>
        <v-chip v-if="d.key in stored" size="x-small" label color="warning">{{ t('rules.edit.params.changed') }}</v-chip>
      </div>
      <p v-if="d.description" class="text-caption text-medium-emphasis mb-2">{{ d.description }}</p>
      <div v-if="kindOf(d) === 'map'" class="text-body-2 mb-2">{{ t('rules.edit.params.default') }}: {{ mapDefaultText(d) }}</div>
      <div v-else-if="['window', 'months', 'windows'].includes(kindOf(d))" class="text-body-2 mb-2" :data-testid="`param-${d.key}-default`">
        {{ t('rules.edit.params.default') }}: {{ defaultText(d) }}
      </div>
      <div v-else class="text-body-2 mb-2">
        {{ t('rules.edit.params.default') }}: <code>{{ fmt(defaultOf(d)) }}</code>
        <span v-if="unitLabel(d)" class="ml-1">{{ unitLabel(d) }}</span>
      </div>
      <p v-if="d.overridable === 'none'" class="text-caption text-medium-emphasis mb-0">{{ t('rules.edit.params.readonly') }}</p>
      <template v-else>
        <div v-if="kindOf(d) === 'map' && mapRaw[d.key]" class="d-flex flex-wrap ga-2 mb-2">
          <v-text-field
            v-for="(_, k) in asMap(defaultOf(d))"
            :key="k"
            v-model="mapRaw[d.key]![k]"
            :label="keyLabel(String(k))"
            :placeholder="String(asMap(defaultOf(d))[k])"
            :suffix="unitLabel(d)"
            type="number"
            step="any"
            density="compact"
            variant="outlined"
            hide-details
            style="max-width: 8rem"
            :data-testid="`param-${d.key}-${k}`"
          />
        </div>
        <div v-if="kindOf(d) === 'window' && winRaw[d.key]" class="d-flex flex-wrap ga-2 mb-2">
          <v-text-field v-model="winRaw[d.key]!.from" :label="t('rules.edit.params.from')" placeholder="HH:MM" density="compact" variant="outlined" hide-details style="max-width: 8rem" :data-testid="`param-${d.key}-from`" />
          <v-text-field v-model="winRaw[d.key]!.to" :label="t('rules.edit.params.to')" placeholder="HH:MM" density="compact" variant="outlined" hide-details style="max-width: 8rem" :data-testid="`param-${d.key}-to`" />
        </div>
        <v-select
          v-if="kindOf(d) === 'months' && monthSel[d.key]"
          v-model="monthSel[d.key]"
          :items="monthItems"
          :label="t('rules.edit.params.currentMonths')"
          multiple
          chips
          closable-chips
          density="compact"
          variant="outlined"
          hide-details
          class="mb-2"
          style="max-width: 28rem"
          :data-testid="`param-${d.key}-months`"
        />
        <div v-if="kindOf(d) === 'windows' && winsRaw[d.key]" class="mb-2">
          <div v-for="w in winsRaw[d.key]" :key="w.id" class="d-flex flex-wrap align-center ga-2 mb-2">
            <span class="text-body-2" style="min-width: 6rem">{{ w.label }}</span>
            <v-text-field v-model="w.from" :label="t('rules.edit.params.from')" placeholder="HH:MM" density="compact" variant="outlined" hide-details style="max-width: 8rem" :data-testid="`param-${d.key}-${w.id}-from`" />
            <v-text-field v-model="w.to" :label="t('rules.edit.params.to')" placeholder="HH:MM" density="compact" variant="outlined" hide-details style="max-width: 8rem" :data-testid="`param-${d.key}-${w.id}-to`" />
          </div>
        </div>
        <div class="d-flex flex-wrap align-center ga-2">
          <v-text-field
            v-if="kindOf(d) === 'number'"
            v-model="raw[d.key]"
            :label="t('rules.edit.params.current')"
            :placeholder="fmt(defaultOf(d))"
            :suffix="unitLabel(d)"
            type="number"
            step="any"
            density="compact"
            variant="outlined"
            hide-details
            style="max-width: 14rem"
          />
          <v-text-field v-else-if="kindOf(d) === 'text'" v-model="raw[d.key]" :label="unitLabel(d) ? `${t('rules.edit.params.current')} (${unitLabel(d)})` : t('rules.edit.params.current')" density="compact" variant="outlined" hide-details style="max-width: 18rem" />
          <v-btn size="small" variant="tonal" :text="t('rules.edit.params.save')" @click="save(d)" />
          <v-btn v-if="d.key in stored" size="small" variant="text" :text="t('rules.edit.params.reset')" @click="reset(d)" />
        </div>
      </template>
    </v-card>
  </div>
</template>
