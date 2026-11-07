<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import CampsCard from '@/components/CampsCard.vue'
import InstanceCard from '@/components/InstanceCard.vue'
import LoginCard from '@/components/LoginCard.vue'
import SessionCard from '@/components/SessionCard.vue'
import SpikeProtocolCard from '@/components/SpikeProtocolCard.vue'
import { useSession } from '@/composables/useSession'
import { isTauri } from '@/lib/tauri'

const { t } = useI18n()
const inTauri = isTauri()
const { isLoggedIn, init } = useSession()

onMounted(() => {
  if (inTauri) void init()
})
</script>

<template>
  <v-app>
    <v-app-bar color="primary" density="comfortable" flat>
      <template #prepend>
        <v-icon icon="mdi-tent" class="ms-2" />
      </template>
      <v-app-bar-title>
        <span class="font-weight-bold">{{ t('app.name') }}</span>
        <span class="text-medium-emphasis"> · {{ t('app.subtitle') }}</span>
      </v-app-bar-title>
      <template #append>
        <v-chip
          class="me-2"
          variant="flat"
          :color="isLoggedIn ? 'success' : 'surface'"
          :prepend-icon="isLoggedIn ? 'mdi-account-check' : 'mdi-account-off-outline'"
          size="small"
        >
          {{ isLoggedIn ? t('app.status.loggedIn') : t('app.status.loggedOut') }}
        </v-chip>
        <v-chip class="me-3" variant="outlined" size="small">{{ t('app.milestone') }}</v-chip>
      </template>
    </v-app-bar>

    <v-main>
      <v-container fluid class="cockpit">
        <v-alert
          v-if="!inTauri"
          type="warning"
          variant="tonal"
          icon="mdi-monitor-off"
          class="mb-4"
          :title="t('notTauri.title')"
          :text="t('notTauri.text')"
        />

        <v-row>
          <v-col cols="12" md="6" xl="4">
            <InstanceCard :disabled="!inTauri" />
          </v-col>
          <v-col cols="12" md="6" xl="4">
            <LoginCard :disabled="!inTauri" />
          </v-col>
          <v-col cols="12" md="6" xl="4">
            <SessionCard />
          </v-col>
          <v-col cols="12" md="6" xl="5">
            <CampsCard />
          </v-col>
          <v-col cols="12" xl="7">
            <SpikeProtocolCard />
          </v-col>
        </v-row>
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
.cockpit {
  max-width: 1600px;
}
</style>
