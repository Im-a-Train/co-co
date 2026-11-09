<script setup lang="ts">
/**
 * Central search in the camp header: activities (eCamp content) + stored documents, side-effect free
 * (reads IndexedDB and cached CampFacts only; no ingestion, no folder watching). Selecting a hit jumps to it.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampRoute } from '@/composables/useCampRoute'
import { buildSearchIndex, type CampSearchIndex, type SearchHit } from '@/domain/documents'
import { listDocuments } from '@/domain/documents/store'
import { groupHits, highlightParts } from './campSearch'

const { t } = useI18n()
const router = useRouter()
const { campId, campIri } = useCampRoute()
const { facts } = useCampFacts(campIri)

const field = ref<{ focus: () => void; $el: HTMLElement } | null>(null)
const root = ref<HTMLElement | null>(null)
const query = ref('')
const open = ref(false)
const active = ref(0)
const hits = ref<SearchHit[]>([])
const docs = ref<Awaited<ReturnType<typeof listDocuments>>>([])
let index: CampSearchIndex | null = null
let timer: ReturnType<typeof setTimeout> | undefined

const groups = computed(() => groupHits(hits.value))
/** Flat list in display order, for keyboard navigation. */
const flat = computed(() => groups.value.flatMap((g) => g.hits))
const hasQuery = computed(() => query.value.trim().length > 0)

async function refreshDocs() {
  try {
    docs.value = await listDocuments(campIri.value)
  } catch {
    docs.value = []
  }
  index = null
  run()
}

function run() {
  const q = query.value.trim()
  if (!q) {
    hits.value = []
    return
  }
  index ??= buildSearchIndex(docs.value, facts.value)
  hits.value = index.search(q)
  active.value = 0
}

watch(query, () => {
  open.value = true
  clearTimeout(timer)
  timer = setTimeout(run, 150)
})
watch([campIri, facts], () => {
  index = null
  docs.value = campIri.value ? docs.value : []
  if (hasQuery.value) run()
})

function onFocus() {
  open.value = true
  void refreshDocs()
}

function select(h: SearchHit) {
  open.value = false
  if (h.documentId) {
    void router.push({ name: 'camp-documents', params: { campId: campId.value }, query: { doc: h.documentId } })
  } else if (h.activityIri) {
    void router.push({ name: 'camp-activities', params: { campId: campId.value }, query: { activity: h.activityIri } })
  }
  query.value = ''
  hits.value = []
  ;(document.activeElement as HTMLElement | null)?.blur()
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    open.value = false
    ;(e.target as HTMLElement).blur()
  } else if (e.key === 'ArrowDown' && flat.value.length) {
    e.preventDefault()
    open.value = true
    active.value = (active.value + 1) % flat.value.length
  } else if (e.key === 'ArrowUp' && flat.value.length) {
    e.preventDefault()
    active.value = (active.value - 1 + flat.value.length) % flat.value.length
  } else if (e.key === 'Enter') {
    const h = flat.value[active.value]
    if (h) {
      e.preventDefault()
      select(h)
    }
  }
}

function onGlobalKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'f')) {
    e.preventDefault()
    field.value?.focus()
  }
}
function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => {
  window.addEventListener('keydown', onGlobalKey)
  document.addEventListener('mousedown', onDocClick)
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  window.removeEventListener('keydown', onGlobalKey)
  document.removeEventListener('mousedown', onDocClick)
})

const showPanel = computed(() => open.value && hasQuery.value)
const groupTitle = (kind: 'activity' | 'document') => t(kind === 'activity' ? 'search.groupActivity' : 'search.groupDocument')
const offset = (gi: number) => groups.value.slice(0, gi).reduce((n, g) => n + g.hits.length, 0)
</script>

<template>
  <div ref="root" class="camp-search" data-testid="camp-search">
    <v-text-field
      ref="field"
      v-model="query"
      :placeholder="t('search.placeholder')"
      :aria-label="t('search.label')"
      prepend-inner-icon="mdi-magnify"
      density="compact"
      variant="solo-filled"
      flat
      hide-details
      clearable
      single-line
      autocomplete="off"
      data-testid="camp-search-input"
      @focus="onFocus"
      @keydown="onKey"
    />
    <v-card v-if="showPanel" class="camp-search-panel" elevation="8" data-testid="camp-search-results" @mousedown.prevent>
      <div v-if="!flat.length" class="pa-3 text-body-2 text-medium-emphasis" data-testid="camp-search-empty">
        {{ t('search.empty') }}
      </div>
      <v-list v-else density="compact" class="py-0">
        <template v-for="(g, gi) in groups" :key="g.kind">
          <v-list-subheader>{{ groupTitle(g.kind) }}</v-list-subheader>
          <v-list-item
            v-for="(h, i) in g.hits"
            :key="h.ref"
            :active="offset(gi) + i === active"
            lines="two"
            data-testid="camp-search-hit"
            :data-kind="h.kind"
            @click="select(h)"
            @mouseenter="active = offset(gi) + i"
          >
            <template #prepend>
              <v-icon :icon="h.kind === 'document' ? 'mdi-file-document-outline' : 'mdi-calendar-text-outline'" size="small" />
            </template>
            <v-list-item-title>
              <template v-for="(p, k) in highlightParts(h.title, query)" :key="k">
                <mark v-if="p.mark">{{ p.text }}</mark>
                <template v-else>{{ p.text }}</template>
              </template>
            </v-list-item-title>
            <v-list-item-subtitle v-if="h.snippet">
              <template v-for="(p, k) in highlightParts(h.snippet, query)" :key="k">
                <mark v-if="p.mark">{{ p.text }}</mark>
                <template v-else>{{ p.text }}</template>
              </template>
            </v-list-item-subtitle>
          </v-list-item>
        </template>
      </v-list>
    </v-card>
  </div>
</template>

<style scoped>
.camp-search {
  position: relative;
  flex: 1 1 280px;
  min-width: 220px;
  max-width: 520px;
}
.camp-search-panel {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  max-height: 70vh;
  overflow-y: auto;
  z-index: 2000;
}
mark {
  background: rgba(255, 193, 7, 0.45);
  color: inherit;
  border-radius: 2px;
}
</style>
