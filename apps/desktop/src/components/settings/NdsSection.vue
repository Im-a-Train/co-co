<script setup lang="ts">
/** Settings > NDS: enable, login window (AGOV), logout, diagnosis (status codes and field names only). */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNds } from '@/composables/useNds'
import type { NdsProbe } from '@/domain/types'
import { isTauri } from '@/lib/tauri'

const { t } = useI18n()
const nds = useNds()
const inTauri = isTauri()

const diagCamp = ref('')
const probe = ref<NdsProbe | null>(null)

onMounted(() => void nds.init())

async function runProbe(): Promise<void> {
  probe.value = await nds.probe(diagCamp.value)
}
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
            <v-btn color="primary" :disabled="!inTauri || !nds.enabled.value" :loading="nds.busy.value" data-testid="nds-login" @click="nds.connectWithLogin()">
              {{ t('nds.settings.login') }}
            </v-btn>
            <v-btn v-if="nds.status.value.connected" :disabled="!inTauri" data-testid="nds-logout" @click="nds.logout()">
              {{ t('nds.settings.logout') }}
            </v-btn>
          </div>
          <div class="text-caption mt-1">{{ inTauri ? t('nds.settings.loginHint') : t('nds.settings.notInApp') }}</div>

          <v-alert v-if="nds.error.value" type="error" variant="tonal" density="compact" class="mt-3" :text="nds.error.value" />
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" md="8" xl="6">
      <v-expansion-panels variant="accordion">
        <v-expansion-panel data-testid="nds-diag">
          <v-expansion-panel-title>{{ t('nds.settings.diag.title') }}</v-expansion-panel-title>
          <v-expansion-panel-text>
            <p class="text-medium-emphasis mb-3">{{ t('nds.settings.diag.intro') }}</p>
            <div class="d-flex flex-wrap ga-2 align-start">
              <v-text-field v-model="diagCamp" :label="t('nds.settings.diag.campId')" density="compact" variant="outlined" hide-details style="max-width: 280px" />
              <v-btn :disabled="!inTauri || !diagCamp.trim()" :loading="nds.busy.value" data-testid="nds-probe" @click="runProbe">
                {{ t('nds.settings.diag.run') }}
              </v-btn>
            </div>
            <v-table v-if="probe" density="compact" class="mt-3" data-testid="nds-probe-result">
              <thead>
                <tr>
                  <th>{{ t('nds.settings.diag.endpoint') }}</th>
                  <th>{{ t('nds.settings.diag.status') }}</th>
                  <th>{{ t('nds.settings.diag.present') }}</th>
                  <th>{{ t('nds.settings.diag.missing') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in probe.endpoints" :key="e.name">
                  <td>{{ e.name }}</td>
                  <td>{{ e.status ?? '–' }}</td>
                  <td class="text-wrap">{{ e.fieldsPresent.join(', ') || t('nds.settings.diag.none') }}</td>
                  <td class="text-wrap">{{ e.fieldsMissing.join(', ') || t('nds.settings.diag.none') }}</td>
                </tr>
              </tbody>
            </v-table>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-col>
  </v-row>
</template>
