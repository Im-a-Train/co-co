<script setup lang="ts">
/** /lager/:campId/dokumente: documents, watched folders, search, GPX. */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import DocumentDetail from '@/components/documents/DocumentDetail.vue'
import DocumentList from '@/components/documents/DocumentList.vue'
import DocumentSearch from '@/components/documents/DocumentSearch.vue'
import WatchedFolders from '@/components/documents/WatchedFolders.vue'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampRoute } from '@/composables/useCampRoute'
import { useDocuments } from '@/composables/useDocuments'
import { getAppSettings } from '@/domain/storage/settings'
import { DEFAULT_APP_SETTINGS } from '@/domain/types'

const { t } = useI18n()
const { campIri } = useCampRoute()
const { facts, load } = useCampFacts(campIri)
const d = useDocuments(campIri)
const route = useRoute()

const selectedId = ref<string | null>(null)
/** ?doc=<id> (from the activity drawer) selects that document as soon as the list is loaded. */
watch(
  [() => route.query.doc, () => d.documents.value],
  ([id, list]) => {
    if (typeof id === 'string' && Array.isArray(list) && list.some((x) => x.id === id)) selectedId.value = id
  },
  { immediate: true },
)
/** ?page=<n> (deep link from a feedback item) is handed to the viewer together with ?doc. */
const initialAnchor = computed(() => {
  // Only for the linked document: picking another one in the list must not jump it to that page.
  if (typeof route.query.doc !== 'string' || route.query.doc !== selectedId.value) return null
  const n = Number(route.query.page)
  return Number.isInteger(n) && n > 0 ? { page: n } : null
})
/** The list column can be folded away to give the viewer the full width. */
const listCollapsed = ref(false)
const selected = computed(() => d.documents.value.find((x) => x.id === selectedId.value) ?? null)
const gpx = ref({ ...DEFAULT_APP_SETTINGS.gpx })
const activities = computed(() => facts.value?.activities ?? [])

onMounted(async () => {
  try {
    gpx.value = (await getAppSettings()).gpx
  } catch {
    /* defaults */
  }
  if (!facts.value) await load()
})

/** An activity hit selects the first document linked to it, if any. */
function onActivityHit(iri: string) {
  const doc = d.documents.value.find((x) => x.activityIris.includes(iri))
  if (doc) selectedId.value = doc.id
}

function onRemove(id: string) {
  void d.remove(id)
  if (selectedId.value === id) selectedId.value = null
}
</script>

<template>
  <div class="d-flex flex-column ga-4">
    <div>
      <h1 class="text-h5">{{ t('documents.title') }}</h1>
      <p class="text-body-2 text-medium-emphasis">{{ t('documents.intro') }}</p>
    </div>

    <v-card variant="tonal" class="drop-zone">
      <v-card-text class="d-flex flex-column align-center text-center ga-2">
        <v-icon size="40" icon="mdi-tray-arrow-down" />
        <div class="text-subtitle-1">{{ t('documents.drop.title') }}</div>
        <div class="text-body-2">{{ t('documents.drop.hint') }}</div>
        <div class="d-flex ga-2">
          <v-btn color="primary" prepend-icon="mdi-file-plus-outline" :disabled="d.busy.value" @click="d.pickFiles()">
            {{ t('documents.drop.pickFiles') }}
          </v-btn>
          <v-btn variant="outlined" prepend-icon="mdi-folder-eye-outline" :disabled="d.busy.value" @click="d.pickFolder()">
            {{ t('documents.drop.pickFolder') }}
          </v-btn>
        </div>
        <template v-if="d.busy.value">
          <v-progress-linear indeterminate class="mt-2" />
          <div class="text-caption">{{ t('documents.drop.busy') }}</div>
        </template>
      </v-card-text>
    </v-card>

    <v-alert
      v-if="d.error.value"
      type="error"
      variant="tonal"
      closable
      style="white-space: pre-line"
      :text="d.error.value"
      @click:close="d.error.value = null"
    />

    <DocumentSearch :search="d.search" @select-document="selectedId = $event" @select-activity="onActivityHit" />

    <v-row>
      <v-col v-show="!listCollapsed" cols="12" md="4">
        <div class="d-flex flex-column ga-4">
          <v-alert
            v-if="d.pendingLinks.value.length"
            type="info"
            variant="tonal"
            density="compact"
            :text="t('documents.list.pending', { n: d.pendingLinks.value.length })"
          />
          <DocumentList
            :documents="d.documents.value"
            :activities="activities"
            :selected-id="selectedId"
            @select="selectedId = $event"
            @confirm="d.confirmLink"
            @reject="d.rejectSuggestion"
            @unlink="d.unlink"
            @remove="onRemove"
          />
          <WatchedFolders :folders="d.folders.value" @remove="d.removeFolder" @rescan="d.rescan" />
        </div>
      </v-col>
      <v-col cols="12" :md="listCollapsed ? 12 : 8">
        <v-btn
          size="small"
          variant="text"
          class="mb-2 d-none d-md-inline-flex"
          :prepend-icon="listCollapsed ? 'mdi-chevron-right' : 'mdi-chevron-left'"
          data-testid="document-list-toggle"
          @click="listCollapsed = !listCollapsed"
        >
          {{ listCollapsed ? t('documents.list.expand') : t('documents.list.collapse') }}
        </v-btn>
        <DocumentDetail
          :doc="selected"
          :initial-anchor="initialAnchor"
          :facts="facts"
          :pace-default="gpx.paceLkmPerHour"
          :pace-woelfe="gpx.paceWoelfeLkmPerHour"
          :include-descent="gpx.includeDescent"
          @ai-allowed="d.setAiAllowed"
          @summarised="d.setAiSummary"
        />
      </v-col>
    </v-row>
  </div>
</template>

<style scoped>
.drop-zone {
  border: 2px dashed rgb(var(--v-theme-primary));
}
</style>
