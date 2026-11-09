<script setup lang="ts">
/** xlsx viewer: sheet tabs and a read-only grid; clicking a cell selects it and becomes the anchor. */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { readXlsx } from '@/domain/documents/extract'
import { cellRef, columnLetters, parseCellRef, type XlsxSheetView } from '@/domain/documents/xlsxView'
import type { DocumentAnchor } from '@/domain/types'

const MAX_ROWS = 1000
const MAX_COLS = 60

const props = defineProps<{ bytes: Uint8Array; target?: DocumentAnchor | null }>()
const emit = defineEmits<{ anchor: [anchor: DocumentAnchor | undefined] }>()
const { t } = useI18n()

const sheets = ref<XlsxSheetView[]>([])
const sheetIndex = ref(0)
const selected = ref<string | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const root = ref<HTMLElement | null>(null)

const sheet = computed(() => sheets.value[sheetIndex.value] ?? null)
const rows = computed(() => (sheet.value?.rows ?? []).slice(0, MAX_ROWS))
const colCount = computed(() => Math.min(MAX_COLS, Math.max(1, ...rows.value.map((r) => r.length))))
const truncated = computed(() => (sheet.value?.rows.length ?? 0) > MAX_ROWS)

function emitAnchor() {
  emit('anchor', sheet.value && selected.value ? { sheet: sheet.value.name, cell: selected.value } : sheet.value ? { sheet: sheet.value.name } : undefined)
}

function select(col: number, row: number) {
  selected.value = cellRef(col, row)
  emitAnchor()
}

/** Keyboard: arrows move the selected cell inside the shown grid. */
function onGridKey(ev: KeyboardEvent) {
  const d: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
  const delta = d[ev.key]
  if (!delta || !rows.value.length) return
  ev.preventDefault()
  const pos = selected.value ? parseCellRef(selected.value) : null
  const col = Math.min(colCount.value - 1, Math.max(0, (pos?.col ?? 0) + (pos ? delta[0] : 0)))
  const row = Math.min(rows.value.length - 1, Math.max(0, (pos?.row ?? 0) + (pos ? delta[1] : 0)))
  select(col, row)
  void nextTick(() => root.value?.querySelector('td.selected')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }))
}

watch(sheetIndex, () => {
  selected.value = null
  emitAnchor()
})

async function applyTarget(a: DocumentAnchor | null | undefined) {
  if (!a?.sheet || !sheets.value.length) return
  const i = sheets.value.findIndex((s) => s.name === a.sheet)
  if (i < 0) return
  sheetIndex.value = i
  await nextTick()
  const pos = a.cell ? parseCellRef(a.cell) : null
  selected.value = pos ? cellRef(pos.col, pos.row) : null
  emitAnchor()
  await nextTick()
  root.value?.querySelector('td.selected')?.scrollIntoView?.({ block: 'center', inline: 'center' })
}
watch(() => props.target, (a) => void applyTarget(a))

onMounted(async () => {
  try {
    sheets.value = await readXlsx(props.bytes)
    emitAnchor()
    await applyTarget(props.target)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div ref="root">
    <v-progress-linear v-if="loading" indeterminate />
    <v-alert v-if="error" type="error" variant="tonal" density="compact" :text="t('documents.viewer.error', { msg: error })" />
    <template v-else-if="sheet">
      <v-tabs v-model="sheetIndex" density="compact" show-arrows>
        <v-tab v-for="(s, i) in sheets" :key="i" :value="i" :text="s.name" />
      </v-tabs>
      <div class="text-caption text-medium-emphasis pa-1">
        {{ t('documents.viewer.cellHint') }}
        <strong v-if="selected" class="ml-2">{{ t('documents.viewer.selectedCell', { cell: selected }) }}</strong>
      </div>
      <div class="grid-wrap" tabindex="0" :aria-label="t('documents.viewer.gridLabel')" @keydown="onGridKey">
        <table class="grid">
          <thead>
            <tr>
              <th class="corner" />
              <th v-for="c in colCount" :key="c">{{ columnLetters(c - 1) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, ri) in rows" :key="ri">
              <th class="rownum">{{ ri + 1 }}</th>
              <td
                v-for="c in colCount"
                :key="c"
                data-testid="xlsx-cell"
                :data-cell="cellRef(c - 1, ri)"
                :class="{ selected: selected === cellRef(c - 1, ri) }"
                @click="select(c - 1, ri)"
              >
                {{ r[c - 1] ?? '' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="truncated" class="text-caption text-medium-emphasis pa-1">{{ t('documents.viewer.truncated', { n: MAX_ROWS }) }}</div>
    </template>
    <v-alert v-else-if="!loading" type="info" variant="tonal" density="compact" :text="t('documents.viewer.empty')" />
  </div>
</template>

<style scoped>
.grid-wrap {
  overflow: auto;
  max-height: 60vh;
}
.grid {
  border-collapse: collapse;
  font-size: 0.85rem;
}
.grid th,
.grid td {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding: 2px 8px;
  white-space: nowrap;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.grid thead th {
  position: sticky;
  top: 0;
  background: rgb(var(--v-theme-surface));
  z-index: 1;
}
.grid .rownum,
.grid .corner {
  position: sticky;
  left: 0;
  background: rgb(var(--v-theme-surface));
  text-align: right;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.grid td {
  cursor: cell;
}
.grid td:hover {
  background: rgba(var(--v-theme-primary), 0.08);
}
.grid td.selected {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
  background: rgba(var(--v-theme-primary), 0.14);
}
</style>
