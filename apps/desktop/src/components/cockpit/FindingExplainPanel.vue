<script setup lang="ts">
/** «Warum?»: rule version, pack, validity, how the severity came about, input chips and the facts behind a verdict. */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ExplainFact, ExplainInput, Finding } from '@/domain/types'

const props = defineProps<{ finding: Finding }>()
const { t, te } = useI18n()
const open = ref(false)

const ex = computed(() => props.finding.explain ?? null)

function dateDe(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso
}
function dateTimeDe(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })
}

const validity = computed(() => {
  const e = ex.value
  if (!e) return ''
  if (e.validFrom && e.validTo) return `${t('findings.explain.validityFrom', { from: dateDe(e.validFrom) })}, ${t('findings.explain.validityTo', { to: dateDe(e.validTo) })}`
  if (e.validFrom) return t('findings.explain.validityFrom', { from: dateDe(e.validFrom) })
  if (e.validTo) return t('findings.explain.validityTo', { to: dateDe(e.validTo) })
  return t('findings.explain.validityAlways')
})

const severityText = computed(() => {
  const e = ex.value
  if (!e) return ''
  return t(`findings.explain.severityReason.${e.severityReason}`, {
    base: t(`severity.${e.baseSeverity}`),
    severity: t(`severity.${props.finding.severity}`),
  })
})

function inputText(i: ExplainInput): string {
  const name = t(`findings.explain.input.${i.key}`)
  if (i.state === 'missing') return `${name}: ${t('findings.explain.missingHint')}`
  return i.detail ? `${name}: ${i.detail}` : name
}
function factLabel(key: string): string {
  const k = `findings.explain.fact.${key}`
  return te(k) ? t(k) : key
}
function factValue(f: ExplainFact): string {
  if (f.value === null || f.value === '') return t('findings.explain.empty')
  if (typeof f.value === 'boolean') return t(f.value ? 'findings.explain.yes' : 'findings.explain.no')
  if (typeof f.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.value)) return dateDe(f.value)
  return String(f.value)
}
</script>

<template>
  <div v-if="ex" data-testid="finding-explain" class="mt-2">
    <v-btn
      size="small"
      variant="text"
      density="comfortable"
      data-testid="finding-explain-toggle"
      :prepend-icon="open ? 'mdi-chevron-down' : 'mdi-chevron-right'"
      :text="t('findings.explain.toggle')"
      :aria-expanded="open"
      @click="open = !open"
    />
    <div v-if="open" class="explain-body text-body-2 pa-3 mt-1" data-testid="finding-explain-body">
      <div class="font-weight-medium">{{ t('findings.explain.rule', { id: finding.ruleId, version: ex.ruleVersion }) }}</div>
      <div class="text-medium-emphasis">
        {{
          ex.packName
            ? t('findings.explain.pack', { name: ex.packName, version: ex.packVersion ?? '?' })
            : t('findings.explain.packUnknown')
        }}
      </div>
      <div class="text-medium-emphasis">{{ validity }}, {{ t('findings.explain.checkedFor', { date: dateDe(ex.evaluatedFor) }) }}</div>
      <div class="text-caption text-medium-emphasis">{{ t('findings.explain.checkedAt', { at: dateTimeDe(ex.evaluatedAt) }) }}</div>
      <div class="mt-2">
        <span class="font-weight-medium">{{ t('findings.explain.severityTitle') }}:</span>
        {{ severityText }}
        <span class="text-medium-emphasis">({{ t('findings.explain.confidence', { confidence: t(`confidence.${finding.confidence}`) }) }})</span>
      </div>

      <div class="font-weight-medium mt-2">{{ t('findings.explain.inputsTitle') }}</div>
      <div v-if="ex.inputs.length" class="d-flex flex-wrap ga-1 mt-1" data-testid="finding-explain-inputs">
        <v-chip
          v-for="i in ex.inputs"
          :key="i.key"
          size="small"
          label
          :variant="i.state === 'used' ? 'tonal' : 'outlined'"
          :color="i.state === 'used' ? 'success' : undefined"
          :class="{ 'text-medium-emphasis': i.state === 'missing' }"
          :prepend-icon="i.state === 'used' ? 'mdi-check' : 'mdi-minus-circle-outline'"
          :data-state="i.state"
        >
          {{ inputText(i) }}
        </v-chip>
      </div>
      <div v-else class="text-medium-emphasis">{{ t('findings.explain.inputsNone') }}</div>

      <div class="font-weight-medium mt-2">{{ t('findings.explain.factsTitle') }}</div>
      <table v-if="ex.facts.length" class="explain-facts mt-1" data-testid="finding-explain-facts">
        <tbody>
          <tr v-for="f in ex.facts" :key="f.key">
            <th class="text-left font-weight-regular text-medium-emphasis pr-4">{{ factLabel(f.key) }}</th>
            <td>
              {{ factValue(f) }}
              <v-chip v-if="f.red" size="x-small" label color="warning" variant="tonal" class="ml-1" :title="t('findings.explain.redHint')">
                {{ t('findings.explain.redBadge') }}
              </v-chip>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="text-medium-emphasis">{{ t('findings.explain.factsNone') }}</div>
    </div>
  </div>
</template>

<style scoped>
.explain-body {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 6px;
}
.explain-facts {
  border-collapse: collapse;
}
.explain-facts th,
.explain-facts td {
  padding: 2px 0;
  vertical-align: top;
}
</style>
