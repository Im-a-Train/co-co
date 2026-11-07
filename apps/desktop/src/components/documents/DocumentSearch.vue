<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SearchHit } from '@/domain/documents'

const props = defineProps<{ search: (q: string) => SearchHit[] }>()
const emit = defineEmits<{ selectDocument: [id: string]; selectActivity: [iri: string] }>()
const { t } = useI18n()
const query = ref('')
const hits = ref<SearchHit[]>([])
let timer: ReturnType<typeof setTimeout> | undefined
watch(query, (q) => {
  clearTimeout(timer)
  timer = setTimeout(() => (hits.value = props.search(q ?? '')), 150)
})
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <v-card variant="outlined">
    <v-card-text>
      <v-text-field v-model="query" :label="t('documents.search.label')" prepend-inner-icon="mdi-magnify" clearable hide-details density="compact" />
      <p v-if="query && query.trim() && !hits.length" class="text-medium-emphasis mt-2">{{ t('documents.search.empty') }}</p>
      <v-list v-if="hits.length" density="compact" lines="three">
        <v-list-item
          v-for="h in hits"
          :key="h.ref"
          @click="h.documentId ? emit('selectDocument', h.documentId) : emit('selectActivity', h.activityIri!)"
        >
          <template #prepend>
            <v-icon :icon="h.kind === 'document' ? 'mdi-file-document-outline' : 'mdi-calendar-text-outline'" />
          </template>
          <v-list-item-title>
            {{ h.title }}
            <v-chip size="x-small" variant="tonal" class="ml-1">
              {{ h.kind === 'document' ? t('documents.search.document') : t('documents.search.activity') }}
            </v-chip>
          </v-list-item-title>
          <v-list-item-subtitle>{{ h.snippet }}</v-list-item-subtitle>
        </v-list-item>
      </v-list>
    </v-card-text>
  </v-card>
</template>
