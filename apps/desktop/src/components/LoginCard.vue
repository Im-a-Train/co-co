<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInstances } from '@/composables/useInstances'
import { useSession } from '@/composables/useSession'

defineProps<{ disabled?: boolean }>()

const { t } = useI18n()
const { selected } = useInstances()
const { busy, lastError, isLoggedIn, openLoginWindow, passwordLogin } = useSession()

const identifier = ref('')
const password = ref('')
const showPassword = ref(false)

async function submitPassword(): Promise<void> {
  if (!identifier.value || !password.value) return
  const ok = await passwordLogin(selected.value.baseUrl, identifier.value, password.value)
  // Never keep the password around longer than needed.
  password.value = ''
  if (ok) identifier.value = ''
}
</script>

<template>
  <v-card class="h-100">
    <v-card-item prepend-icon="mdi-login">
      <v-card-title>{{ t('login.title') }}</v-card-title>
      <v-card-subtitle>{{ t('login.subtitle', { url: selected.baseUrl }) }}</v-card-subtitle>
    </v-card-item>

    <v-card-text>
      <p class="text-body-2 mb-4">{{ t('login.explanation') }}</p>

      <v-btn
        block
        size="large"
        color="primary"
        variant="flat"
        prepend-icon="mdi-open-in-app"
        :loading="busy === 'login'"
        :disabled="disabled || isLoggedIn || busy !== null"
        @click="openLoginWindow(selected.baseUrl)"
      >
        {{ t('login.webview') }}
      </v-btn>
      <p class="text-caption text-medium-emphasis mt-2">{{ t('login.webviewHint') }}</p>

      <v-alert v-if="lastError" type="error" variant="tonal" density="compact" class="mt-3">
        {{ lastError }}
      </v-alert>

      <v-expansion-panels class="mt-4" variant="accordion">
        <v-expansion-panel>
          <v-expansion-panel-title>
            <v-icon icon="mdi-form-textbox-password" class="me-2" size="small" />
            {{ t('login.password.title') }}
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <p class="text-caption text-medium-emphasis mb-3">{{ t('login.password.hint') }}</p>
            <v-form @submit.prevent="submitPassword">
              <v-text-field
                v-model="identifier"
                :label="t('login.password.identifier')"
                autocomplete="username"
                prepend-inner-icon="mdi-email-outline"
                :disabled="disabled || isLoggedIn"
              />
              <v-text-field
                v-model="password"
                :label="t('login.password.password')"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                prepend-inner-icon="mdi-lock-outline"
                :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
                :disabled="disabled || isLoggedIn"
                @click:append-inner="showPassword = !showPassword"
              />
              <v-btn
                type="submit"
                color="secondary"
                variant="tonal"
                prepend-icon="mdi-login-variant"
                :loading="busy === 'password'"
                :disabled="disabled || isLoggedIn || !identifier || !password || busy !== null"
              >
                {{ t('login.password.submit') }}
              </v-btn>
            </v-form>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-card-text>
  </v-card>
</template>
