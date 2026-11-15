<script setup lang="ts">
/** /lager/:campId/raster: Lagertag-Rechner week grid + mapping card + activity details drawer. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { campIdFromIri } from '@/domain/iri'
import { formatIsoDate } from '@/components/camps/campRows'
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

const route = useRoute()
const excludedAll = computed(() => findingsHandle.categoryExclusions.value.filter((e) => e.ruleId === null))
const grid = computed(() => {
  if (!facts.value) return null
  const preview = !settings.mappingConfirmed.value && !!findingsHandle.previewJsDays.value
  return buildGrid(facts.value, settings.classOf, preview ? findingsHandle.previewJsDays.value : findingsHandle.jsDays.value, {
    preview,
    // Findings only exist with a confirmed mapping (the preview never shows findings).
    findings: preview ? [] : findingsHandle.findings.value,
    isExcluded: (_activityIri, categoryIri) => !!categoryIri && excludedAll.value.some((e) => e.categoryIri === categoryIri),
  })
})
const selected = ref<Iri | null>(null)
const drawer = ref(false)
const error = ref<string | null>(null)

if (typeof route.query.activity === 'string') {
  selected.value = route.query.activity
  drawer.value = true
}

// ---- Day focus (?tag=<dayIri>, from a day finding): no drawer, top of the page, that day outlined ----------------
const focusDays = computed<string[]>(() => {
  const tag = typeof route.query.tag === 'string' ? route.query.tag : null
  if (!tag) return []
  const days = new Set([tag])
  const o = typeof route.query.vonBefund === 'string' ? route.query.vonBefund : null
  const f = o ? findingsHandle.findings.value.find((x) => x.id === o) : null
  const known = new Set(facts.value?.days.map((d) => d.iri) ?? [])
  // JS-DAY-04 targets both end days: outline both.
  for (const target of f?.targets ?? []) if (known.has(target)) days.add(target)
  return [...days]
})
function scrollToTop() {
  window.scrollTo?.({ top: 0 })
}
onMounted(() => {
  if (route.query.tag) scrollToTop()
})
watch(
  () => route.query.tag,
  (v) => {
    if (v) {
      drawer.value = false
      scrollToTop()
    }
  },
)

function openDayFinding(findingId: string) {
  void router.push(triageLocation(campIri.value, findingId))
}

// ---- Mapping card: expanded first card while unconfirmed; one line afterwards (?zuordnung=1 expands it) ---------
const confirmedMapping = settings.mappingConfirmed
const editing = ref(!!route.query.zuordnung)
const justConfirmed = ref(false)
const pendingChange = ref(false)
const mappingOpen = computed(() => !confirmedMapping.value || editing.value)
const confirmedDate = computed(() => formatIsoDate(settings.mapping.value?.confirmedAt))
watch(
  () => route.query.zuordnung,
  (v) => {
    if (v) editing.value = true
  },
)
function onConfirmed() {
  editing.value = false
  justConfirmed.value = true
}
function goToFindings() {
  void router.push({ name: 'camp-findings', params: { campId: campIdFromIri(campIri.value) } })
}

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

function openFinding(f: Finding) {
  void router.push(triageLocation(campIri.value, f.id))
}

// Activities in chronological order (first block), for ←/→ and the prev / next buttons of the drawer.
const stepOrder = computed<Iri[]>(() => {
  const seen = new Set<Iri>()
  const out: Iri[] = []
  const entries = [...(facts.value?.scheduleEntries ?? [])].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  for (const e of entries) {
    if (seen.has(e.activityIri)) continue
    seen.add(e.activityIri)
    out.push(e.activityIri)
  }
  return out
})

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
    <v-card
      v-if="facts"
      variant="outlined"
      class="mb-4 mapping-card"
      :class="{ 'mapping-card-open': !confirmedMapping }"
      data-testid="grid-mapping-panel"
    >
      <div v-if="confirmedMapping" class="d-flex align-center flex-wrap ga-3 px-4 py-2" data-testid="grid-mapping-line">
        <v-icon :icon="pendingChange ? 'mdi-alert-circle-outline' : 'mdi-check-circle'" :color="pendingChange ? 'warning' : 'success'" size="small" />
        <span data-testid="mapping-confirmed">
          {{ pendingChange ? t('camps.mapping.dirtyTitle') : t('cockpit.grid.mappingDone', { date: confirmedDate }) }}
        </span>
        <v-btn
          variant="text"
          size="small"
          :text="editing ? t('cockpit.grid.mappingClose') : t('cockpit.grid.mappingEdit')"
          data-testid="grid-mapping-edit"
          @click="editing = !editing"
        />
        <v-spacer />
        <v-btn
          v-if="justConfirmed && !pendingChange"
          color="primary"
          variant="flat"
          append-icon="mdi-arrow-right"
          :text="t('camps.mapping.next')"
          data-testid="mapping-next"
          @click="goToFindings"
        />
      </div>
      <v-card-title v-else class="text-h6">
        <v-icon icon="mdi-shape-outline" class="mr-2" />{{ t('cockpit.grid.mappingTitle') }}
      </v-card-title>
      <div v-show="mappingOpen" :class="confirmedMapping ? 'px-4 pb-4 pt-2' : 'px-4 pb-4'">
        <CategoryMappingPanel :findings-handle="findingsHandle" @confirmed="onConfirmed" @dirty="pendingChange = $event" />
      </div>
    </v-card>

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
    <WeekGrid
      v-else
      :grid="grid"
      :selected="selected"
      :focus-days="focusDays"
      :sticky-offset="origin ? 64 : 0"
      @select="select"
      @open-finding="openDayFinding"
    />

    <ActivityDrawer
      v-model="drawer"
      :activity-iri="selected"
      :camp-iri="campIri"
      :facts="facts"
      :findings="findingsHandle.findings.value"
      :class-of="settings.classOf"
      :origin="originContext"
      :order="stepOrder"
      step-keys="horizontal"
      @select="select"
      @back-to-finding="backToFinding"
      @open-finding="openFinding"
      @show-findings="showFindings"
      @open-document="openDocument"
      @ai-findings="addAi"
    />
  </div>
</template>

<style scoped>
.mapping-card-open {
  border-color: rgb(var(--v-theme-warning));
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
