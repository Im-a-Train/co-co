<script setup lang="ts">
/** Details of one rule inside the catalogue (severity, confidence, validity, inputs, source). */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Rule, Severity } from '@/domain/types'

const props = defineProps<{ rule: Rule }>()
const { t } = useI18n()

const SEVERITY_COLOR: Record<Severity, string> = { must: 'error', should: 'warning', hint: 'info' }

const meta = computed(() => props.rule.meta)
const guarded = computed(() => meta.value.confidence === 'unverified' || meta.value.confidence === 'conflict')

function fmt(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}
</script>

<template>
  <div class="rule-card">
    <div class="d-flex flex-wrap ga-2 mb-3">
      <v-chip size="small" label :color="SEVERITY_COLOR[meta.severity]" variant="flat">{{ t(`severity.${meta.severity}`) }}</v-chip>
      <v-chip size="small" label variant="tonal">{{ t(`confidence.${meta.confidence}`) }}</v-chip>
      <v-chip size="small" label variant="outlined">{{ t(`rules.catalog.scope.${meta.scope}`) }}</v-chip>
      <v-chip v-for="input in meta.inputs ?? []" :key="input" size="small" label variant="outlined" prepend-icon="mdi-database-outline">
        {{ t(`rules.catalog.input.${input}`) }}
      </v-chip>
    </div>

    <p class="text-body-2 mb-3">{{ meta.description }}</p>

    <v-table density="compact" class="rule-meta">
      <tbody>
        <tr>
          <th scope="row">{{ t('rules.catalog.card.message') }}</th>
          <td class="text-medium-emphasis">{{ meta.message }}</td>
        </tr>
        <tr>
          <th scope="row">{{ t('rules.catalog.card.validity') }}</th>
          <td>
            <template v-if="meta.validFrom || meta.validTo">
              <span v-if="meta.validFrom">{{ t('rules.catalog.card.validFrom', { date: fmt(meta.validFrom) }) }}</span>
              <span v-if="meta.validFrom && meta.validTo">, </span>
              <span v-if="meta.validTo">{{ t('rules.catalog.card.validTo', { date: fmt(meta.validTo) }) }}</span>
            </template>
            <template v-else>{{ t('rules.catalog.card.always') }}</template>
          </td>
        </tr>
        <tr>
          <th scope="row">{{ t('rules.catalog.card.source') }}</th>
          <td>
            <a :href="meta.source.url" target="_blank" rel="noopener noreferrer">{{ meta.source.title }}</a>
          </td>
        </tr>
        <tr v-if="meta.tags?.length">
          <th scope="row">{{ t('rules.catalog.card.tags') }}</th>
          <td>{{ meta.tags.join(', ') }}</td>
        </tr>
      </tbody>
    </v-table>

    <div class="text-caption text-medium-emphasis mt-2">
      {{ t('rules.catalog.card.version', { version: meta.version }) }}
      <span v-if="guarded"> · {{ t('rules.catalog.card.mustGuard') }}</span>
    </div>
  </div>
</template>

<style scoped>
.rule-meta th {
  width: 9rem;
  font-weight: 500;
  vertical-align: top;
}
.rule-meta td {
  white-space: normal;
}
</style>
