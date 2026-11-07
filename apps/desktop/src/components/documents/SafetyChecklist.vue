<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DocCheckResult } from '@/domain/types'

const props = defineProps<{ check: DocCheckResult | null }>()
const { t } = useI18n()
const missing = computed(() => props.check?.items.filter((i) => !i.found).length ?? 0)
</script>

<template>
  <v-card variant="outlined" density="compact">
    <v-card-title class="text-subtitle-1 d-flex align-center ga-2">
      {{ t('documents.checklist.title') }}
      <v-chip v-if="check" size="small" :color="check.complete ? 'success' : 'warning'" variant="tonal">
        {{ check.complete ? t('documents.checklist.complete') : t('documents.checklist.incomplete', { n: missing }) }}
      </v-chip>
    </v-card-title>
    <v-card-text>
      <p v-if="!check" class="text-medium-emphasis">{{ t('documents.checklist.notChecked') }}</p>
      <v-list v-else density="compact" lines="three" class="pa-0">
        <v-list-item v-for="item in check.items" :key="item.key" class="px-0">
          <template #prepend>
            <v-icon :color="item.found ? 'success' : 'warning'" :icon="item.found ? 'mdi-check-circle' : 'mdi-alert-circle-outline'" />
          </template>
          <v-list-item-title>{{ t(`documents.checklist.items.${item.key}`) }}</v-list-item-title>
          <v-list-item-subtitle v-if="!item.found">{{ t('documents.checklist.missing') }}</v-list-item-subtitle>
          <div v-for="(s, i) in item.snippets" :key="i" class="text-caption text-medium-emphasis snippet">{{ s }}</div>
        </v-list-item>
      </v-list>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.snippet {
  border-left: 2px solid rgb(var(--v-theme-primary));
  padding-left: 8px;
  margin-top: 4px;
  white-space: normal;
}
</style>
