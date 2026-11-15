<script setup lang="ts">
/** /hilfsmittel: reference documents and links the rules cite (ADR 0013). `?key=<KEY>` opens one entry. */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import ResourceEditDialog from '@/components/resources/ResourceEditDialog.vue'
import { useResources, initResources } from '@/composables/useResources'
import { safeExternalUrl } from '@/domain/cockpit'
import { MAX_DOCUMENT_BYTES, detectKind } from '@/domain/documents'
import { extractText } from '@/domain/documents/extract'
import { sha256Hex } from '@/domain/documents/ingest'
import { formatDateDe, highlightSegments, searchResources, sortResourcesByWeight, wordCount, type NewResourceInput, type ResourceCitation, type ResourceHit, type ResourcePatch } from '@/domain/resources'
import { useRuleEdits } from '@/composables/useRuleEdits'
import { loadEffectivePacks } from '@/domain/rules/editsStore'
import { getSourceRegistry } from '@/domain/rules/packs/registry'
import type { ResourceRecord, SourceWeight } from '@/domain/types'
import { base64ToBytes, commands, errorMessage } from '@/lib/tauri'

const { t } = useI18n()
const route = useRoute()
initResources()
const store = useResources()
const ruleEdits = useRuleEdits()

const FILE_FILTERS = [{ name: 'Dokumente', extensions: ['pdf', 'docx', 'txt', 'md'] }]
/** A document attribute is not an alarm: neutral/primary tones only (colour = state). */
const WEIGHT_COLOR: Record<SourceWeight, string | undefined> = { binding: 'primary', 'binding-quote': 'primary', didactic: undefined, outdated: 'grey', pbs: 'secondary', info: undefined }
type WeightFilter = 'all' | 'binding' | 'pbs' | 'other'
const FILTER_OF: Record<SourceWeight, Exclude<WeightFilter, 'all'>> = { binding: 'binding', 'binding-quote': 'binding', pbs: 'pbs', didactic: 'other', info: 'other', outdated: 'other' }

const query = ref('')
const weight = ref<WeightFilter>('all')
/** «Veraltete Unterlagen» group: collapsed unless the coach opens it (or a search / deep link needs it). */
const outdatedOpen = ref(false)
/** Entry highlighted for a moment after a deep link. */
const highlightKey = ref<string | null>(null)
const opened = ref<string[]>([])
const busyKey = ref<string | null>(null)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

// ---- rules citing each resource (bundled packs; keys resolved through formerKeys) -----------
const citedBy = computed(() => {
  void store.version.value
  void ruleEdits.version.value
  const map = new Map<string, ResourceCitation[]>()
  try {
    const reg = getSourceRegistry()
    for (const pack of loadEffectivePacks()) {
      for (const rule of pack.rules) {
        const pages = new Map<string, string[]>()
        for (const s of rule.meta.sources ?? []) {
          const k = reg.get(s.key)?.key ?? s.key
          const list = pages.get(k) ?? []
          if (s.page && !list.includes(s.page)) list.push(s.page)
          pages.set(k, list)
        }
        for (const [k, list] of pages) {
          const arr = map.get(k) ?? []
          arr.push({ id: rule.meta.id, title: rule.meta.title, description: rule.meta.description, ...(list.length ? { page: list.join(', ') } : {}) })
          map.set(k, arr)
        }
      }
    }
  } catch (e) {
    error.value = errorMessage(e)
  }
  return map
})

