<script setup lang="ts">
/** /verbindung: eCamp instance, login and session (M0 cards). OWNER: data builder. */
import { useI18n } from 'vue-i18n'
import InstanceCard from '@/components/InstanceCard.vue'
import LoginCard from '@/components/LoginCard.vue'
import SessionCard from '@/components/SessionCard.vue'
import { isTauri } from '@/lib/tauri'

const { t } = useI18n()
const inTauri = isTauri()
</script>

<template>
  <div>
    <h1 class="text-h5 mb-4">{{ t('connection.title') }}</h1>
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
    </v-row>
  </div>
</template>
