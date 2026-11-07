<script setup lang="ts">
/** Settings > Instanzen: eCamp instance management (M0 InstanceCard). OWNER: data builder. */
import InstanceCard from '@/components/InstanceCard.vue'
import { isTauri } from '@/lib/tauri'

const inTauri = isTauri()
</script>

<template>
  <v-row>
    <v-col cols="12" md="8" xl="6">
      <InstanceCard :disabled="!inTauri" />
    </v-col>
  </v-row>
</template>