// ---- list, search, filter ------------------------------------------------------------------
function citationSnippet(c: ResourceCitation): string {
  return c.page ? t('resources.snippetCitedBy', { id: c.id, title: c.title, page: c.page }) : t('resources.snippetCitedByNoPage', { id: c.id, title: c.title })
}
const hits = computed(() => {
  const q = query.value.trim()
  if (!q) return null
  const found: ResourceHit[] = searchResources(store.resources.value, q, { citations: citedBy.value, citationSnippet })
  return new Map(found.map((h, i) => [h.key, { ...h, rank: i }]))
})
const filtered = computed<ResourceRecord[]>(() => {
  let list = store.resources.value.filter((r) => weight.value === 'all' || FILTER_OF[r.weight] === weight.value)
  const h = hits.value
  if (h) list = list.filter((r) => h.has(r.key)).sort((a, b) => h.get(a.key)!.rank - h.get(b.key)!.rank)
  else list = sortResourcesByWeight(list)
  return list
})
/** Current documents first (binding, PBS, didactic, info), outdated ones in their own collapsed group. */
const visible = computed(() => filtered.value.filter((r) => r.weight !== 'outdated'))
const outdated = computed(() => filtered.value.filter((r) => r.weight === 'outdated'))
const outdatedShown = computed(() => outdatedOpen.value || !!query.value.trim() || opened.value.some((k) => outdated.value.some((r) => r.key === k)))
const filtersPresent = computed<Array<Exclude<WeightFilter, 'all'>>>(() => (['binding', 'pbs', 'other'] as const).filter((f) => store.resources.value.some((r) => FILTER_OF[r.weight] === f)))
type Row = { kind: 'item'; r: ResourceRecord } | { kind: 'group' }
const rows = computed<Row[]>(() => {
  const out: Row[] = visible.value.map((r) => ({ kind: 'item', r }))
  if (outdated.value.length) {
    out.push({ kind: 'group' })
    if (outdatedShown.value) for (const r of outdated.value) out.push({ kind: 'item', r })
  }
  return out
})
const noHits = computed(() => store.loaded.value && !!query.value.trim() && !filtered.value.length)

const fmt = formatDateDe
function link(r: ResourceRecord): string | null {
  return safeExternalUrl(r.url)
}
function kb(text: string): string {
  return (new Blob([text]).size / 1024).toFixed(0)
}

