<script setup lang="ts">
/** Settings > MiData: connection (login window or service token), own person id. The diagnosis lives in Fehlersuche. */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMidata } from '@/composables/useMidata'
import { isTauri } from '@/lib/tauri'
import { useSession } from '@/composables/useSession'

const { t } = useI18n()
const md = useMidata()
const inTauri = isTauri()
const session = useSession()
const showManual = ref(false)

const baseUrl = ref(md.baseUrl.value)
const personId = ref(md.personId.value ?? '')
const token = ref('')
const saved = ref(false)

onMounted(async () => {
  await md.init()
  baseUrl.value = md.baseUrl.value
  personId.value = md.personId.value ?? ''
  void md.detectSelf()
})
watch(() => [session.user.value?.email, md.status.value.connected], () => void md.detectSelf())
watch([baseUrl, personId], () => (saved.value = false))
watch(md.personId, (v) => {
  if (v && !personId.value) personId.value = v
})
/** The stored id equals the one detected from the login URL. */
const personIdDetected = computed(() => !!md.status.value.personId && md.status.value.personId === md.personId.value)
/** The stored id was found automatically (login URL or e-mail lookup). */
const autoDetected = computed(() => !!md.personId.value && (md.selfNickname.value !== null || personIdDetected.value))
const showField = computed(() => showManual.value || !autoDetected.value)

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
            <span v-if="md.viaEcamp.value" class="text-caption" data-testid="midata-via-ecamp">{{ t('midata.settings.status.viaEcamp') }}</span>
            <span v-if="md.status.value.cookieNames.length" class="text-caption text-medium-emphasis">
              {{ t('midata.settings.status.cookies', { names: md.status.value.cookieNames.join(', ') }) }}
            </span>
          </div>

          <div class="d-flex align-center flex-wrap ga-2">
            <v-btn
              :color="md.status.value.connected ? undefined : 'primary'"
              :variant="md.status.value.connected ? 'text' : 'flat'"
              :disabled="!inTauri"
              :loading="md.busy.value"
              data-testid="midata-login"
              @click="login"
            >
              {{ md.status.value.connected ? t('midata.settings.relogin') : t('midata.settings.login') }}
            </v-btn>
            <v-btn v-if="md.status.value.connected" variant="tonal" :disabled="!inTauri" data-testid="midata-logout" @click="md.logout()">
              {{ t('midata.settings.logout') }}
            </v-btn>
          </div>
          <div class="text-caption mt-1">{{ inTauri ? t('midata.settings.loginHint') : t('midata.settings.notInApp') }}</div>
          <div class="text-caption text-medium-emphasis mb-4" data-testid="midata-oauth-help">{{ t('midata.settings.oauthHelp') }}</div>

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

          <div v-if="autoDetected" class="d-flex align-center flex-wrap ga-2 mb-2" data-testid="midata-personid-auto">
            <v-icon icon="mdi-account-check" color="success" size="small" />
            <span>{{ t('midata.settings.personIdAuto', { who: md.selfNickname.value || t('midata.settings.personIdYou'), id: md.personId.value }) }}</span>
            <v-btn size="x-small" variant="text" data-testid="midata-personid-override" @click="showManual = !showManual">{{ t('midata.settings.personIdOverride') }}</v-btn>
          </div>
          <v-alert
            v-else-if="md.status.value.connected && md.selfProblem.value"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-2"
            data-testid="midata-personid-problem"
          >
            {{ t(`midata.settings.personIdProblem.${md.selfProblem.value}`) }}
          </v-alert>
          <v-text-field
            v-if="showField"
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
          <div v-if="saved" class="text-caption text-success mt-2" data-testid="midata-saved">{{ t('midata.settings.saved') }}</div>

          <v-alert v-if="md.error.value" type="error" variant="tonal" density="compact" class="mt-3" :text="md.error.value" />
        </v-card-text>
      </v-card>
    </v-col>

  </v-row>
</template>
