<script setup lang="ts">
/** docx viewer: mammoth -> HTML -> allowlist sanitizer -> Vue render function (no v-html). */
import { h, onMounted, ref, type VNode } from 'vue'
import { useI18n } from 'vue-i18n'
import { loadMammoth } from '@/domain/documents/extract'
import { sanitizeDocxHtml, type SafeNode } from '@/domain/documents/docxSanitize'

const props = defineProps<{ bytes: Uint8Array }>()
const { t } = useI18n()

const nodes = ref<SafeNode[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

function render(n: SafeNode): VNode | string {
  if (typeof n === 'string') return n
  if (n.tag === 'br' || n.tag === 'img') return h(n.tag, n.attrs ?? {})
  return h(n.tag, n.attrs ?? {}, n.children.map(render))
}

/** Renders the sanitized tree. */
const Tree = (p: { nodes: SafeNode[] }) => p.nodes.map(render)

onMounted(async () => {
  try {
    const mammoth = await loadMammoth()
    const arrayBuffer = props.bytes.buffer.slice(props.bytes.byteOffset, props.bytes.byteOffset + props.bytes.byteLength) as ArrayBuffer
    const res = await mammoth.convertToHtml({ arrayBuffer })
    nodes.value = sanitizeDocxHtml(res.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div>
    <v-progress-linear v-if="loading" indeterminate />
    <v-alert v-if="error" type="error" variant="tonal" density="compact" :text="t('documents.viewer.error', { msg: error })" />
    <v-alert v-else-if="!loading && !nodes.length" type="info" variant="tonal" density="compact" :text="t('documents.viewer.empty')" />
    <div v-else class="docx"><Tree :nodes="nodes" /></div>
  </div>
</template>

<style scoped>
.docx {
  max-height: 70vh;
  overflow: auto;
  padding: 12px 16px;
  line-height: 1.5;
}
.docx :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
}
.docx :deep(td),
.docx :deep(th) {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding: 4px 8px;
  vertical-align: top;
}
.docx :deep(img) {
  max-width: 100%;
}
.docx :deep(p) {
  margin: 0 0 8px;
}
.docx :deep(ul),
.docx :deep(ol) {
  margin: 0 0 8px 24px;
}
</style>
