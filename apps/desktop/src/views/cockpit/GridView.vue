<script setup lang="ts">
/** /lager/:campId/raster: Lagertag-Rechner week grid + activity details drawer. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { campIdFromIri } from '@/domain/iri'
import { buildGrid } from '@/domain/cockpit'
import type { Finding, Iri } from '@/domain/types'
import ActivityDrawer from '@/components/cockpit/ActivityDrawer.vue'
import { backToFindingLocation, originFromQuery, previousEntryIsOrigin, triageLocation } from '@/domain/triage'
import CategoryMappingPanel from '@/components/cockpit/CategoryMappingPanel.vue'
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

// ---- Mapping section (opened via ?zuordnung=1 or the hint link) -------------------------------------
const mappingPanel = ref<string | undefined>(route.query.zuordnung ? 'mapping' : undefined)
function scrollToMapping() {
  void nextTick(() => {
    document.querySelector('[data-testid="grid-mapping-panel"]')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  })
}
function openMapping() {
  mappingPanel.value = 'mapping'
  scrollToMapping()
}
onMounted(() => {
  if (route.query.zuordnung) setTimeout(scrollToMapping, 300)
})
watch(
  () => route.query.zuordnung,
  (v) => {
    if (v) openMapping()
  },
)

// ---- «Zurück zum Befund» (grid opened from a finding) ----------------------------------------------
const origin = computed(() => originFromQuery(route.query))
const originFinding = computed(() => {
  const o = origin.value
  return o ? (findingsHandle.findings.value.find((f) => f.id === o.findingId) ?? null) : null
})
const originContext = computed(() =>
  originFinding.value ? { ruleId: originFinding.value.ruleId, title: originFinding.value.title } : null,
)

function backToFinding() {
  const o = origin.value
  if (!o) return
  const prev = (window.history.state as { back?: string | null } | null)?.back
  if (previousEntryIsOrigin(prev, campIri.value, o)) router.back()
  else void router.push(backToFindingLocation(campIri.value, o))
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}
function onKey(e: KeyboardEvent) {
  if (!origin.value || e.defaultPrevented || isTyping(e)) return
  const altLeft = e.key === 'ArrowLeft' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey
  const esc = e.key === 'Escape'
  if (!altLeft && !esc) return
  e.preventDefault()
  if (esc && drawer.value) {
    drawer.value = false // first Esc closes the drawer, the next one goes back
    return
  }
  backToFinding()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function select(iri: Iri) {
  selected.value = iri
  drawer.value = true
}

function feedback(f: Finding) {
  void router.push(triageLocation(campIri.value, f.id, { editor: true }))
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
    <div v-if="origin" class="back-to-finding d-flex align-center flex-wrap ga-3 mb-3 pa-2 rounded" data-testid="back-to-finding-bar">
      <v-btn
        color="primary"
        variant="flat"
        prepend-icon="mdi-arrow-left"
        :text="t('findings.backToFinding.button')"
        data-testid="back-to-finding"
        @click="backToFinding"
      />
      <span v-if="originContext" class="text-body-2 text-truncate" data-testid="back-to-finding-context">
        {{ t('findings.backToFinding.context', originContext) }}
      </span>
      <v-spacer />
      <span class="text-caption text-medium-emphasis">{{ t('findings.backToFinding.hint') }}</span>
    </div>
    <h1 class="text-h5 mb-1">{{ t('cockpit.grid.title') }}</h1>
    <p class="text-body-2 text-medium-emphasis mb-3">{{ t('cockpit.grid.intro') }}</p>

    <v-alert
      v-if="facts && !settings.mappingConfirmed.value"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-3"
    >
      {{ t('cockpit.grid.mappingHint') }}
      <a href="#" class="mapping-link" data-testid="grid-mapping-link" @click.prevent="openMapping">
        {{ t('cockpit.grid.mappingCheck') }}
      </a>
    </v-alert>
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

    <v-expansion-panels v-model="mappingPanel" variant="accordion" class="mt-4">
      <v-expansion-panel value="mapping" data-testid="grid-mapping-panel">
        <v-expansion-panel-title>
          <v-icon icon="mdi-shape-outline" class="mr-2" />
          {{ t('cockpit.grid.mappingSection') }}
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <CategoryMappingPanel />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <ActivityDrawer
      v-model="drawer"
      :activity-iri="selected"
      :camp-iri="campIri"
      :facts="facts"
      :findings="findingsHandle.findings.value"
      :class-of="settings.classOf"
      :origin="originContext"
      @back-to-finding="backToFinding"
      @feedback="feedback"
      @show-findings="showFindings"
      @open-document="openDocument"
      @ai-findings="addAi"
    />
  </div>
</template>

<style scoped>
.mapping-link {
  color: inherit;
  font-weight: 600;
  margin-left: 4px;
}
.back-to-finding {
  position: sticky;
  top: calc(var(--v-layout-top, 0px) + 4px);
  z-index: 5;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgb(var(--v-theme-primary));
  box-shadow: 0 2px 6px rgb(0 0 0 / 15%);
}
</style>
