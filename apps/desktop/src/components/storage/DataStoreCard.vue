<script setup lang="ts">
/** /verbindung: status of the encrypted local data store (locked until an eCamp login). */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDataStore } from '@/composables/useDataStore'

const { t } = useI18n()
const store = useDataStore()

const label = computed(() => {
  if (store.state.value === 'unlocking') return t(store.creating.value ? 'storage.status.creating' : 'storage.status.unlocking')
  return t(`storage.status.${store.state.value}`)
})
const color = computed(() => {
  const s = store.state.value
  return s === 'ready' ? 'success' : s === 'keyLost' || s === 'error' ? 'error' : undefined
})
const icon = computed(() => (store.state.value === 'ready' ? 'mdi-lock-open-variant-outline' : 'mdi-lock-outline'))
</script>

<template>
  <v-card class="h-100" data-testid="datastore-card">
    <v-card-item prepend-icon="mdi-database-lock-outline">
      <v-card-title>{{ t('storage.title') }}</v-card-title>
    </v-card-item>
    <v-card-text>
      <v-chip :color="color" variant="tonal" :prepend-icon="icon" data-testid="datastore-status" class="mb-3">
        <v-progress-circular v-if="store.state.value === 'unlocking'" indeterminate size="14" width="2" class="me-2" />
        {{ label }}
      </v-chip>
      <p class="text-body-2 text-medium-emphasis">
        {{ store.state.value === 'ready' ? t('storage.readyHint') : t('storage.lockedHint') }}
      </p>
      <v-alert v-if="store.state.value === 'error'" type="error" variant="tonal" density="compact" class="mt-3" :title="t('storage.errorTitle')" :text="store.error.value ?? ''" data-testid="datastore-error">
        <template #append>
          <v-btn size="small" variant="text" @click="store.unlock()">{{ t('storage.retry') }}</v-btn>
        </template>
      </v-alert>
    </v-card-text>
  </v-card>
</template>
