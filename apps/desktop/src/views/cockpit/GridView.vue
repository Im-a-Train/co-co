<script setup lang="ts">
/** /lager/:campId/raster: Lagertag-Rechner week grid + activity details drawer. */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { campIdFromIri } from '@/domain/iri'
import { buildGrid } from '@/domain/cockpit'
import type { Finding, Iri } from '@/domain/types'
import ActivityDrawer from '@/components/cockpit/ActivityDrawer.vue'
import { createFeedbackFromFinding } from '@/components/cockpit/feedbackAction'
import WeekGrid from '@/components/cockpit/WeekGrid.vue'
import { useCockpit } from '@/components/cockpit/useCockpit'

const { t } = useI18n()
const router = useRouter()
const { campIri, factsHandle, settings, findingsHandle } = useCockpit()
const { facts } = factsHandle

const grid = computed(() => (facts.value ? buildGrid(facts.value, settings.classOf, findingsHandle.jsDays.value) : null))
const selected = ref<Iri | null>(null)
const drawer = ref(false)
const error = ref<string | null>(null)

const route = useRoute()
if (typeof route.query.activity === 'string') {
  selected.value = route.query.activity
  drawer.value = true
}

function select(iri: Iri) {
  selected.value = iri
  drawer.value = true
}

async function feedback(f: Finding) {
  error.value = await createFeedbackFromFinding(router, campIri.value, f)
}

function openDocument(documentId: string | null) {
  void router.push({
    name: 'camp-documents',
    params: { campId: campIdFromIri(campIri.value) },
    query: documentId ? { doc: documentId } : {},
  })
}

function addAi(list: Finding[]) {
  findingsHandle.addAiFindings(list)
}

function showFindings(iri: Iri) {
  void router.push({
    name: 'camp-findings',
    params: { campId: campIdFromIri(campIri.value) },
    query: { activity: iri },
  })
}
</script>

<template>
  <div>
    <h1 class="text-h5 mb-1">{{ t('cockpit.grid.title') }}</h1>
    <p class="text-body-2 text-medium-emphasis mb-3">{{ t('cockpit.grid.intro') }}</p>

    <v-alert
      v-if="facts && !settings.mappingConfirmed.value"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-3"
      :text="t('cockpit.grid.mappingHint')"
    />
    <v-alert
      v-if="facts && !findingsHandle.jsDays.value"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-3"
      :text="t('cockpit.grid.calcMissing')"
    />
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-3"
      closable
      :text="t('findings.feedbackFailed', { error })"
      @click:close="error = null"
    />

    <v-alert v-if="!grid" type="info" variant="tonal" density="compact" :text="t('cockpit.waiting')" />
    <v-alert v-else-if="!grid.days.length" type="info" variant="tonal" density="compact" :text="t('cockpit.grid.empty')" />
    <WeekGrid v-else :grid="grid" :selected="selected" @select="select" />

    <ActivityDrawer
      v-model="drawer"
      :activity-iri="selected"
      :camp-iri="campIri"
      :facts="facts"
      :findings="findingsHandle.findings.value"
      :class-of="settings.classOf"
      @feedback="feedback"
      @show-findings="showFindings"
      @open-document="openDocument"
      @ai-findings="addAi"
    />
  </div>
</template>
