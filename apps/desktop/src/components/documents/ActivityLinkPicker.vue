<script setup lang="ts">
/** Picks one activity of the camp («Titel · Tag · Zeit»). Used for local document links (no eCamp write). */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ActivityOption } from '@/domain/documents'
import type { Iri } from '@/domain/types'

const props = defineProps<{ options: ActivityOption[]; autofocus?: boolean }>()
const emit = defineEmits<{ pick: [iri: Iri] }>()
const { t } = useI18n()
const model = ref<Iri | null>(null)

const items = computed(() =>
  props.options.map((o) => ({
    value: o.iri,
    title: [o.title, o.dayNumber !== null ? t('documents.list.linkDay', { n: o.dayNumber }) : null, o.time].filter(Boolean).join(' · '),
  })),
)

function onPick(iri: Iri | null) {
  if (!iri) return
  emit('pick', iri)
  model.value = null
}
</script>

<template>
  <v-autocomplete
    :model-value="model"
    :items="items"
    :label="t('documents.list.linkLabel')"
    density="compact"
    variant="outlined"
    hide-details
    clearable
    :autofocus="autofocus"
    data-testid="document-link-picker"
    @update:model-value="onPick"
  />
</template>
