<script setup lang="ts">
/** /fristen: deadlines across camps (NDS, Leihmaterial, Landeskarten, Lagerbewilligung). OWNER: rules builder. */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import DeadlineStatusChip from '@/components/rules/DeadlineStatusChip.vue'
import { listCoachInputs } from '@/domain/campFacts/store'
import { listCampSummaries } from '@/domain/rules/store'
import { computeAllDeadlines, daysBetween, deadlineStatus } from '@/domain/rules/deadlines'
import type { CoachInputs, Iri } from '@/domain/types'
import { useCampList } from '@/composables/useCampList'

const { t } = useI18n()
const { camps, loading, error, load } = useCampList()

const inputsByCamp = ref<Record<Iri, CoachInputs>>({})
const inputsError = ref<string | null>(null)
const showDone = ref(false)
const lastJsByCamp = ref<Record<Iri, string | null>>({})

async function loadInputs() {
  try {
    lastJsByCamp.value = Object.fromEntries((await listCampSummaries()).map((s) => [s.campIri, s.lastJsDate ?? null]))
    inputsByCamp.value = Object.fromEntries((await listCoachInputs()).map((i) => [i.campIri, i]))
    inputsError.value = null
  } catch (e) {
    inputsError.value = e instanceof Error ? e.message : String(e)
  }
}

onMounted(() => {
  void load()
  void loadInputs()
})
watch(camps, () => void loadInputs())

const today = computed(() => new Date().toISOString().slice(0, 10))

const campById = computed(() => new Map(camps.value.map((c) => [c.iri, c])))

const deadlines = computed(() =>
  computeAllDeadlines(
    camps.value.filter((c) => !c.isPrototype).map((c) => ({ iri: c.iri, title: c.title, start: c.start, end: c.end, lastJsDate: lastJsByCamp.value[c.iri] ?? null })),
    inputsByCamp.value,
  ),
)

const rows = computed(() =>
  deadlines.value
    .filter((d) => showDone.value || !d.done)
    .map((d) => ({
      ...d,
      campId: campById.value.get(d.campIri)?.id ?? d.campIri.split('/').pop() ?? '',
      status: deadlineStatus(d, today.value),
      left: daysBetween(today.value, d.due),
    })),
)

function fmt(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function relative(left: number): string {
  if (left === 0) return t('rules.deadlines.relative.today')
  if (left === 1) return t('rules.deadlines.relative.inOne')
  if (left === -1) return t('rules.deadlines.relative.agoOne')
  return left > 0 ? t('rules.deadlines.relative.in', { n: left }) : t('rules.deadlines.relative.ago', { n: -left })
}
</script>

<template>
  <div>
    <h1 class="text-h5 mb-1">{{ t('rules.deadlines.title') }}</h1>
    <p class="text-body-2 text-medium-emphasis mb-4">{{ t('rules.deadlines.intro') }}</p>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">
      {{ t('rules.deadlines.loadFailed') }}: {{ error }}
    </v-alert>

    <div class="d-flex align-center mb-2">
      <v-switch v-model="showDone" :label="t('rules.deadlines.showDone')" density="compact" hide-details color="primary" />
      <v-spacer />
      <v-progress-circular v-if="loading" indeterminate size="20" width="2" />
    </div>

    <v-alert
      v-if="!loading && !error && rows.length === 0"
      type="info"
      variant="tonal"
      density="compact"
      :text="t('rules.deadlines.empty')"
    />

    <v-card v-else-if="rows.length" variant="outlined">
      <v-table density="compact">
        <thead>
          <tr>
            <th>{{ t('rules.deadlines.columns.due') }}</th>
            <th>{{ t('rules.deadlines.columns.camp') }}</th>
            <th>{{ t('rules.deadlines.columns.kind') }}</th>
            <th>{{ t('rules.deadlines.columns.status') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="`${row.campIri}:${row.kind}`">
            <td class="text-no-wrap">
              {{ fmt(row.due) }}
              <div class="text-caption text-medium-emphasis">{{ relative(row.left) }}</div>
            </td>
            <td>
              <RouterLink :to="`/lager/${row.campId}/angaben`" :title="t('rules.deadlines.openCamp')">{{ row.campTitle }}</RouterLink>
            </td>
            <td>
              {{ t(`rules.deadlines.kind.${row.kind}`) }}
              <div v-if="row.ruleId" class="text-caption text-medium-emphasis">
                {{ t('rules.deadlines.rule', { id: row.ruleId }) }}
              </div>
            </td>
            <td><DeadlineStatusChip :status="row.status" /></td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </div>
</template>
