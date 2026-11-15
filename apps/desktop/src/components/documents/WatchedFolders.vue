<script setup lang="ts">
/** One line «{n} Ordner überwacht · verwalten»; the folder list opens on demand. Rendered only when folders exist. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { WatchedFolder } from '@/domain/types'

defineProps<{ folders: WatchedFolder[] }>()
const emit = defineEmits<{ remove: [folder: WatchedFolder]; rescan: [] }>()
const { t } = useI18n()
const open = ref(false)
</script>

<template>
  <div v-if="folders.length" data-testid="watched-folders">
    <div class="d-flex align-center ga-2 text-body-2">
      <v-icon size="small" icon="mdi-folder-eye-outline" />
      <span>{{ t('documents.folders.summary', { n: folders.length }) }}</span>
      <v-btn size="x-small" variant="text" :icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'" :title="open ? t('documents.folders.hide') : t('documents.folders.title')" :aria-label="t('documents.folders.title')" @click="open = !open" />
      <v-spacer />
      <v-btn size="small" variant="text" prepend-icon="mdi-refresh" @click="emit('rescan')">{{ t('documents.folders.rescan') }}</v-btn>
    </div>
    <v-list v-if="open" density="compact">
      <v-list-item v-for="f in folders" :key="f.id" :title="f.path" prepend-icon="mdi-folder-eye-outline">
        <template #append>
          <v-btn size="small" variant="text" icon="mdi-close" :title="t('documents.folders.remove')" :aria-label="t('documents.folders.remove')" @click="emit('remove', f)" />
        </template>
      </v-list-item>
    </v-list>
  </div>
</template>
