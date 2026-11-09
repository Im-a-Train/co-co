<script setup lang="ts">
/** Key lost (keychain entry missing/wrong): explicit, confirmed reset of the local data. Never automatic. */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useDataStore } from '@/composables/useDataStore'
import { errorMessage } from '@/lib/tauri'

const { t } = useI18n()
const router = useRouter()
const store = useDataStore()

const open = computed(() => store.state.value === 'keyLost')
const confirming = ref<null | 'import' | 'reset'>(null)
const confirmed = ref(false)
const busy = ref(false)
const failure = ref<string | null>(null)

function ask(kind: 'import' | 'reset'): void {
  confirming.value = kind
  confirmed.value = false
  failure.value = null
}

async function doReset(): Promise<void> {
  const kind = confirming.value
  busy.value = true
  failure.value = null
  try {
    await store.resetAndUnlock()
    if (store.state.value === 'ready') {
      confirming.value = null
      if (kind === 'import') await router.push('/einstellungen#backup')
    }
  } catch (e) {
    failure.value = t('storage.reset.failed', { detail: errorMessage(e) })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <v-dialog :model-value="open" persistent max-width="560" data-testid="data-reset-dialog">
    <v-card>
      <v-card-item prepend-icon="mdi-key-alert-outline">
        <v-card-title>{{ confirming ? t('storage.reset.confirmTitle') : t('storage.reset.title') }}</v-card-title>
      </v-card-item>
      <v-card-text v-if="!confirming">
        <p class="mb-3">{{ t('storage.reset.text') }}</p>
        <p class="text-medium-emphasis">{{ t('storage.reset.options') }}</p>
      </v-card-text>
      <v-card-text v-else>
        <v-alert type="warning" variant="tonal" density="compact" class="mb-3" :text="t('storage.reset.confirmText')" />
        <v-checkbox v-model="confirmed" :label="t('storage.reset.confirmCheck')" density="compact" hide-details data-testid="reset-confirm-check" />
        <v-alert v-if="failure" type="error" variant="tonal" density="compact" class="mt-3" :text="failure" />
      </v-card-text>
      <v-card-actions class="flex-wrap">
        <template v-if="!confirming">
          <v-spacer />
          <v-btn variant="tonal" data-testid="reset-import" @click="ask('import')">{{ t('storage.reset.importAfter') }}</v-btn>
          <v-btn color="error" variant="flat" data-testid="reset-only" @click="ask('reset')">{{ t('storage.reset.resetOnly') }}</v-btn>
        </template>
        <template v-else>
          <v-btn :disabled="busy" @click="confirming = null">{{ t('storage.reset.back') }}</v-btn>
          <v-spacer />
          <v-btn color="error" variant="flat" :disabled="!confirmed" :loading="busy" data-testid="reset-confirm" @click="doReset">
            {{ t('storage.reset.confirm') }}
          </v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
