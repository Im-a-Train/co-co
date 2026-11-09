<script setup lang="ts">
/** /regeln: rule catalogue of all bundled packs. */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import RuleCard from '@/components/rules/RuleCard.vue'
import RuleEditDialog from '@/components/rules/RuleEditDialog.vue'
import { useRuleEdits } from '@/composables/useRuleEdits'
import { loadEffectivePacks } from '@/domain/rules/editsStore'
import { useRuleState } from '@/composables/useRuleState'
import { campsWithDisabled, isGloballyDisabled } from '@/domain/rules/ruleState'
import { disableRuleStored, enableRuleStored } from '@/domain/rules/ruleStateStore'
import { modulesOf } from '@/domain/rules/packs'
import type { ModuleId, Rule, RuleMeta, RulePack, Severity } from '@/domain/types'

const { t } = useI18n()
const { state: ruleState } = useRuleState()
const stateError = ref<string | null>(null)

/** Disabled state of one rule: everywhere, and in how many camps. */
function disabledInfo(meta: RuleMeta) {
  const former = meta.formerIds ?? []
  const all = isGloballyDisabled(ruleState.value, meta.id, former)
  const camps = campsWithDisabled(ruleState.value, meta.id, former)
  return { all, camps, any: all || camps > 0 }
}
async function toggle(meta: RuleMeta, action: 'enable' | 'disableAll') {
  try {
    if (action === 'enable') await enableRuleStored(meta.id, undefined, meta.formerIds ?? [])
    else await disableRuleStored(meta.id, null, meta.formerIds ?? [])
    stateError.value = null
  } catch (e) {
    stateError.value = e instanceof Error ? e.message : String(e)
  }
}

const SEVERITY_COLOR: Record<Severity, string> = { must: 'error', should: 'warning', hint: 'info' }

const route = useRoute()
const ruleEdits = useRuleEdits()
const loadError = ref<string | null>(null)
/** Effective packs (bundled + coach edits); recomputed when an edit is saved or reset. */
const packs = computed<RulePack[]>(() => {
  void ruleEdits.version.value
  try {
    return loadEffectivePacks()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
    return []
  }
})
const editedIds = computed(() => new Set(ruleEdits.edits().map((e) => e.ruleId)))
const editTarget = ref<string | null>(null)
const editOpen = ref(false)
const editTab = ref<'edit' | 'changes'>('edit')
function openEdit(id: string, tab: 'edit' | 'changes' = 'edit') {
  editTarget.value = id
  editTab.value = tab
  editOpen.value = true
}

/** `?rule=<id>`: expand and scroll to one rule (the Hilfsmittel view links here). */
const openRule = ref<string | undefined>(undefined)
async function focusRule(id: string) {
  const rule = packs.value.flatMap((p) => p.rules).find((r) => r.meta.id === id || r.meta.formerIds?.includes(id))
  if (!rule) return
  search.value = ''
  group.value = 'all'
  openRule.value = rule.meta.id
  await nextTick()
  setTimeout(() => document.getElementById(`rule-${rule.meta.id}`)?.scrollIntoView({ block: 'center' }), 150)
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

watch(
  () => [route.query.rule, packs.value.length] as const,
  ([id]) => {
    if (typeof id === 'string' && id) void focusRule(id)
  },
  { immediate: true },
)

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
          <v-expansion-panels variant="accordion" density="compact" :model-value="openRule" @update:model-value="openRule = $event as string | undefined">
            <v-expansion-panel
              v-for="rule in entry.rules"
              :id="`rule-${rule.meta.id}`"
              :key="rule.meta.id"
              :value="rule.meta.id"
              :class="{ 'opacity-60': rule.meta.status === 'retired' }"
              :data-testid="rule.meta.status === 'retired' ? 'rule-retired' : undefined"
            >
              <v-expansion-panel-title>
                <div class="d-flex align-center ga-3 flex-grow-1">
                  <v-chip size="x-small" label :color="SEVERITY_COLOR[rule.meta.severity]" variant="flat" class="flex-shrink-0">
                    {{ t(`severity.${rule.meta.severity}`) }}
                  </v-chip>
                  <code class="text-caption flex-shrink-0">{{ rule.meta.id }}</code>
                  <span class="text-body-2" :class="{ 'text-decoration-line-through text-medium-emphasis': disabledInfo(rule.meta).all }">{{ rule.meta.title }}</span>
                  <v-chip v-if="rule.meta.status === 'retired'" size="x-small" color="grey" label>{{ t('rules.status.retired') }}</v-chip>
                  <v-chip v-if="editedIds.has(rule.meta.id)" size="x-small" color="warning" label :title="t('rules.edit.chipTitle')" data-testid="rule-edited">
                    {{ t('rules.edit.chip') }}
                  </v-chip>
                  <v-chip v-if="disabledInfo(rule.meta).all" size="x-small" color="grey" label data-testid="rule-disabled">
                    {{ t('rules.catalog.state.disabledAll') }}
                  </v-chip>
                  <v-chip v-else-if="disabledInfo(rule.meta).camps" size="x-small" color="grey" label data-testid="rule-disabled">
                    {{ t('rules.catalog.state.disabledCamps', { count: disabledInfo(rule.meta).camps }, disabledInfo(rule.meta).camps) }}
                  </v-chip>
                </div>
              </v-expansion-panel-title>
              <v-expansion-panel-text>
                <div class="mb-3 d-flex flex-wrap ga-2">
                  <v-btn size="small" variant="tonal" prepend-icon="mdi-pencil" :text="t('rules.edit.button')" data-testid="rule-edit-open" @click="openEdit(rule.meta.id)" />
                  <v-btn
                    v-if="editedIds.has(rule.meta.id)"
                    size="small"
                    variant="text"
                    prepend-icon="mdi-compare"
                    :text="t('rules.edit.viewChanges')"
                    data-testid="rule-edit-changes"
                    @click="openEdit(rule.meta.id, 'changes')"
                  />
                  <v-btn
                    v-if="disabledInfo(rule.meta).any"
                    size="small"
                    variant="tonal"
                    prepend-icon="mdi-check-circle-outline"
                    :text="t('rules.catalog.state.enable')"
                    data-testid="rule-enable"
                    @click="toggle(rule.meta, 'enable')"
                  />
                  <v-btn
                    v-else
                    size="small"
                    variant="text"
                    prepend-icon="mdi-cancel"
                    :text="t('rules.catalog.state.disableAll')"
                    @click="toggle(rule.meta, 'disableAll')"
                  />
                </div>
                <RuleCard :rule="rule" />
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </section>
      </v-card-text>
    </v-card>

    <RuleEditDialog v-model="editOpen" :rule-id="editTarget" :initial-tab="editTab" />
  </div>
</template>

<style scoped>
.search-field {
  max-width: 22rem;
  min-width: 14rem;
}
</style>
