<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { WatchedFolder } from '@/domain/types'

defineProps<{ folders: WatchedFolder[] }>()
const emit = defineEmits<{ remove: [folder: WatchedFolder]; rescan: [] }>()
const { t } = useI18n()
</script>

<template>
  <v-card variant="outlined">
    <v-card-title class="text-subtitle-1 d-flex align-center">
      {{ t('documents.folders.title') }}
      <v-spacer />
      <v-btn v-if="folders.length" size="small" variant="text" prepend-icon="mdi-refresh" @click="emit('rescan')">
        {{ t('documents.folders.rescan') }}
      </v-btn>
    </v-card-title>
    <v-card-text v-if="!folders.length" class="text-medium-emphasis">{{ t('documents.folders.empty') }}</v-card-text>
    <v-list v-else density="compact">
      <v-list-item v-for="f in folders" :key="f.id" :title="f.path" prepend-icon="mdi-folder-eye-outline">
        <template #append>
          <v-btn size="small" variant="text" icon="mdi-close" :title="t('documents.folders.remove')" @click="emit('remove', f)" />
        </template>
      </v-list-item>
    </v-list>
  </v-card>
</template>
