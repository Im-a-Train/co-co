<script setup lang="ts">
/** PDF viewer: one canvas per page, rendered lazily when it scrolls into view. No network (pdfjs 6 has no eval path). */
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { loadPdfjs } from '@/domain/documents/extract'
import type { DocumentAnchor } from '@/domain/types'

const props = defineProps<{ bytes: Uint8Array; target?: DocumentAnchor | null }>()
const emit = defineEmits<{ anchor: [anchor: DocumentAnchor | undefined] }>()
const { t } = useI18n()

interface PageBox {
  w: number
  h: number
}

const loading = ref(true)
const error = ref<string | null>(null)
const numPages = ref(0)
const page = ref(1)
const zoom = ref(1)
const boxes = ref<PageBox[]>([])
const scroller = ref<HTMLElement | null>(null)
const pageEls = ref<HTMLElement[]>([])
const pageInput = ref('1')

const pdfRef = shallowRef<import('pdfjs-dist').PDFDocumentProxy | null>(null)
let task: import('pdfjs-dist').PDFDocumentLoadingTask | null = null
let observer: IntersectionObserver | null = null
/** page number -> zoom it was rendered at */
const rendered = new Map<number, number>()
const rendering = new Set<number>()
let disposed = false

async function load() {
  loading.value = true
  error.value = null
  try {
    const pdfjs = await loadPdfjs()
    task = pdfjs.getDocument({ data: props.bytes.slice() })
    const pdf = await task.promise
    if (disposed) return void task.destroy()
    pdfRef.value = pdf
    const list: PageBox[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const vp = (await pdf.getPage(i)).getViewport({ scale: 1 })
      list.push({ w: vp.width, h: vp.height })
    }
    if (disposed) return
    boxes.value = list
    numPages.value = pdf.numPages
    loading.value = false
    await nextTick()
    if (disposed) return
    setupObserver()
    await applyTarget(props.target)
    emitAnchor()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    loading.value = false
  }
}

function setupObserver() {
  observer?.disconnect()
  observer = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        const n = Number((en.target as HTMLElement).dataset.page)
        if (en.isIntersecting) void renderPage(n)
        else releasePage(n, en.target as HTMLElement)
      }
    },
    { root: scroller.value, rootMargin: '600px 0px' },
  )
  for (const el of pageEls.value) if (el) observer.observe(el)
}