// ---- ?key= deep link -------------------------------------------------------------------------
async function openFromRoute() {
  const key = typeof route.query.key === 'string' ? route.query.key : ''
  if (!key || !store.resources.value.length) return
  const rec = store.resources.value.find((r) => r.key === key || r.formerKeys?.includes(key))
  if (!rec) return
  query.value = ''
  weight.value = 'all'
  opened.value = [rec.key]
  if (rec.weight === 'outdated') outdatedOpen.value = true
  await nextTick()
  setTimeout(() => {
    document.getElementById(`res-${rec.key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    highlightKey.value = rec.key
    setTimeout(() => {
      if (highlightKey.value === rec.key) highlightKey.value = null
    }, 2000)
  }, 150)
}
onMounted(() => void openFromRoute())
watch(() => [route.query.key, store.loaded.value], () => void openFromRoute())

// ---- actions ---------------------------------------------------------------------------------
const editOpen = ref(false)
const editing = ref<ResourceRecord | null>(null)
function openEdit(r: ResourceRecord | null) {
  editing.value = r
  editOpen.value = true
}
async function run(key: string | null, fn: () => Promise<unknown>) {
  busyKey.value = key
  error.value = null
  notice.value = null
  try {
    await fn()
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busyKey.value = null
  }
}
async function onSave(p: { key: string; patch: ResourcePatch } | { key: null; input: NewResourceInput }) {
  const key = p.key ?? p.input.key
  await run(key, async () => {
    if (p.key === null) await store.add(p.input)
    else await store.update(p.key, p.patch)
    editOpen.value = false
    if (p.key === null) opened.value = [p.input.key]
  })
}

async function attachFile(r: ResourceRecord) {
  await run(r.key, async () => {
    const paths = await commands.pickFiles(FILE_FILTERS)
    if (!paths.length) return
    const file = await commands.readDocument(paths[0]!)
    const kind = detectKind(file.name)
    if (kind !== 'pdf' && kind !== 'docx' && kind !== 'txt' && kind !== 'md') throw new Error(t('resources.attach.unsupported'))
    if (file.size > MAX_DOCUMENT_BYTES) throw new Error(t('resources.attach.tooBig'))
    const bytes = base64ToBytes(file.bytesBase64)
    const text = await extractText(kind, bytes)
    if (!text.trim()) throw new Error(t('resources.attach.noText'))
    await store.update(r.key, { content: text, fileName: file.name, contentHash: await sha256Hex(bytes) })
    notice.value = t('resources.attach.done', { name: file.name })
  })
}

const pasteFor = ref<ResourceRecord | null>(null)
const pasteText = ref('')
function openPaste(r: ResourceRecord) {
  pasteFor.value = r
  pasteText.value = r.content ?? ''
}
async function savePaste() {
  const r = pasteFor.value
  if (!r) return
  await run(r.key, async () => {
    await store.update(r.key, { content: pasteText.value.trim(), ...(pasteText.value.trim() ? {} : { fileName: '', contentHash: '' }) })
    pasteFor.value = null
  })
}

const confirmFor = ref<ResourceRecord | null>(null)
async function confirmReset() {
  const r = confirmFor.value
  if (!r) return
  await run(r.key, async () => {
    await store.reset(r.key)
    confirmFor.value = null
  })
  confirmFor.value = null
}
</script>

<template>
  <div data-testid="resources-view">
    <h1 class="text-h5 mb-1">{{ t('resources.title') }}</h1>
    <p class="text-body-2 text-medium-emphasis mb-4">{{ t('resources.intro') }}</p>

    <v-alert v-if="store.error.value" type="error" variant="tonal" density="compact" class="mb-4">
      {{ t('resources.loadFailed') }}: {{ store.error.value }}
    </v-alert>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4" closable :text="error" @click:close="error = null" />
    <v-alert v-if="notice" type="success" variant="tonal" density="compact" class="mb-4" closable :text="notice" @click:close="notice = null" />

    <div class="d-flex flex-wrap align-center ga-3 mb-4">
      <v-text-field
        v-model="query"
        :label="t('resources.search')"
        :placeholder="t('resources.searchPlaceholder')"
        prepend-inner-icon="mdi-magnify"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        class="search-field"
        data-testid="resources-search"
      />
      <v-chip-group v-model="weight" mandatory selected-class="text-primary">
        <v-chip value="all" size="small" filter>{{ t('resources.allWeights') }}</v-chip>
        <v-chip v-for="f in filtersPresent" :key="f" :value="f" size="small" filter :data-testid="`weight-filter-${f}`">{{ t(`resources.filter.${f}`) }}</v-chip>
      </v-chip-group>
      <v-spacer />
      <v-btn color="primary" variant="tonal" prepend-icon="mdi-plus" :text="t('resources.add')" data-testid="resource-add" @click="openEdit(null)" />
    </div>

    <div v-if="!store.loaded.value && !store.error.value" class="text-body-2 text-medium-emphasis">{{ t('resources.loading') }}</div>
    <v-alert v-else-if="!filtered.length" type="info" variant="tonal" density="compact" data-testid="resources-empty">
      {{ t('resources.empty') }}
      <v-btn v-if="noHits" class="ml-2" size="small" variant="tonal" prepend-icon="mdi-book-search-outline" :to="{ name: 'rules', query: { q: query.trim() } }" :text="t('resources.emptySearchRules')" data-testid="resources-search-rules" />
    </v-alert>

    <v-expansion-panels v-model="opened" multiple variant="accordion" data-testid="resources-list">
      <template v-for="row in rows" :key="row.kind === 'group' ? 'outdated-group' : row.r.key">
      <div v-if="row.kind === 'group'" class="outdated-group" data-testid="resources-outdated-group">
        <v-btn variant="text" size="small" :prepend-icon="outdatedShown ? 'mdi-chevron-down' : 'mdi-chevron-right'" :text="t('resources.outdatedGroup', { count: outdated.length })" :disabled="!!query.trim()" data-testid="resources-outdated-toggle" @click="outdatedOpen = !outdatedOpen" />
      </div>
      <v-expansion-panel v-else :id="`res-${row.r.key}`" :value="row.r.key" :class="{ 'res-highlight': highlightKey === row.r.key }" data-testid="resource-item">
        <v-expansion-panel-title>
          <div class="d-flex flex-column flex-grow-1" style="min-width: 0">
            <div class="d-flex flex-wrap align-center ga-2">
              <span class="text-body-2 font-weight-medium">{{ row.r.title }}</span>
              <v-chip size="x-small" label variant="tonal" :color="WEIGHT_COLOR[row.r.weight]">{{ t(`resources.weight.${row.r.weight}`) }}</v-chip>
              <v-chip v-if="row.r.modified" size="x-small" label variant="tonal" color="warning" data-testid="resource-modified">{{ t('resources.chip.modified') }}</v-chip>
              <v-chip v-if="row.r.origin === 'custom'" size="x-small" label variant="tonal" color="secondary" data-testid="resource-custom">{{ t('resources.chip.custom') }}</v-chip>
              <v-chip v-if="row.r.content" size="x-small" label variant="tonal" prepend-icon="mdi-text-box-search-outline">{{ t('resources.chip.content') }}</v-chip>
              <v-spacer />
              <v-btn
                v-if="link(row.r)"
                icon="mdi-open-in-new"
                size="x-small"
                variant="text"
                :href="link(row.r)!"
                target="_blank"
                rel="noopener noreferrer"
                :title="t('resources.detail.openLink')"
                :aria-label="t('resources.detail.openLink')"
                data-testid="resource-open-original"
                @click.stop
              />
              <code class="text-caption text-disabled flex-shrink-0">{{ row.r.key }}</code>
            </div>
            <div class="text-caption text-medium-emphasis">
              <span v-if="row.r.publisher">{{ row.r.publisher }}</span>
              <span v-if="row.r.publisher && row.r.edition"> · </span>
              <span>{{ row.r.edition }}</span>
            </div>
            <div v-if="hits?.get(row.r.key)" class="text-caption mt-1 snippet" data-testid="resource-snippet">
              <template v-for="(seg, i) in highlightSegments(hits.get(row.r.key)!.snippet, query)" :key="i">
                <mark v-if="seg.hit">{{ seg.text }}</mark>
                <span v-else>{{ seg.text }}</span>
              </template>
            </div>
          </div>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <p v-if="row.r.summary" class="text-body-2 mb-3">{{ row.r.summary }}</p>

          <div class="d-flex flex-wrap align-center ga-2 mb-3">
            <v-btn v-if="link(row.r)" size="small" variant="tonal" prepend-icon="mdi-open-in-new" :href="link(row.r)!" target="_blank" rel="noopener noreferrer" :text="t('resources.detail.openLink')" />
            <span v-else class="text-caption text-medium-emphasis">{{ t('resources.detail.noUrl') }}</span>
          </div>

          <v-table density="compact" class="res-meta mb-3">
            <tbody>
              <tr v-if="row.r.publisher"><th scope="row">{{ t('resources.detail.publisher') }}</th><td>{{ row.r.publisher }}</td></tr>
              <tr><th scope="row">{{ t('resources.detail.edition') }}</th><td>{{ row.r.edition }}</td></tr>
              <tr v-if="row.r.date"><th scope="row">{{ t('resources.detail.date') }}</th><td>{{ fmt(row.r.date) }}</td></tr>
              <tr v-if="row.r.checkedOn"><th scope="row">{{ t('resources.detail.checkedOn') }}</th><td>{{ fmt(row.r.checkedOn) }}</td></tr>
              <tr v-if="row.r.partlyRead.length"><th scope="row">{{ t('resources.detail.partlyRead') }}</th><td>{{ row.r.partlyRead.join('; ') }}</td></tr>
              <tr v-if="row.r.notes"><th scope="row">{{ t('resources.detail.notes') }}</th><td>{{ row.r.notes }}</td></tr>
              <tr>
                <th scope="row">{{ t('resources.detail.file') }}</th>
                <td>
                  <template v-if="row.r.content">
                    <span v-if="row.r.fileName">{{ row.r.fileName }} · </span>{{ t('resources.detail.contentStats', { words: wordCount(row.r.content), kb: kb(row.r.content) }) }}
                  </template>
                  <span v-else class="text-medium-emphasis">{{ t('resources.detail.noContent') }}</span>
                </td>
              </tr>
              <tr>
                <th scope="row">{{ t('resources.detail.citedBy', { count: citedBy.get(row.r.key)?.length ?? 0 }, citedBy.get(row.r.key)?.length ?? 0) }}</th>
                <td>
                  <ul v-if="citedBy.get(row.r.key)?.length" class="plain-list" data-testid="resource-cited-by">
                    <li v-for="rule in citedBy.get(row.r.key)" :key="rule.id">
                      <router-link :to="{ name: 'rules', query: { rule: rule.id } }"><code>{{ rule.id }}</code></router-link>
                      {{ rule.title }}<span v-if="rule.page" class="text-medium-emphasis"> · {{ rule.page }}</span>
                    </li>
                  </ul>
                  <span v-else class="text-medium-emphasis">{{ t('resources.detail.citedNone') }}</span>
                </td>
              </tr>
            </tbody>
          </v-table>

          <div class="d-flex flex-wrap ga-2 mb-3">
            <v-btn size="small" variant="text" prepend-icon="mdi-pencil-outline" :text="t('resources.action.edit')" data-testid="resource-edit" @click="openEdit(row.r)" />
            <v-btn size="small" variant="text" prepend-icon="mdi-file-replace-outline" :loading="busyKey === row.r.key" :text="t('resources.action.attach')" data-testid="resource-attach" @click="attachFile(row.r)" />
            <v-btn size="small" variant="text" prepend-icon="mdi-text-box-plus-outline" :text="t('resources.action.paste')" data-testid="resource-paste" @click="openPaste(row.r)" />
            <v-btn
              v-if="row.r.origin === 'bundled'"
              size="small"
              variant="text"
              prepend-icon="mdi-backup-restore"
              :disabled="!row.r.modified && !row.r.content"
              :text="t('resources.action.reset')"
              data-testid="resource-reset"
              @click="confirmFor = row.r"
            />
            <v-btn v-else size="small" variant="text" color="error" prepend-icon="mdi-delete-outline" :text="t('resources.action.delete')" data-testid="resource-delete" @click="confirmFor = row.r" />
          </div>

          <div v-if="row.r.modified || row.r.origin === 'custom'" class="text-caption text-medium-emphasis" data-testid="resource-updated">
            {{ t('resources.detail.updated', { date: fmt(row.r.updatedAt), by: t(`resources.origin.${row.r.updatedBy}`) }) }}
          </div>
          <div v-if="row.r.history?.length" class="mt-2">
            <div class="text-caption font-weight-medium">{{ t('resources.detail.history') }}</div>
            <ul class="plain-list text-caption text-medium-emphasis" data-testid="resource-history">
              <li v-for="h in row.r.history" :key="h.replacedAt">{{ t('resources.detail.historyEntry', { date: fmt(h.replacedAt), title: h.title, edition: h.edition }) }}</li>
            </ul>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
      </template>
    </v-expansion-panels>

    <ResourceEditDialog v-model="editOpen" :resource="editing" @save="onSave" />

    <v-dialog :model-value="!!pasteFor" max-width="720" @update:model-value="pasteFor = null">
      <v-card v-if="pasteFor" data-testid="resource-paste-dialog">
        <v-card-title>{{ t('resources.dialog.pasteTitle', { key: pasteFor.key }) }}</v-card-title>
        <v-card-text>
          <v-textarea v-model="pasteText" :label="t('resources.dialog.pasteLabel')" :hint="t('resources.dialog.pasteHint')" persistent-hint rows="10" auto-grow density="compact" data-testid="resource-paste-text" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :text="t('resources.action.cancel')" @click="pasteFor = null" />
          <v-btn color="primary" variant="flat" :text="t('resources.action.save')" data-testid="resource-paste-save" @click="savePaste" />
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="!!confirmFor" max-width="480" @update:model-value="confirmFor = null">
      <v-card v-if="confirmFor">
        <v-card-title>{{ confirmFor.origin === 'bundled' ? t('resources.dialog.resetTitle') : t('resources.dialog.deleteTitle') }}</v-card-title>
        <v-card-text>
          {{ confirmFor.origin === 'bundled' ? t('resources.dialog.resetBody', { title: confirmFor.title }) : t('resources.dialog.deleteBody', { title: confirmFor.title }) }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :text="t('resources.action.cancel')" @click="confirmFor = null" />
          <v-btn color="error" variant="flat" :text="confirmFor.origin === 'bundled' ? t('resources.action.reset') : t('resources.action.delete')" data-testid="resource-confirm" @click="confirmReset" />
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.search-field {
  max-width: 24rem;
  min-width: 14rem;
}
.res-meta th {
  width: 10rem;
  font-weight: 500;
  vertical-align: top;
}
.res-meta td {
  white-space: normal;
}
.plain-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.outdated-group {
  padding: 4px 0;
  border-top: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.res-highlight {
  animation: res-flash 2s ease-out;
}
@keyframes res-flash {
  0%,
  70% {
    background: rgba(var(--v-theme-primary), 0.12);
  }
  100% {
    background: transparent;
  }
}
.snippet mark {
  background: rgba(var(--v-theme-warning), 0.35);
  color: inherit;
  padding: 0 1px;
}
</style>
