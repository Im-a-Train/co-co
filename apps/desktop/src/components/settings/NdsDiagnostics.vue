<script setup lang="ts">
/** Settings > Fehlersuche: NDS diagnosis (status codes and field names only). */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNds } from '@/composables/useNds'
import type { NdsProbe } from '@/domain/types'
import { isTauri } from '@/lib/tauri'

const { t } = useI18n()
const nds = useNds()
const inTauri = isTauri()

const diagCamp = ref('')
const probe = ref<NdsProbe | null>(null)

async function runProbe(): Promise<void> {
  probe.value = await nds.probe(diagCamp.value)
}
</script>

<template>
  <div data-testid="nds-diag">
    <div class="text-subtitle-2 mb-1">{{ t('settings.diagnostics.nds') }}</div>
    <p class="text-medium-emphasis mb-3">{{ t('nds.settings.diag.intro') }}</p>
    <div class="d-flex flex-wrap ga-2 align-start">
      <v-text-field v-model="diagCamp" :label="t('nds.settings.diag.campId')" density="compact" variant="outlined" hide-details style="max-width: 280px" />
      <v-btn variant="tonal" :disabled="!inTauri || !diagCamp.trim()" :loading="nds.busy.value" data-testid="nds-probe" @click="runProbe">
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
  </div>
</template>
