<script setup lang="ts">
/** Edit dialog for the metadata of one Hilfsmittel, or (without `resource`) for a new custom one. */
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RESOURCE_WEIGHTS, validateResource, type NewResourceInput, type ResourcePatch } from '@/domain/resources'
import type { ResourceRecord, SourceWeight } from '@/domain/types'

const props = defineProps<{ modelValue: boolean; resource: ResourceRecord | null }>()
const emit = defineEmits<{
  'update:modelValue': [boolean]
  save: [payload: { key: string; patch: ResourcePatch } | { key: null; input: NewResourceInput }]
}>()
const { t } = useI18n()

const form = reactive({
  key: '',
  title: '',
  publisher: '',
  edition: '',
  date: '',
  url: '',
  summary: '',
  notes: '',
  checkedOn: '',
  weight: 'info' as SourceWeight,
})
const errors = ref<string[]>([])
const isNew = computed(() => !props.resource)

watch(
  () => [props.modelValue, props.resource] as const,
  ([open]) => {
    if (!open) return
    const r = props.resource
    form.key = r?.key ?? ''
    form.title = r?.title ?? ''
    form.publisher = r?.publisher ?? ''
    form.edition = r?.edition ?? ''
    form.date = r?.date ?? ''
    form.url = r?.url ?? ''
    form.summary = r?.summary ?? ''
    form.notes = r?.notes ?? ''
    form.checkedOn = r?.checkedOn ?? ''
    form.weight = r?.weight ?? 'info'
    errors.value = []
  },
  { immediate: true },
)

function save() {
  const patch: ResourcePatch = {
    title: form.title.trim(),
    publisher: form.publisher.trim(),
    edition: form.edition.trim(),
    date: form.date.trim(),
    url: form.url.trim(),
    summary: form.summary.trim(),
    notes: form.notes.trim(),
    checkedOn: form.checkedOn.trim(),
    weight: form.weight,
  }
  errors.value = validateResource({ ...(isNew.value ? { key: form.key.trim() } : {}), ...patch })
  if (isNew.value && !form.key.trim()) errors.value.push(t('resources.keyHint'))
  if (errors.value.length) return
  if (isNew.value) emit('save', { key: null, input: { key: form.key.trim(), ...patch, title: patch.title ?? '' } })
  else emit('save', { key: props.resource!.key, patch })
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="640" scrollable @update:model-value="emit('update:modelValue', $event)">
    <v-card data-testid="resource-edit-dialog">
      <v-card-title>{{ isNew ? t('resources.dialog.addTitle') : t('resources.dialog.editTitle', { key: resource!.key }) }}</v-card-title>
      <v-card-text>
        <v-alert v-if="errors.length" type="error" variant="tonal" density="compact" class="mb-3">
          <div v-for="e in errors" :key="e">{{ e }}</div>
        </v-alert>
        <v-text-field v-if="isNew" v-model="form.key" :label="t('resources.field.key')" :hint="t('resources.keyHint')" persistent-hint density="compact" class="mb-2" data-testid="res-field-key" />
        <v-text-field v-model="form.title" :label="t('resources.field.title')" density="compact" class="mb-2" data-testid="res-field-title" />
        <div class="d-flex ga-3">
          <v-text-field v-model="form.publisher" :label="t('resources.field.publisher')" density="compact" />
          <v-text-field v-model="form.edition" :label="t('resources.field.edition')" density="compact" />
        </div>
        <div class="d-flex ga-3">
          <v-text-field v-model="form.date" :label="t('resources.field.date')" density="compact" />
          <v-text-field v-model="form.checkedOn" :label="t('resources.field.checkedOn')" density="compact" />
        </div>
        <v-text-field v-model="form.url" :label="t('resources.field.url')" density="compact" class="mb-2" data-testid="res-field-url" />
        <v-select
          v-model="form.weight"
          :items="RESOURCE_WEIGHTS.map((w) => ({ value: w, title: t(`resources.weight.${w}`) }))"
          :label="t('resources.field.weight')"
          density="compact"
          class="mb-2"
        />
        <v-textarea v-model="form.summary" :label="t('resources.field.summary')" rows="2" auto-grow density="compact" class="mb-2" />
        <v-textarea v-model="form.notes" :label="t('resources.field.notes')" rows="2" auto-grow density="compact" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :text="t('resources.action.cancel')" @click="emit('update:modelValue', false)" />
        <v-btn color="primary" variant="flat" :text="t('resources.action.save')" data-testid="res-save" @click="save" />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
