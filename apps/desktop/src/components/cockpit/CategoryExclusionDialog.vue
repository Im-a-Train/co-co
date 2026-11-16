<script setup lang="ts">
/**
 * Dialog: the categories that are not checked by a single rule (and, as a safety net, by all rules), each with a
 * remove button. Categories are switched off for all rules in the GP mapping table; adding a rule exclusion happens
 * on the finding itself. Emits intents only.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CategoryExclusion } from '@/domain/rules/ruleState'
import type { CategoryFact } from '@/domain/types'

const props = defineProps<{
  modelValue: boolean
  categories: CategoryFact[]
  exclusions: CategoryExclusion[]
  rules: Array<{ id: string; title: string }>
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  include: [categoryIri: string, ruleId: string | null]
  openGrid: []
}>()
const { t } = useI18n()

const nameOf = (iri: string) => {
  const c = props.categories.find((x) => x.iri === iri)
  return c ? `${c.short} ${c.name}`.trim() : iri
}
const ruleTitle = (id: string) => props.rules.find((r) => r.id === id)?.title ?? id
const rows = computed(() =>
  [...props.exclusions]
    .sort((a, b) => Number(a.ruleId !== null) - Number(b.ruleId !== null))
    .map((e) => ({
      key: `${e.categoryIri}|${e.ruleId ?? ''}`,
      categoryIri: e.categoryIri,
      ruleId: e.ruleId,
      label: e.ruleId
        ? t('findings.categoryExclusion.ruleLabel', { category: nameOf(e.categoryIri), rule: ruleTitle(e.ruleId) })
        : t('findings.categoryExclusion.allRulesLabel', { category: nameOf(e.categoryIri) }),
    })),
)
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="640" scrollable @update:model-value="emit('update:modelValue', $event)">
    <v-card :title="t('findings.categoryExclusion.title')" data-testid="category-exclusion-dialog">
      <v-card-text>
        <p class="text-body-2 mb-3">{{ t('findings.categoryExclusion.intro') }}</p>

        <h3 class="text-subtitle-1 mb-1">{{ t('findings.categoryExclusion.listTitle') }}</h3>
        <div v-if="!rows.length" class="text-body-2 text-medium-emphasis">{{ t('findings.categoryExclusion.listNone') }}</div>
        <v-list v-else density="compact" data-testid="per-rule-list">
          <v-list-item v-for="r in rows" :key="r.key">
            <!-- long rule titles wrap instead of being cut off -->
            <v-list-item-title class="text-wrap">{{ r.label }}</v-list-item-title>
            <template #append>
              <v-btn
                size="small"
                variant="text"
                icon="mdi-close"
                :aria-label="t('findings.categoryExclusion.remove')"
                data-testid="exclusion-remove"
                @click="emit('include', r.categoryIri, r.ruleId)"
              />
            </template>
          </v-list-item>
        </v-list>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="tonal" prepend-icon="mdi-calendar-week" :text="t('findings.categoryExclusion.openGrid')" data-testid="exclusion-open-grid" @click="emit('openGrid')" />
        <v-spacer />
        <v-btn :text="t('findings.categoryExclusion.close')" @click="emit('update:modelValue', false)" />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
