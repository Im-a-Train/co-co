<script setup lang="ts">
/** Settings > Verbindungen: eCamp (instance + session), data store, MiData and NDS in one place. */
import { useI18n } from 'vue-i18n'
import InstanceCard from '@/components/InstanceCard.vue'
import SessionCard from '@/components/SessionCard.vue'
import DataResetDialog from '@/components/storage/DataResetDialog.vue'
import DataStoreCard from '@/components/storage/DataStoreCard.vue'
import MidataSection from '@/components/settings/MidataSection.vue'
import NdsSection from '@/components/settings/NdsSection.vue'
import { isTauri } from '@/lib/tauri'

const { t } = useI18n()
const inTauri = isTauri()
</script>

<template>
  <div>
    <h3 class="text-subtitle-1 font-weight-bold mb-2">{{ t('settings.connections.ecamp') }}</h3>
    <v-row class="mb-4">
      <v-col cols="12" md="6" xl="4">
        <InstanceCard :disabled="!inTauri" />
      </v-col>
      <v-col cols="12" md="6" xl="4">
        <SessionCard />
      </v-col>
      <v-col cols="12" md="6" xl="4">
        <DataStoreCard />
      </v-col>
    </v-row>
    <DataResetDialog />

    <div id="midata" class="mb-4">
      <h3 class="text-subtitle-1 font-weight-bold mb-2">{{ t('settings.connections.midata') }}</h3>
      <MidataSection />
    </div>

    <div id="nds">
      <h3 class="text-subtitle-1 font-weight-bold mb-2">{{ t('settings.connections.nds') }}</h3>
      <NdsSection />
    </div>
  </div>
</template>