async function renderPage(n: number) {
  const pdf = pdfRef.value
  const z = zoom.value
  if (!pdf || rendered.get(n) === z || rendering.has(n)) return
  const el = pageEls.value.find((e) => e && Number(e.dataset.page) === n)
  const canvas = el?.querySelector('canvas')
  if (!canvas) return
  rendering.add(n)
  try {
    const p = await pdf.getPage(n)
    const dpr = window.devicePixelRatio || 1
    const vp = p.getViewport({ scale: z * dpr })
    canvas.width = Math.floor(vp.width)
    canvas.height = Math.floor(vp.height)
    canvas.style.width = `${Math.floor(vp.width / dpr)}px`
    canvas.style.height = `${Math.floor(vp.height / dpr)}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    await p.render({ canvas, canvasContext: ctx, viewport: vp }).promise
    rendered.set(n, z)
  } catch {
    /* cancelled or page error: the page stays blank */
  } finally {
    rendering.delete(n)
    // Zoom changed while rendering: render again at the new zoom (only then: a page that failed must not loop).
    if (zoom.value !== z && !disposed) void renderPage(n)
  }
}

/** Frees the bitmap of a page far out of view (a canvas per page at full DPI adds up on long PDFs). */
function releasePage(n: number, el: HTMLElement) {
  if (rendering.has(n) || !rendered.has(n)) return
  const canvas = el.querySelector('canvas')
  if (canvas) {
    canvas.width = 0
    canvas.height = 0
  }
  rendered.delete(n)
}

function pageStyle(i: number) {
  const b = boxes.value[i]
  return b ? { width: `${b.w * zoom.value}px`, height: `${b.h * zoom.value}px` } : {}
}

function onScroll() {
  const sc = scroller.value
  if (!sc) return
  const top = sc.getBoundingClientRect().top
  let best = 1
  for (const el of pageEls.value) {
    if (!el) continue
    if (el.getBoundingClientRect().top - top <= sc.clientHeight / 3) best = Number(el.dataset.page)
    else break
  }
  if (best !== page.value) {
    page.value = best
    pageInput.value = String(best)
    emitAnchor()
  }
}

function emitAnchor() {
  emit('anchor', numPages.value ? { page: page.value } : undefined)
}

function goTo(n: number) {
  const target = Math.min(Math.max(1, Math.round(n) || 1), Math.max(numPages.value, 1))
  page.value = target
  pageInput.value = String(target)
  const el = pageEls.value.find((e) => e && Number(e.dataset.page) === target)
  const sc = scroller.value
  if (el && sc) sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8
  emitAnchor()
}

function setZoom(z: number) {
  zoom.value = Math.min(3, Math.max(0.4, Math.round(z * 100) / 100))
}

watch(zoom, async () => {
  rendered.clear()
  const current = page.value
  await nextTick()
  goTo(current)
  // Re-render what is visible; the observer only fires on changes in visibility.
  for (const el of pageEls.value) {
    if (!el) continue
    const r = el.getBoundingClientRect()
    const sr = scroller.value?.getBoundingClientRect()
    if (sr && r.bottom > sr.top - 300 && r.top < sr.bottom + 300) void renderPage(Number(el.dataset.page))
  }
})

async function applyTarget(a: DocumentAnchor | null | undefined) {
  if (!a?.page || !numPages.value) return
  // The jump may come together with a tab switch that makes the viewer visible: measure after the DOM update.
  await nextTick()
  if (!disposed) goTo(a.page)
}
watch(() => props.target, (a) => void applyTarget(a))

onMounted(load)
onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
  void task?.destroy()
})
</script>

<template>
  <div class="pdf-viewer d-flex flex-column">
    <div class="d-flex align-center ga-2 pa-1 toolbar">
      <v-btn icon="mdi-chevron-left" size="small" variant="text" :disabled="page <= 1" :aria-label="t('documents.viewer.prevPage')" @click="goTo(page - 1)" />
      <v-text-field
        v-model="pageInput"
        density="compact"
        variant="outlined"
        hide-details
        single-line
        style="max-width: 70px"
        :aria-label="t('documents.viewer.page')"
        @keydown.enter="goTo(Number(pageInput))"
        @blur="goTo(Number(pageInput))"
      />
      <span class="text-body-2">/ {{ numPages }}</span>
      <v-btn icon="mdi-chevron-right" size="small" variant="text" :disabled="page >= numPages" :aria-label="t('documents.viewer.nextPage')" @click="goTo(page + 1)" />
      <v-spacer />
      <v-btn icon="mdi-magnify-minus-outline" size="small" variant="text" :aria-label="t('documents.viewer.zoomOut')" @click="setZoom(zoom - 0.2)" />
      <span class="text-body-2" style="min-width: 3em; text-align: center">{{ Math.round(zoom * 100) }} %</span>
      <v-btn icon="mdi-magnify-plus-outline" size="small" variant="text" :aria-label="t('documents.viewer.zoomIn')" @click="setZoom(zoom + 0.2)" />
    </div>
    <v-progress-linear v-if="loading" indeterminate />
    <v-alert v-if="error" type="error" variant="tonal" density="compact" :text="t('documents.viewer.error', { msg: error })" />
    <div ref="scroller" class="pages" @scroll.passive="onScroll">
      <div
        v-for="(_, i) in boxes"
        :key="i"
        :ref="(el) => { if (el) pageEls[i] = el as HTMLElement }"
        class="page"
        :data-page="i + 1"
        data-testid="pdf-page"
        :style="pageStyle(i)"
      >
        <canvas />
      </div>
    </div>
  </div>
</template>

<style scoped>
.pdf-viewer {
  min-height: 0;
}
.pages {
  overflow: auto;
  max-height: 70vh;
  min-height: 300px;
  padding: 8px;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.page {
  margin: 0 auto 12px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}
.page canvas {
  display: block;
}
</style>
