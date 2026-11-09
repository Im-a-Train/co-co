<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useManualFindings } from '@/composables/useManualFindings'
import { anchorLabel } from '@/domain/manualFindings'
import type { Iri, ManualFinding } from '@/domain/types'
import ManualFindingDialog from './ManualFindingDialog.vue'

const props = defineProps<{ campIri: Iri; items: ManualFinding[]; compact?: boolean }>()
const { t } = useI18n()
const handle = useManualFindings(() => props.campIri)

const editing = ref<ManualFinding | null>(null)
const dialog = ref(false)
const confirmId = ref<string | null>(null)

function edit(m: ManualFinding) {
  editing.value = m
  dialog.value = true
}
async function remove(m: ManualFinding) {
  if (confirmId.value !== m.id) {
    confirmId.value = m.id
    return
  }
  confirmId.value = null
  await handle.remove(m.id).catch(() => {})
}
</script>

<template>
  <div class="d-flex flex-column ga-2">
    <div v-if="!items.length" class="text-body-2 text-medium-emphasis">{{ t('findings.manual.empty') }}</div>
    <v-card v-for="m in items" :key="m.id" variant="outlined" density="compact" data-testid="manual-finding-item">
      <v-card-text :class="compact ? 'py-2' : 'py-3'">
        <div class="d-flex align-center flex-wrap ga-2 mb-1">
          <v-chip size="x-small" label color="primary" variant="tonal" :text="t(`findings.manual.category.${m.category}`)" />
          <span v-if="anchorLabel(m.anchor)" class="text-caption text-medium-emphasis">{{ anchorLabel(m.anchor) }}</span>
          <v-spacer />
          <v-btn
            icon="mdi-pencil-outline"
            size="x-small"
            variant="text"
            :title="t('findings.manual.edit')"
            :aria-label="t('findings.manual.edit')"
            data-testid="manual-finding-edit"
            @click.stop="edit(m)"
          />
          <v-btn
            :icon="confirmId === m.id ? 'mdi-check' : 'mdi-delete-outline'"
            :color="confirmId === m.id ? 'error' : undefined"
            size="x-small"
            variant="text"
            :title="confirmId === m.id ? t('findings.manual.deleteConfirm') : t('findings.manual.delete')"
            :aria-label="t('findings.manual.delete')"
            data-testid="manual-finding-delete"
            @click.stop="remove(m)"
            @blur="confirmId = null"
          />
        </div>
        <div class="text-body-2 manual-comment">{{ m.comment }}</div>
      </v-card-text>
    </v-card>
    <ManualFindingDialog
      v-if="editing"
      v-model="dialog"
      :camp-iri="campIri"
      :scope="editing.scope"
      :activity-iri="editing.activityIri"
      :document-id="editing.documentId"
      :anchor="editing.anchor"
      :edit-id="editing.id"
    />
  </div>
</template>

<style scoped>
.manual-comment {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
