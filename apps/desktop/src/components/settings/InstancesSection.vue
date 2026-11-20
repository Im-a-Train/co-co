<script setup lang="ts">
/** Settings > Konto: who is logged in, which instance, «Abmelden». Technical details live in DiagnosticsSection. */
import SessionCard from '@/components/SessionCard.vue'
import DataResetDialog from '@/components/storage/DataResetDialog.vue'
</script>

<template>
  <div>
    <v-row>
      <v-col cols="12" md="8" xl="6">
        <SessionCard compact variant="outlined" />
      </v-col>
    </v-row>
    <DataResetDialog />
  </div>
</template>
