<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useManualFindings } from '@/composables/useManualFindings'
import { anchorLabel, MANUAL_COMMENT_MAX } from '@/domain/manualFindings'
import { MANUAL_FINDING_CATEGORIES } from '@/domain/types'
import type { DocumentAnchor, Iri, ManualFinding, ManualFindingCategory } from '@/domain/types'

const props = defineProps<{
  modelValue: boolean
  campIri: Iri
  scope: 'camp' | 'activity' | 'document'
  activityIri?: Iri
  documentId?: string
  anchor?: DocumentAnchor
  editId?: string
  title?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [finding: ManualFinding] }>()
const { t } = useI18n()
const handle = useManualFindings(() => props.campIri)

const CATEGORY_ICONS: Record<ManualFindingCategory, string> = {
  positive: 'mdi-thumb-up-outline',
  safety: 'mdi-shield-alert-outline',
  program: 'mdi-calendar-text',
  js: 'mdi-school-outline',
  pedagogy: 'mdi-account-group-outline',
  organisation: 'mdi-clipboard-list-outline',
  documents: 'mdi-file-document-outline',
  question: 'mdi-help-circle-outline',
  other: 'mdi-dots-horizontal-circle-outline',
}

const category = ref<ManualFindingCategory>('program')
const comment = ref('')
const saving = ref(false)
const error = ref<string | null>(null)

const existing = computed(() => (props.editId ? (handle.items.value.find((m) => m.id === props.editId) ?? null) : null))
const anchorText = computed(() => anchorLabel(existing.value?.anchor ?? props.anchor))
const trimmed = computed(() => comment.value.trim())
const valid = computed(() => trimmed.value.length > 0 && trimmed.value.length <= MANUAL_COMMENT_MAX)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    error.value = null
    saving.value = false
    const cur = existing.value
    category.value = cur?.category ?? 'program'
    comment.value = cur?.comment ?? ''
  },
  { immediate: true },
)

async function save() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = null
  try {
    let rec: ManualFinding | undefined
    if (props.editId) {
      await handle.update(props.editId, { category: category.value, comment: trimmed.value })
      rec = handle.items.value.find((m) => m.id === props.editId)
    } else {
      rec = await handle.add({
        scope: props.scope,
        activityIri: props.activityIri,
        documentId: props.documentId,
        anchor: props.anchor,
        category: category.value,
        comment: trimmed.value,
      })
    }
    if (rec) emit('saved', rec)
    emit('update:modelValue', false)
  } catch (e) {
    error.value = t('findings.manual.saveFailed', { error: e instanceof Error ? e.message : String(e) })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="560" @update:model-value="emit('update:modelValue', $event)">
    <v-card data-testid="manual-finding-dialog">
      <v-card-title>{{ editId ? t('findings.manual.title.edit') : t('findings.manual.title.new') }}</v-card-title>
      <v-card-text>
        <div class="text-body-2 text-medium-emphasis mb-1">
          {{ title ? t('findings.manual.forTarget', { title }) : t(`findings.manual.scope.${scope}`) }}
        </div>
        <div v-if="anchorText" class="text-caption mb-2" data-testid="manual-finding-anchor">
          <v-icon icon="mdi-map-marker-outline" size="x-small" /> {{ t('findings.manual.anchor', { label: anchorText }) }}
        </div>
        <div class="text-subtitle-2 mb-1">{{ t('findings.manual.categoryLabel') }}</div>
        <v-chip-group v-model="category" mandatory selected-class="text-primary" class="mb-2" data-testid="manual-finding-category">
          <v-chip
            v-for="c in MANUAL_FINDING_CATEGORIES"
            :key="c"
            :value="c"
            :prepend-icon="CATEGORY_ICONS[c]"
            :text="t(`findings.manual.category.${c}`)"
            :data-testid="`manual-finding-category-${c}`"
            filter
            variant="outlined"
            size="small"
          />
        </v-chip-group>
        <v-textarea
          v-model="comment"
          :label="t('findings.manual.comment')"
          :hint="t('findings.manual.commentHint')"
          :counter="MANUAL_COMMENT_MAX"
          :maxlength="MANUAL_COMMENT_MAX"
          rows="4"
          auto-grow
          variant="outlined"
          autofocus
          data-testid="manual-finding-comment"
        />
        <v-alert v-if="error" type="error" variant="tonal" density="compact" :text="error" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :text="t('findings.manual.cancel')" @click="emit('update:modelValue', false)" />
        <v-btn
          color="primary"
          variant="flat"
          :text="t('findings.manual.save')"
          :disabled="!valid"
          :loading="saving"
          data-testid="manual-finding-save"
          @click="save"
        />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
