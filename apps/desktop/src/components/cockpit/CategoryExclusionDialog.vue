<script setup lang="ts">
/** Dialog: exclude eCamp activity categories from the rule check (all rules, or single rules). Emits intents only. */
import { computed, ref } from 'vue'
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
  exclude: [categoryIri: string, ruleId: string | null]
  include: [categoryIri: string, ruleId: string | null]
}>()
const { t } = useI18n()

const newRule = ref<string | null>(null)
const newCategory = ref<string | null>(null)

const allExcluded = computed(() => new Set(props.exclusions.filter((e) => e.ruleId === null).map((e) => e.categoryIri)))
const perRule = computed(() => props.exclusions.filter((e) => e.ruleId !== null))
const categoryOf = (iri: string) => props.categories.find((c) => c.iri === iri)
const nameOf = (iri: string) => {
  const c = categoryOf(iri)
  return c ? `${c.short} ${c.name}`.trim() : iri
}
const ruleItems = computed(() => props.rules.map((r) => ({ title: `${r.id} · ${r.title}`, value: r.id })))
const categoryItems = computed(() => props.categories.map((c) => ({ title: `${c.short} ${c.name}`.trim(), value: c.iri })))

function toggleAll(iri: string, on: boolean | null) {
  if (on) emit('exclude', iri, null)
  else emit('include', iri, null)
}
function addPerRule() {
  if (!newRule.value || !newCategory.value) return
  emit('exclude', newCategory.value, newRule.value)
  newRule.value = null
  newCategory.value = null
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="640" scrollable @update:model-value="emit('update:modelValue', $event)">
    <v-card :title="t('findings.categoryExclusion.title')" data-testid="category-exclusion-dialog">
      <v-card-text>
        <p class="text-body-2 mb-3">{{ t('findings.categoryExclusion.intro') }}</p>

        <div v-if="!categories.length" class="text-body-2 text-medium-emphasis">{{ t('findings.categoryExclusion.noCategories') }}</div>
        <div v-for="c in categories" :key="c.iri" class="d-flex align-center ga-2" data-testid="category-row">
          <span class="category-dot" :style="{ background: c.color }" />
          <span class="text-body-2 flex-grow-1">
            <strong>{{ c.short }}</strong> {{ c.name }}
          </span>
          <v-checkbox
            :model-value="allExcluded.has(c.iri)"
            :label="t('findings.categoryExclusion.allRules')"
            density="compact"
            hide-details
            color="primary"
            :data-testid="`exclude-all-${c.short}`"
            @update:model-value="toggleAll(c.iri, $event)"
          />
        </div>

        <h3 class="text-subtitle-1 mt-4 mb-1">{{ t('findings.categoryExclusion.perRuleTitle') }}</h3>
        <div v-if="!perRule.length" class="text-body-2 text-medium-emphasis">{{ t('findings.categoryExclusion.perRuleNone') }}</div>
        <v-list v-else density="compact" data-testid="per-rule-list">
          <v-list-item
            v-for="e in perRule"
            :key="`${e.categoryIri}|${e.ruleId}`"
            :title="t('findings.categoryExclusion.ruleLabel', { category: nameOf(e.categoryIri), ruleId: e.ruleId })"
          >
            <template #append>
              <v-btn
                size="small"
                variant="text"
                icon="mdi-close"
                :aria-label="t('findings.categoryExclusion.remove')"
                @click="emit('include', e.categoryIri, e.ruleId)"
              />
            </template>
          </v-list-item>
        </v-list>

        <div class="text-subtitle-2 mt-3 mb-2">{{ t('findings.categoryExclusion.addTitle') }}</div>
        <div class="d-flex flex-wrap align-center ga-2">
          <v-select
            v-model="newRule"
            :items="ruleItems"
            :label="t('findings.categoryExclusion.rule')"
            density="compact"
            variant="outlined"
            hide-details
            style="min-width: 220px; flex: 1 1 220px"
          />
          <v-select
            v-model="newCategory"
            :items="categoryItems"
            :label="t('findings.categoryExclusion.category')"
            density="compact"
            variant="outlined"
            hide-details
            style="min-width: 180px; flex: 1 1 180px"
          />
          <v-btn
            variant="tonal"
            :disabled="!newRule || !newCategory"
            :text="t('findings.categoryExclusion.add')"
            @click="addPerRule"
          />
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :text="t('findings.categoryExclusion.close')" @click="emit('update:modelValue', false)" />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.category-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex: 0 0 14px;
}
</style>
