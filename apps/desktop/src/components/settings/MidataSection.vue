<script setup lang="ts">
/** Settings > MiData: connection (login window or service token), own person id, M7-0 diagnosis. */
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMidata } from '@/composables/useMidata'
import type { MidataProbe } from '@/domain/types'
import { isTauri } from '@/lib/tauri'

const { t } = useI18n()
const md = useMidata()
const inTauri = isTauri()

const baseUrl = ref(md.baseUrl.value)
const personId = ref(md.personId.value ?? '')
const token = ref('')
const saved = ref(false)
const diagEvent = ref('')
const diagGroup = ref('')
const probe = ref<MidataProbe | null>(null)

onMounted(async () => {
  await md.init()
  baseUrl.value = md.baseUrl.value
  personId.value = md.personId.value ?? ''
})
watch([baseUrl, personId], () => (saved.value = false))

async function saveSettings(): Promise<void> {
  await md.saveSettings({ baseUrl: baseUrl.value, personId: personId.value || null })
  baseUrl.value = md.baseUrl.value
  saved.value = !md.error.value
}
async function login(): Promise<void> {
  await saveSettings()
  await md.connectWithLogin()
}
async function saveToken(): Promise<void> {
  await saveSettings()
  const ok = await md.connectWithToken(token.value)
  if (ok || !md.error.value) token.value = ''
}
async function runProbe(): Promise<void> {
  probe.value = await md.probe(diagEvent.value, diagGroup.value || null)
}
const yn = (b: boolean): string => (b ? t('common.yes') : t('common.no'))
</script>

<template>
  <v-row>
    <v-col cols="12" md="8" xl="6">
      <v-card variant="outlined" data-testid="midata-settings">
        <v-card-text>
          <p class="mb-2">{{ t('midata.settings.intro') }}</p>
          <v-alert type="warning" variant="tonal" density="compact" class="mb-4" icon="mdi-shield-lock">
            {{ t('midata.settings.redZoneText') }}
          </v-alert>

          <v-text-field
            v-model="baseUrl"
            :label="t('midata.settings.baseUrl')"
            :hint="t('midata.settings.baseUrlHint')"
            persistent-hint
            density="compact"
            variant="outlined"
            class="mb-4"
            data-testid="midata-baseurl"
            @blur="saveSettings"
          />

          <div class="text-subtitle-2 mb-1">{{ t('midata.settings.status.title') }}</div>
          <div class="d-flex align-center flex-wrap ga-2 mb-3">
            <v-chip size="small" variant="tonal" :color="md.status.value.connected ? 'success' : undefined" data-testid="midata-status">
              {{ md.status.value.connected ? t(`midata.settings.status.${md.status.value.method ?? 'session'}`) : t('midata.settings.status.none') }}
            </v-chip>
            <span v-if="md.status.value.cookieNames.length" class="text-caption text-medium-emphasis">
              {{ t('midata.settings.status.cookies', { names: md.status.value.cookieNames.join(', ') }) }}
            </span>
          </div>

          <div class="d-flex align-center flex-wrap ga-2">
            <v-btn color="primary" :disabled="!inTauri" :loading="md.busy.value" data-testid="midata-login" @click="login">
              {{ t('midata.settings.login') }}
            </v-btn>
            <v-btn v-if="md.status.value.connected" :disabled="!inTauri" data-testid="midata-logout" @click="md.logout()">
              {{ t('midata.settings.logout') }}
            </v-btn>
          </div>
          <div class="text-caption mt-1 mb-4">{{ inTauri ? t('midata.settings.loginHint') : t('midata.settings.notInApp') }}</div>

          <div class="text-subtitle-2 mb-1">{{ t('midata.settings.tokenTitle') }}</div>
          <div class="d-flex ga-2 align-start">
            <v-text-field
              v-model="token"
              type="password"
              autocomplete="off"
              density="compact"
              variant="outlined"
              :label="t('midata.settings.tokenLabel')"
              :disabled="!inTauri"
              hide-details="auto"
              data-testid="midata-token"
            />
            <v-btn :disabled="!inTauri || !token.trim()" :loading="md.busy.value" data-testid="midata-token-save" @click="saveToken">
              {{ t('midata.settings.tokenSave') }}
            </v-btn>
          </div>
          <div class="text-caption mt-1 mb-4">{{ t('midata.settings.tokenHint') }}</div>

          <v-text-field
            v-model="personId"
            :label="t('midata.settings.personId')"
            :hint="t('midata.settings.personIdHint')"
            persistent-hint
            density="compact"
            variant="outlined"
            inputmode="numeric"
            data-testid="midata-personid"
            @blur="saveSettings"
          />
          <div class="d-flex align-center ga-3 mt-2">
            <v-btn variant="tonal" size="small" @click="saveSettings">{{ t('common.save') }}</v-btn>
            <span v-if="saved" class="text-caption text-success">{{ t('midata.settings.saved') }}</span>
          </div>

          <v-alert v-if="md.error.value" type="error" variant="tonal" density="compact" class="mt-3" :text="md.error.value" />
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12" md="8" xl="6">
      <v-expansion-panels variant="accordion">
        <v-expansion-panel data-testid="midata-diag">
          <v-expansion-panel-title>{{ t('midata.settings.diag.title') }}</v-expansion-panel-title>
          <v-expansion-panel-text>
            <p class="text-medium-emphasis mb-3">{{ t('midata.settings.diag.intro') }}</p>
            <div class="d-flex flex-wrap ga-2 align-start">
              <v-text-field v-model="diagEvent" :label="t('midata.settings.diag.eventId')" density="compact" variant="outlined" hide-details style="max-width: 180px" />
              <v-text-field v-model="diagGroup" :label="t('midata.settings.diag.groupId')" density="compact" variant="outlined" hide-details style="max-width: 200px" />
              <v-btn :disabled="!inTauri || !diagEvent.trim()" :loading="md.busy.value" data-testid="midata-probe" @click="runProbe">
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
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-col>
  </v-row>
</template>
