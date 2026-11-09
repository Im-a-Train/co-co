<script setup lang="ts">
/** Manual findings of one document; clicking one with an anchor jumps to that place in the viewer. */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ManualFindingList from '@/components/cockpit/ManualFindingList.vue'
import { useManualFindings } from '@/composables/useManualFindings'
import { anchorLabel } from '@/domain/manualFindings'
import type { DocumentAnchor, DocumentRecord, ManualFinding } from '@/domain/types'

const props = defineProps<{ doc: DocumentRecord }>()
const emit = defineEmits<{ jump: [anchor: DocumentAnchor] }>()
const { t } = useI18n()

const handle = useManualFindings(() => props.doc.campIri)
const items = computed<ManualFinding[]>(() => handle.byDocument.value.get(props.doc.id) ?? [])
const jumpable = computed(() => items.value.filter((m) => m.anchor && anchorLabel(m.anchor)))
</script>

<template>
  <v-card variant="outlined" data-testid="document-findings">
    <v-card-title class="text-subtitle-1">{{ t('documents.viewer.findings', { n: items.length }) }}</v-card-title>
    <v-card-text class="d-flex flex-column ga-2">
      <div v-if="jumpable.length" class="d-flex flex-wrap ga-1">
        <v-chip
          v-for="m in jumpable"
          :key="m.id"
          size="small"
          prepend-icon="mdi-map-marker-outline"
          :text="anchorLabel(m.anchor)!"
          :title="t('documents.viewer.jump')"
          @click="emit('jump', { ...m.anchor! })"
        />
      </div>
      <ManualFindingList :camp-iri="doc.campIri" :items="items" compact />
    </v-card-text>
  </v-card>
</template>
