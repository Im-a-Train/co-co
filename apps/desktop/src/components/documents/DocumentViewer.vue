<script setup lang="ts">
/** In-app viewer: re-reads the original from disk and dispatches by kind. Hosts "Befund erfassen". */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ManualFindingDialog from '@/components/cockpit/ManualFindingDialog.vue'
import { loadDocumentBytes } from '@/composables/useDocuments'
import { decodeUtf8 } from '@/domain/documents/extract'
import { anchorLabel } from '@/domain/manualFindings'
import type { DocumentAnchor, DocumentRecord } from '@/domain/types'
import DocxViewer from './DocxViewer.vue'
import GpxViewer from './GpxViewer.vue'
import PdfViewer from './PdfViewer.vue'
import XlsxViewer from './XlsxViewer.vue'

const props = defineProps<{ doc: DocumentRecord; target?: DocumentAnchor | null }>()
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()

const bytes = ref<Uint8Array | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const anchor = ref<DocumentAnchor | undefined>(undefined)
const dialog = ref(false)

const supported = computed(() => ['pdf', 'docx', 'xlsx', 'gpx', 'txt', 'md'].includes(props.doc.kind))
const plainText = computed(() => (bytes.value && (props.doc.kind === 'txt' || props.doc.kind === 'md') ? decodeUtf8(bytes.value) : ''))
const where = computed(() => anchorLabel(anchor.value))

let seq = 0
watch(
  () => [props.doc.id, props.doc.path, props.doc.modifiedMs] as const,
  async () => {
    const mine = ++seq
    bytes.value = null
    anchor.value = undefined
    error.value = null
    if (!supported.value) return
    loading.value = true
    try {
      const b = await loadDocumentBytes(props.doc.path)
      if (mine === seq) bytes.value = b
    } catch (e) {
      if (mine === seq) error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (mine === seq) loading.value = false
    }
  },
  { immediate: true },
)
</script>

<template>
  <div data-testid="document-viewer">
    <div class="d-flex align-center flex-wrap ga-2 mb-2">
      <v-btn
        color="primary"
        variant="tonal"
        size="small"
        prepend-icon="mdi-flag-plus-outline"
        data-testid="document-add-finding"
        @click="dialog = true"
      >
        {{ t('documents.viewer.addFinding') }}
      </v-btn>
      <span v-if="where" class="text-caption text-medium-emphasis">{{ t('documents.viewer.anchorAt', { where }) }}</span>
    </div>

    <v-progress-linear v-if="loading" indeterminate />
    <v-alert v-if="error" type="warning" variant="tonal" density="compact" :text="t('documents.viewer.readError', { msg: error })" />
    <v-alert v-else-if="!supported" type="info" variant="tonal" density="compact" :text="t('documents.viewer.unsupported')" />
    <template v-else-if="bytes">
      <PdfViewer v-if="doc.kind === 'pdf'" :key="doc.id" :bytes="bytes" :target="target" @anchor="anchor = $event" />
      <DocxViewer v-else-if="doc.kind === 'docx'" :key="doc.id" :bytes="bytes" />
      <XlsxViewer v-else-if="doc.kind === 'xlsx'" :key="doc.id" :bytes="bytes" :target="target" @anchor="anchor = $event" />
      <GpxViewer v-else-if="doc.kind === 'gpx'" :key="doc.id" :bytes="bytes" :target="target" @anchor="anchor = $event" />
      <pre v-else class="plain">{{ plainText }}</pre>
    </template>

    <ManualFindingDialog
      v-model="dialog"
      :camp-iri="doc.campIri"
      scope="document"
      :document-id="doc.id"
      :anchor="anchor"
      :title="t('documents.viewer.dialogTitle', { name: doc.name })"
      @saved="emit('saved')"
    />
  </div>
</template>

<style scoped>
.plain {
  white-space: pre-wrap;
  max-height: 70vh;
  overflow: auto;
  padding: 12px;
  font-size: 0.85rem;
}
</style>
