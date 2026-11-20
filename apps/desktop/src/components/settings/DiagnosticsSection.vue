<script setup lang="ts">
/**
 * Settings > Fehlersuche: one closed panel with everything technical: token timers, cookie names, roles,
 * instance check, local data status, MiData/NDS diagnostics and the login diagnosis report.
 * Opens itself when the URL hash is #diagnose.
 */
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import InstanceCard from '@/components/InstanceCard.vue'
import SessionCard from '@/components/SessionCard.vue'
import SpikeProtocolCard from '@/components/SpikeProtocolCard.vue'
import MidataDiagnostics from '@/components/settings/MidataDiagnostics.vue'
import NdsDiagnostics from '@/components/settings/NdsDiagnostics.vue'
import DataStoreCard from '@/components/storage/DataStoreCard.vue'
import { isTauri } from '@/lib/tauri'

const { t } = useI18n()
const route = useRoute()
const inTauri = isTauri()
const open = ref<number | undefined>(undefined)

function openOnHash(): void {
  if (route.hash === '#diagnose') open.value = 0
}
onMounted(openOnHash)
watch(() => route.hash, openOnHash)
</script>

<template>
  <v-expansion-panels v-model="open" variant="accordion" data-testid="settings-diagnostics">
    <v-expansion-panel>
      <v-expansion-panel-title data-testid="settings-diagnostics-toggle">{{ t('settings.diagnostics.panel') }}</v-expansion-panel-title>
      <v-expansion-panel-text>
        <!-- The cards carry their own titles; no extra headings above them. -->
        <v-row class="mb-2">
          <v-col cols="12" lg="6"><SessionCard variant="outlined" /></v-col>
          <v-col cols="12" lg="6">
            <InstanceCard :disabled="!inTauri" variant="outlined" />
            <div class="mt-4"><DataStoreCard variant="outlined" /></div>
          </v-col>
        </v-row>

        <h3 class="text-subtitle-1 font-weight-bold mb-2">{{ t('settings.diagnostics.probes') }}</h3>
        <v-row class="mb-2">
          <!-- side by side only from xl: next to the anchor list the half columns cut the field labels -->
          <v-col cols="12" xl="6"><MidataDiagnostics /></v-col>
          <v-col cols="12" xl="6"><NdsDiagnostics /></v-col>
        </v-row>

        <SpikeProtocolCard variant="outlined" />
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>
