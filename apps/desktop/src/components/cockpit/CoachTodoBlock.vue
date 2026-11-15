<script setup lang="ts">
/**
 * «Zuerst für dich (n)»: findings that only report a missing input of the coach. They are never feedback
 * for the leaders; each row leads to the place where the input is given.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { severityColor } from '@/domain/cockpit'
import { campIdFromIri } from '@/domain/iri'
import type { Finding, Iri } from '@/domain/types'

const props = defineProps<{ findings: Finding[]; campIri: Iri }>()
const { t } = useI18n()
const router = useRouter()
const open = ref(true)

function actionKey(f: Finding): 'mapping' | 'inputs' | 'midata' {
  if (f.needsInput === 'mapping') return 'mapping'
  if (f.needsInput === 'midata') return 'midata'
  return 'inputs'
}
function go(f: Finding) {
  const params = { campId: campIdFromIri(props.campIri) }
  const key = actionKey(f)
  if (key === 'mapping') void router.push({ name: 'camp-grid', params, query: { zuordnung: '1' } })
  else if (key === 'midata') void router.push({ name: 'settings', hash: '#midata' })
  else void router.push({ name: 'camp-inputs', params })
}
</script>

<template>
  <v-card v-if="findings.length" variant="outlined" class="mb-3" data-testid="coach-todo">
    <v-card-text class="py-3">
      <div class="d-flex align-center ga-2">
        <div class="text-subtitle-1 font-weight-medium">{{ t('findings.triage.coachTodo.title', { count: findings.length }) }}</div>
        <v-spacer />
        <v-btn
          size="small"
          variant="text"
          density="comfortable"
          :icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'"
          :aria-label="open ? t('findings.triage.coachTodo.collapse') : t('findings.triage.coachTodo.expand')"
          data-testid="coach-todo-toggle"
          @click="open = !open"
        />
      </div>
      <template v-if="open">
        <div class="text-body-2 text-medium-emphasis mb-1">{{ t('findings.triage.coachTodo.hint') }}</div>
        <div
          v-for="f in findings"
          :key="f.id"
          class="coach-todo-row d-flex align-center ga-3 py-1"
          :style="{ borderLeftColor: `rgb(var(--v-theme-${severityColor(f.severity)}))` }"
          :data-finding-id="f.id"
          data-testid="coach-todo-row"
        >
          <div class="flex-grow-1 text-body-2 text-truncate" style="min-width: 0" :title="f.message">
            <span class="font-weight-medium">{{ f.title }}</span>
            <span class="text-medium-emphasis"> · {{ f.message }}</span>
          </div>
          <v-btn
            size="small"
            variant="tonal"
            class="flex-shrink-0"
            :text="t(`findings.triage.coachTodo.${actionKey(f)}`)"
            :data-testid="`coach-todo-${actionKey(f)}`"
            @click="go(f)"
          />
        </div>
      </template>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.coach-todo-row {
  border-left: 4px solid transparent;
  padding-left: 10px;
}
.coach-todo-row + .coach-todo-row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
