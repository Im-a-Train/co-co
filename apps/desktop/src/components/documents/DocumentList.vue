<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { isConceptGuess, type ActivityOption } from '@/domain/documents'
import type { ActivityFact, DocumentRecord, Iri } from '@/domain/types'
import ActivityLinkPicker from './ActivityLinkPicker.vue'

const props = defineProps<{
  documents: DocumentRecord[]
  activities: ActivityFact[]
  options: ActivityOption[]
  selectedId: string | null
}>()
const emit = defineEmits<{
  select: [id: string]
  confirm: [id: string, activityIri: Iri]
  reject: [id: string, activityIri: Iri]
  unlink: [id: string, activityIri: Iri]
  remove: [id: string]
  setConcept: [id: string, value: boolean | null]
}>()
const { t } = useI18n()

const titleOf = (iri: Iri) => props.activities.find((a) => a.iri === iri)?.title ?? iri
const ICONS: Record<string, string> = {
  pdf: 'mdi-file-pdf-box',
  docx: 'mdi-file-word-box',
  xlsx: 'mdi-file-excel-box',
  gpx: 'mdi-map-marker-path',
  txt: 'mdi-file-document-outline',
  md: 'mdi-language-markdown',
}
/** Filter field only for long lists. */
const FILTER_MIN = 8
const filter = ref('')
const shown = computed(() => {
  const q = filter.value.trim().toLowerCase()
  return q && props.documents.length > FILTER_MIN ? props.documents.filter((d) => d.name.toLowerCase().includes(q)) : props.documents
})
const linkOpen = ref<string | null>(null)
function pick(id: string, iri: Iri) {
  linkOpen.value = null
  emit('confirm', id, iri)
}
const icon = (k: string) => ICONS[k] ?? 'mdi-file-outline'
</script>

<template>
  <v-card variant="outlined">
    <v-card-title class="text-subtitle-1 d-flex flex-wrap align-center ga-2">
      {{ t('documents.list.title') }}
      <v-spacer />
      <slot name="actions" />
    </v-card-title>
    <v-card-text v-if="documents.length > FILTER_MIN" class="pb-0">
      <v-text-field
        v-model="filter"
        :label="t('documents.list.filter')"
        prepend-inner-icon="mdi-magnify"
        density="compact"
        variant="outlined"
        hide-details
        clearable
      />
    </v-card-text>
    <v-card-text v-if="!shown.length" class="text-medium-emphasis">{{ t('documents.list.filterEmpty') }}</v-card-text>
    <v-list v-else density="compact" lines="three">
      <v-list-item v-for="d in shown" :key="d.id" :active="d.id === selectedId" @click="emit('select', d.id)">
        <template #prepend><v-icon :icon="icon(d.kind)" /></template>
        <v-list-item-title>{{ d.name }}</v-list-item-title>
        <v-list-item-subtitle class="d-flex flex-wrap align-center ga-1 mt-1">
          <v-chip size="x-small" variant="tonal">{{ t(`documents.list.kind.${d.kind}`) }}</v-chip>
          <v-chip v-if="d.extractError" size="x-small" color="error" variant="tonal">{{ t('documents.list.error') }}</v-chip>
          <v-chip v-if="d.safetyConcept === true" size="x-small" color="primary" variant="tonal" prepend-icon="mdi-shield-check-outline">
            {{ t('documents.list.conceptChip') }}
          </v-chip>
          <v-icon
            v-if="d.aiAllowed"
            size="small"
            icon="mdi-robot-outline"
            :title="t('documents.list.aiAllowed')"
            :aria-label="t('documents.list.aiAllowed')"
            data-testid="document-ai-allowed"
          />
          <v-chip
            v-for="iri in d.activityIris"
            :key="iri"
            size="x-small"
            color="primary"
            variant="tonal"
            closable
            :close-label="t('documents.list.unlink')"
            @click:close.stop="emit('unlink', d.id, iri)"
          >
            {{ titleOf(iri) }}
          </v-chip>
        </v-list-item-subtitle>
        <div v-if="isConceptGuess(d)" class="d-flex align-center ga-1 mt-1 text-caption" data-testid="document-concept-guess">
          <v-icon size="x-small" icon="mdi-shield-check-outline" />
          <span>{{ t('documents.list.conceptQuestion') }}</span>
          <v-btn size="x-small" variant="text" color="success" icon="mdi-check" :title="t('documents.list.conceptYes')" :aria-label="t('documents.list.conceptYes')" @click.stop="emit('setConcept', d.id, true)" />
          <v-btn size="x-small" variant="text" icon="mdi-close" :title="t('documents.list.conceptNo')" :aria-label="t('documents.list.conceptNo')" @click.stop="emit('setConcept', d.id, false)" />
        </div>
        <div v-if="!d.activityIris.length" class="mt-1">
          <v-btn size="x-small" variant="text" prepend-icon="mdi-link-variant-plus" data-testid="document-link-action" @click.stop>
            {{ t('documents.list.linkAction') }}
            <v-menu
              :model-value="linkOpen === d.id"
              :close-on-content-click="false"
              activator="parent"
              @update:model-value="(v: boolean) => (linkOpen = v ? d.id : null)"
            >
              <v-card min-width="300" class="pa-2">
                <ActivityLinkPicker :options="options" autofocus @pick="pick(d.id, $event)" />
              </v-card>
            </v-menu>
          </v-btn>
        </div>
        <div v-if="!d.activityIris.length && d.linkSuggestions.length" class="mt-1">
          <div v-for="s in d.linkSuggestions.slice(0, 2)" :key="s.activityIri" class="d-flex align-center ga-1 text-caption">
            <v-icon size="x-small" icon="mdi-link-variant" />
            <span>{{ titleOf(s.activityIri) }}</span>
            <span class="text-medium-emphasis">({{ t('documents.list.confirmQuestion') }})</span>
            <v-btn size="x-small" variant="text" color="success" icon="mdi-check" :title="t('documents.list.confirm')" @click.stop="emit('confirm', d.id, s.activityIri)" />
            <v-btn size="x-small" variant="text" icon="mdi-close" :title="t('documents.list.reject')" @click.stop="emit('reject', d.id, s.activityIri)" />
          </div>
        </div>
        <template #append>
          <v-btn size="small" variant="text" icon="mdi-delete-outline" :title="t('documents.list.remove')" @click.stop="emit('remove', d.id)" />
        </template>
      </v-list-item>
    </v-list>
  </v-card>
</template>
