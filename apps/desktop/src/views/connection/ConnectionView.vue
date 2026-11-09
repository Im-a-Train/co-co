<script setup lang="ts">
/**
 * /verbindung: only the eCamp login (instance choice is a compact line inside the card).
 * The data store card appears here when the store could not be opened; after login the
 * session card plus links to the camps and to the connection settings are shown.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import LoginCard from '@/components/LoginCard.vue'
import SessionCard from '@/components/SessionCard.vue'
import DataResetDialog from '@/components/storage/DataResetDialog.vue'
import DataStoreCard from '@/components/storage/DataStoreCard.vue'
import { useDataStore } from '@/composables/useDataStore'
import { useSession } from '@/composables/useSession'
import { isTauri } from '@/lib/tauri'

const { t } = useI18n()
const inTauri = isTauri()
const { isLoggedIn } = useSession()
const store = useDataStore()

/** Unlocking runs automatically after login; only a failed unlock needs the coach's attention here. */
const storeProblem = computed(() => store.state.value === 'error' || store.state.value === 'keyLost')
</script>

<template>
  <div class="mx-auto connection-col">
    <h1 class="text-h5 mb-4">{{ t('connection.title') }}</h1>

    <template v-if="!isLoggedIn">
      <LoginCard :disabled="!inTauri" />
    </template>
    <template v-else>
      <v-alert type="success" variant="tonal" icon="mdi-account-check" class="mb-4" :title="t('connection.loggedInTitle')" :text="t('connection.loggedInText')">
        <template #append>
          <div class="d-flex flex-column ga-2">
            <v-btn color="primary" variant="flat" to="/lager" prepend-icon="mdi-tent" data-testid="connection-to-camps">{{ t('connection.toCamps') }}</v-btn>
            <v-btn variant="tonal" to="/einstellungen#instanzen" prepend-icon="mdi-cog-outline" data-testid="connection-manage">{{ t('connection.manage') }}</v-btn>
          </div>
        </template>
      </v-alert>
      <SessionCard />
    </template>

    <div v-if="storeProblem" class="mt-4">
      <DataStoreCard />
    </div>
    <DataResetDialog />
  </div>
</template>

<style scoped>
.connection-col {
  max-width: 560px;
}
</style>
