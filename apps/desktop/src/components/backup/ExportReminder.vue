<script setup lang="ts">
/** Banner shown after a round was started/closed until a backup was exported. */
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBackup } from './useBackup'

const { t } = useI18n()
const b = useBackup()
onMounted(() => void b.refresh())
</script>

<template>
  <v-alert v-if="b.reminderDue.value" type="warning" variant="tonal" density="compact" icon="mdi-content-save-alert-outline">
    {{ t('backup.reminder.text') }}
    <template #append>
      <v-btn size="small" variant="text" class="me-1" to="/einstellungen#backup">{{ t('backup.reminder.settings') }}</v-btn>
      <v-btn size="small" variant="flat" color="warning" :loading="b.busy.value" @click="b.exportBackup">
        {{ t('backup.reminder.action') }}
      </v-btn>
    </template>
  </v-alert>
</template>
