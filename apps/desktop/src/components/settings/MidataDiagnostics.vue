<script setup lang="ts">
/** Settings > Fehlersuche: MiData diagnosis (status codes and field names only). */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMidata } from '@/composables/useMidata'
import type { MidataProbe } from '@/domain/types'
import { isTauri } from '@/lib/tauri'

const { t } = useI18n()
const md = useMidata()
const inTauri = isTauri()

const diagEvent = ref('')
const diagGroup = ref('')
const probe = ref<MidataProbe | null>(null)

async function runProbe(): Promise<void> {
  probe.value = await md.probe(diagEvent.value, diagGroup.value || null)
}
const yn = (b: boolean): string => (b ? t('common.yes') : t('common.no'))
</script>

<template>
  <div data-testid="midata-diag">
    <div class="text-subtitle-2 mb-1">{{ t('settings.diagnostics.midata') }}</div>
    <p class="text-medium-emphasis mb-3">{{ t('midata.settings.diag.intro') }}</p>
    <div class="d-flex flex-wrap ga-2 align-start">
      <v-text-field v-model="diagEvent" :label="t('midata.settings.diag.eventId')" density="compact" variant="outlined" hide-details style="max-width: 180px" />
      <v-text-field v-model="diagGroup" :label="t('midata.settings.diag.groupId')" density="compact" variant="outlined" hide-details style="max-width: 200px" />
      <v-btn variant="tonal" :disabled="!inTauri || !diagEvent.trim()" :loading="md.busy.value" data-testid="midata-probe" @click="runProbe">
        {{ t('midata.settings.diag.run') }}
      </v-btn>
    </div>
    <v-table v-if="probe" density="compact" class="mt-3" data-testid="midata-probe-result">
      <tbody>
        <tr><td>{{ t('midata.settings.diag.auth') }}</td><td>{{ probe.authMethod ?? '–' }}</td></tr>
        <tr><td>{{ t('midata.settings.diag.event') }}</td><td>{{ probe.eventStatus }}</td></tr>
        <tr><td>{{ t('midata.settings.diag.participations') }}</td><td>{{ probe.participationsStatus }}</td></tr>
        <tr><td>{{ t('midata.settings.diag.participationsReadable') }}</td><td>{{ yn(probe.participationsReadable) }}</td></tr>
        <tr><td>{{ t('midata.settings.diag.birthday') }}</td><td>{{ yn(probe.peopleBirthdayReadable) }}</td></tr>
        <tr><td>{{ t('midata.settings.diag.qualifications') }}</td><td>{{ probe.qualificationsStatus }}</td></tr>
        <tr><td>{{ t('midata.settings.diag.classic') }}</td><td>{{ probe.classicJsonStatus ?? '–' }}</td></tr>
        <tr><td>{{ t('midata.settings.diag.pbsFields') }}</td><td>{{ probe.pbsFieldsPresent.join(', ') || t('midata.settings.diag.none') }}</td></tr>
        <tr><td>{{ t('midata.settings.diag.attributes') }}</td><td class="text-wrap">{{ probe.classicAttributeNames.join(', ') || t('midata.settings.diag.none') }}</td></tr>
      </tbody>
    </v-table>
  </div>
</template>
