<script setup lang="ts">
/** Settings > Updates (ADR 0017): installed version, auto-check toggle, manual check. */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppUpdate } from '@/composables/useAppUpdate'
import { isTauri } from '@/lib/tauri'

const { t } = useI18n()
const u = useAppUpdate()
const inTauri = isTauri()
const installed = ref<string>(__APP_VERSION__)

onMounted(() => void u.loadSettings())
</script>

<template>
  <v-row>
    <v-col cols="12" md="8" xl="6">
      <v-card variant="outlined" data-testid="update-settings">
        <v-card-text>
          <p class="mb-3" data-testid="update-installed">{{ t('update.settings.installed', { version: u.info.value?.currentVersion ?? installed }) }}</p>
          <v-switch
            :model-value="u.autoCheck.value"
            :label="t('update.settings.autoCheck')"
            :hint="t('update.settings.autoCheckHint')"
            persistent-hint
            color="primary"
            density="compact"
            class="mb-3"
            data-testid="update-auto"
            @update:model-value="(v) => u.setAutoCheck(v === true)"
          />
          <div class="d-flex align-center flex-wrap ga-3">
            <v-btn variant="tonal" :loading="u.checking.value" :disabled="!inTauri" data-testid="update-check" @click="u.checkNow()">
              {{ t('update.settings.checkNow') }}
            </v-btn>
            <span v-if="u.manualResult.value?.kind === 'upToDate'" class="text-body-2" data-testid="update-result">{{ t('update.settings.upToDate') }}</span>
            <template v-else-if="u.manualResult.value?.kind === 'available'">
              <span class="text-body-2" data-testid="update-result">{{ t('update.settings.available') }}</span>
              <v-btn size="small" variant="text" @click="u.dialogOpen.value = true">{{ t('update.settings.reopen') }}</v-btn>
            </template>
            <span v-else-if="u.manualResult.value?.kind === 'error'" class="text-body-2 text-error" data-testid="update-result">{{ u.manualResult.value.text }}</span>
          </div>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>
