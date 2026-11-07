<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ActivityFact, DocumentRecord, Iri } from '@/domain/types'

const props = defineProps<{
  documents: DocumentRecord[]
  activities: ActivityFact[]
  selectedId: string | null
}>()
const emit = defineEmits<{
  select: [id: string]
  confirm: [id: string, activityIri: Iri]
  reject: [id: string, activityIri: Iri]
  unlink: [id: string, activityIri: Iri]
  remove: [id: string]
}>()
const { t } = useI18n()

const titleOf = (iri: Iri) => props.activities.find((a) => a.iri === iri)?.title ?? iri
const ICONS: Record<string, string> = {
  pdf: 'mdi-file-pdf-box',
  docx: 'mdi-file-word-box',
  gpx: 'mdi-map-marker-path',
  txt: 'mdi-file-document-outline',
  md: 'mdi-language-markdown',
}
const icon = (k: string) => ICONS[k] ?? 'mdi-file-outline'
</script>

<template>
  <v-card variant="outlined">
    <v-card-title class="text-subtitle-1">{{ t('documents.list.title') }}</v-card-title>
    <v-card-text v-if="!documents.length" class="text-medium-emphasis">{{ t('documents.list.empty') }}</v-card-text>
    <v-list v-else density="compact" lines="three">
      <v-list-item v-for="d in documents" :key="d.id" :active="d.id === selectedId" @click="emit('select', d.id)">
        <template #prepend><v-icon :icon="icon(d.kind)" /></template>
        <v-list-item-title>{{ d.name }}</v-list-item-title>
        <v-list-item-subtitle class="d-flex flex-wrap align-center ga-1 mt-1">
          <v-chip size="x-small" variant="tonal">{{ t(`documents.list.kind.${d.kind}`) }}</v-chip>
          <v-chip v-if="d.extractError" size="x-small" color="error" variant="tonal">{{ t('documents.list.error') }}</v-chip>
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
          <v-chip v-if="!d.activityIris.length && !d.linkSuggestions.length" size="x-small" variant="outlined">
            {{ t('documents.list.noLink') }}
          </v-chip>
        </v-list-item-subtitle>
        <div v-if="!d.activityIris.length && d.linkSuggestions.length" class="mt-1" @click.stop>
          <div v-for="s in d.linkSuggestions.slice(0, 2)" :key="s.activityIri" class="d-flex align-center ga-1 text-caption">
            <v-icon size="x-small" icon="mdi-link-variant" />
            <span>{{ titleOf(s.activityIri) }}</span>
            <span class="text-medium-emphasis">({{ t('documents.list.confirmQuestion') }})</span>
            <v-btn size="x-small" variant="text" color="success" icon="mdi-check" :title="t('documents.list.confirm')" @click="emit('confirm', d.id, s.activityIri)" />
            <v-btn size="x-small" variant="text" icon="mdi-close" :title="t('documents.list.reject')" @click="emit('reject', d.id, s.activityIri)" />
          </div>
        </div>
        <template #append>
          <v-btn size="small" variant="text" icon="mdi-delete-outline" :title="t('documents.list.remove')" @click.stop="emit('remove', d.id)" />
        </template>
      </v-list-item>
    </v-list>
  </v-card>
</template>
