<script setup lang="ts">
/** /regeln: rule catalogue of all bundled packs. */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import RuleCard from '@/components/rules/RuleCard.vue'
import { useRuleState } from '@/composables/useRuleState'
import { campsWithDisabled, isGloballyDisabled } from '@/domain/rules/ruleState'
import { disableRuleStored, enableRuleStored } from '@/domain/rules/ruleStateStore'
import { loadBundledPacks, modulesOf } from '@/domain/rules/packs'
import type { ModuleId, Rule, RulePack, Severity } from '@/domain/types'

const { t } = useI18n()
const { state: ruleState } = useRuleState()
const stateError = ref<string | null>(null)

/** Disabled state of one rule: everywhere, and in how many camps. */
function disabledInfo(ruleId: string) {
  const all = isGloballyDisabled(ruleState.value, ruleId)
  const camps = campsWithDisabled(ruleState.value, ruleId)
  return { all, camps, any: all || camps > 0 }
}
async function toggle(ruleId: string, action: 'enable' | 'disableAll') {
  try {
    if (action === 'enable') await enableRuleStored(ruleId)
    else await disableRuleStored(ruleId, null)
    stateError.value = null
  } catch (e) {
    stateError.value = e instanceof Error ? e.message : String(e)
  }
}

const SEVERITY_COLOR: Record<Severity, string> = { must: 'error', should: 'warning', hint: 'info' }

const packs = ref<RulePack[]>([])
const loadError = ref<string | null>(null)
try {
  packs.value = loadBundledPacks()
} catch (e) {
  loadError.value = e instanceof Error ? e.message : String(e)
}

const search = ref('')
const group = ref<ModuleId | 'all'>('all')
/** Filter options: the modules of the loaded packs (catalog v2). */
const GROUPS = computed<ModuleId[]>(() => modulesOf(packs.value).map((m) => m.id))

function matches(rule: Rule, query: string): boolean {
  if (!query) return true
  const m = rule.meta
  const hay = [m.id, m.title, m.description, m.message, ...(m.tags ?? [])].join(' ').toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word))
}

const visible = computed(() =>
  packs.value.map((pack) => ({
    pack,
    byGroup: GROUPS.value.filter((g) => group.value === 'all' || group.value === g)
      .map((g) => ({
        group: g,
        rules: pack.rules.filter((r) => r.meta.module === g && matches(r, search.value)),
      }))
      .filter((entry) => entry.rules.length > 0),
  })),
)
const hasResults = computed(() => visible.value.some((v) => v.byGroup.length > 0))

function fmt(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}
</script>

<template>
  <div>
    <h1 class="text-h5 mb-1">{{ t('rules.catalog.title') }}</h1>
    <p class="text-body-2 text-medium-emphasis mb-4">{{ t('rules.catalog.intro') }}</p>

    <v-alert v-if="loadError" type="error" variant="tonal" density="compact" class="mb-4">
      {{ t('rules.catalog.loadFailed') }}: {{ loadError }}
    </v-alert>

    <v-alert v-if="stateError" type="error" variant="tonal" density="compact" class="mb-4" :text="stateError" />

    <div class="d-flex flex-wrap align-center ga-3 mb-4">
      <v-text-field
        v-model="search"
        :label="t('rules.catalog.search')"
        prepend-inner-icon="mdi-magnify"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        class="search-field"
      />
      <v-chip-group v-model="group" mandatory selected-class="text-primary">
        <v-chip value="all" size="small" filter>{{ t('rules.catalog.allGroups') }}</v-chip>
        <v-chip v-for="g in GROUPS" :key="g" :value="g" size="small" filter>{{ t(`rules.catalog.module.${g}`) }}</v-chip>
      </v-chip-group>
    </div>

    <v-alert v-if="!loadError && !hasResults" type="info" variant="tonal" density="compact" :text="t('rules.catalog.empty')" />

    <v-card v-for="{ pack, byGroup } in visible" :key="pack.id" class="mb-4" variant="outlined">
      <v-card-title class="d-flex flex-wrap align-center ga-2">
        <span>{{ pack.name }}</span>
        <v-chip size="x-small" label variant="tonal">{{ t('rules.catalog.pack.version', { version: pack.version }) }}</v-chip>
        <v-chip v-if="pack.validFrom" size="x-small" label variant="tonal">
          {{ t('rules.catalog.pack.validFrom', { date: fmt(pack.validFrom) }) }}
        </v-chip>
        <v-chip v-if="pack.validTo" size="x-small" label variant="tonal">
          {{ t('rules.catalog.pack.validTo', { date: fmt(pack.validTo) }) }}
        </v-chip>
        <v-chip size="x-small" label variant="tonal">{{ t('rules.catalog.pack.count', { count: pack.rules.length }) }}</v-chip>
      </v-card-title>
      <v-card-subtitle class="text-wrap">{{ pack.description }}</v-card-subtitle>

      <v-card-text>
        <section v-for="entry in byGroup" :key="entry.group" class="mb-4">
          <h2 class="text-subtitle-1 mb-2">{{ t(`rules.catalog.module.${entry.group}`) }}</h2>
          <v-expansion-panels variant="accordion" density="compact">
            <v-expansion-panel v-for="rule in entry.rules" :key="rule.meta.id">
              <v-expansion-panel-title>
                <div class="d-flex align-center ga-3 flex-grow-1">
                  <v-chip size="x-small" label :color="SEVERITY_COLOR[rule.meta.severity]" variant="flat" class="flex-shrink-0">
                    {{ t(`severity.${rule.meta.severity}`) }}
                  </v-chip>
                  <code class="text-caption flex-shrink-0">{{ rule.meta.id }}</code>
                  <span class="text-body-2" :class="{ 'text-decoration-line-through text-medium-emphasis': disabledInfo(rule.meta.id).all }">{{ rule.meta.title }}</span>
                  <v-chip v-if="disabledInfo(rule.meta.id).all" size="x-small" color="grey" label data-testid="rule-disabled">
                    {{ t('rules.catalog.state.disabledAll') }}
                  </v-chip>
                  <v-chip v-else-if="disabledInfo(rule.meta.id).camps" size="x-small" color="grey" label data-testid="rule-disabled">
                    {{ t('rules.catalog.state.disabledCamps', { count: disabledInfo(rule.meta.id).camps }, disabledInfo(rule.meta.id).camps) }}
                  </v-chip>
                </div>
              </v-expansion-panel-title>
              <v-expansion-panel-text>
                <div class="mb-3">
                  <v-btn
                    v-if="disabledInfo(rule.meta.id).any"
                    size="small"
                    variant="tonal"
                    prepend-icon="mdi-check-circle-outline"
                    :text="t('rules.catalog.state.enable')"
                    data-testid="rule-enable"
                    @click="toggle(rule.meta.id, 'enable')"
                  />
                  <v-btn
                    v-else
                    size="small"
                    variant="text"
                    prepend-icon="mdi-cancel"
                    :text="t('rules.catalog.state.disableAll')"
                    @click="toggle(rule.meta.id, 'disableAll')"
                  />
                </div>
                <RuleCard :rule="rule" />
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </section>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.search-field {
  max-width: 22rem;
  min-width: 14rem;
}
</style>
