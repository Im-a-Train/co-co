<script setup lang="ts">
/** Settings > NDS: enable, login window (AGOV), logout. */
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNds } from '@/composables/useNds'
import { isTauri } from '@/lib/tauri'
import NdsCoachProfile from './NdsCoachProfile.vue'

const { t } = useI18n()
const nds = useNds()
const inTauri = isTauri()

onMounted(() => void nds.init())
</script>

<template>
  <v-row>
    <v-col cols="12" md="8" xl="6">
      <v-card variant="outlined" data-testid="nds-settings">
        <v-card-text>
          <p class="mb-2">{{ t('nds.settings.intro') }}</p>
          <v-alert type="warning" variant="tonal" density="compact" class="mb-2" icon="mdi-shield-lock">{{ t('nds.settings.redZoneText') }}</v-alert>
          <v-alert type="info" variant="tonal" density="compact" class="mb-4">{{ t('nds.settings.unofficial') }}</v-alert>

          <v-switch
            :model-value="nds.enabled.value"
            :label="t('nds.settings.enable')"
            color="primary"
            density="compact"
            hide-details
            class="mb-3"
            data-testid="nds-enable"
            @update:model-value="(v) => nds.setEnabled(v === true)"
          />

          <template v-if="nds.enabled.value">
            <div class="text-subtitle-2 mb-1">{{ t('nds.settings.status.title') }}</div>
            <div class="d-flex align-center flex-wrap ga-2 mb-3">
              <v-chip size="small" variant="tonal" :color="nds.status.value.connected ? 'success' : undefined" data-testid="nds-status">
                {{ nds.status.value.connected ? t('nds.settings.status.connected') : t('nds.settings.status.none') }}
              </v-chip>
              <span v-if="nds.status.value.cookieNames.length" class="text-caption text-medium-emphasis">
                {{ t('nds.settings.status.cookies', { names: nds.status.value.cookieNames.join(', ') }) }}
              </span>
            </div>

            <div class="d-flex align-center flex-wrap ga-2">
              <v-btn
                :color="nds.status.value.connected ? undefined : 'primary'"
                :variant="nds.status.value.connected ? 'text' : 'flat'"
                :disabled="!inTauri"
                :loading="nds.busy.value"
                data-testid="nds-login"
                @click="nds.connectWithLogin()"
              >
                {{ nds.status.value.connected ? t('nds.settings.relogin') : t('nds.settings.login') }}
              </v-btn>
              <v-btn v-if="nds.status.value.connected" variant="tonal" :disabled="!inTauri" data-testid="nds-logout" @click="nds.logout()">
                {{ t('nds.settings.logout') }}
              </v-btn>
            </div>
            <div class="text-caption mt-1">{{ inTauri ? t('nds.settings.loginHint') : t('nds.settings.notInApp') }}</div>

            <NdsCoachProfile />
          </template>
          <div v-else-if="nds.status.value.connected" class="d-flex align-center flex-wrap ga-2" data-testid="nds-stale-session">
            <span>{{ t('nds.settings.staleSession') }}</span>
            <v-btn variant="tonal" :disabled="!inTauri" data-testid="nds-logout" @click="nds.logout()">{{ t('nds.settings.logout') }}</v-btn>
          </div>

          <v-alert v-if="nds.error.value" type="error" variant="tonal" density="compact" class="mt-3" :text="nds.error.value" />
        </v-card-text>
      </v-card>
    </v-col>

  </v-row>
</template>
