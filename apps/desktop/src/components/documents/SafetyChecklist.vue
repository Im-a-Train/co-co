<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { DocCheckItem, DocCheckResult, SafetyCheckKey } from '@/domain/types'

const props = defineProps<{ check: DocCheckResult | null; confirmed?: SafetyCheckKey[] }>()
const emit = defineEmits<{ confirm: [key: SafetyCheckKey, value: boolean]; toFinding: [key: SafetyCheckKey] }>()
const { t } = useI18n()

const isConfirmed = (i: DocCheckItem) => !i.found && (props.confirmed ?? []).includes(i.key)
const present = (i: DocCheckItem) => i.found || isConfirmed(i)
</script>

<template>
  <div data-testid="safety-checklist">
    <p v-if="!check" class="text-medium-emphasis">{{ t('documents.checklist.notChecked') }}</p>
    <template v-else>
      <p class="text-caption text-medium-emphasis mb-2">{{ t('documents.checklist.hint') }}</p>
      <v-list density="compact" lines="three" class="pa-0">
        <v-list-item v-for="item in check.items" :key="item.key" class="px-0" :data-testid="`checklist-${item.key}`">
          <template #prepend>
            <v-icon
              :color="present(item) ? 'success' : 'warning'"
              :icon="present(item) ? 'mdi-check-circle' : 'mdi-alert-circle-outline'"
            />
          </template>
          <v-list-item-title>{{ t(`documents.checklist.items.${item.key}`) }}</v-list-item-title>
          <v-list-item-subtitle v-if="isConfirmed(item)" class="text-success">{{ t('documents.checklist.confirmed') }}</v-list-item-subtitle>
          <v-list-item-subtitle v-else-if="!item.found" class="text-warning">
            {{
              item.partial
                ? t('documents.checklist.partialNumbers', { present: item.partial.present.join(', '), min: item.partial.min })
                : t('documents.checklist.missing')
            }}
          </v-list-item-subtitle>
          <div v-for="(s, i) in item.snippets" :key="i" class="text-caption text-medium-emphasis snippet">{{ s }}</div>
          <template v-if="!item.found" #append>
            <div class="d-flex align-center ga-1">
              <v-btn
                v-if="!isConfirmed(item)"
                size="small"
                variant="text"
                :text="t('documents.checklist.confirm')"
                :data-testid="`checklist-confirm-${item.key}`"
                @click="emit('confirm', item.key, true)"
              />
              <v-btn
                v-else
                size="small"
                variant="text"
                :text="t('documents.checklist.unconfirm')"
                @click="emit('confirm', item.key, false)"
              />
              <v-btn
                v-if="!isConfirmed(item)"
                size="small"
                variant="text"
                icon="mdi-comment-plus-outline"
                :title="t('documents.checklist.toFinding')"
                :aria-label="t('documents.checklist.toFinding')"
                :data-testid="`checklist-finding-${item.key}`"
                @click="emit('toFinding', item.key)"
              />
            </div>
          </template>
        </v-list-item>
      </v-list>
    </template>
  </div>
</template>

<style scoped>
.snippet {
  border-left: 2px solid rgb(var(--v-theme-primary));
  padding-left: 8px;
  margin-top: 4px;
  white-space: normal;
}
</style>
