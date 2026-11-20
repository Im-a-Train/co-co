<script setup lang="ts">
/** Update dialog (ADR 0018), mounted once in App.vue. Release notes are plain text (no v-html). */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppUpdate } from '@/composables/useAppUpdate'

const { t } = useI18n()
const u = useAppUpdate()

const percent = computed(() => {
  const p = u.progress.value
  if (!p || !p.total) return null
  return Math.min(100, Math.round((p.downloaded / p.total) * 100))
})
</script>

<template>
  <v-dialog :model-value="u.dialogOpen.value" persistent max-width="560" data-testid="update-dialog-root">
    <v-card v-if="u.info.value" data-testid="update-dialog">
      <v-card-title class="text-subtitle-1">{{ t('update.dialog.title') }}</v-card-title>
      <v-card-text>
        <p class="text-body-1 mb-3" data-testid="update-versions">
          {{ t('update.dialog.versions', { version: u.info.value.version ?? '', current: u.info.value.currentVersion }) }}
        </p>
        <template v-if="u.info.value.notes">
          <div class="text-subtitle-2 mb-1">{{ t('update.dialog.notesTitle') }}</div>
          <div
            class="text-body-2 pa-2 mb-3 rounded"
            style="white-space: pre-wrap; overflow-wrap: anywhere; max-height: 200px; overflow-y: auto; background: rgba(var(--v-theme-on-surface), 0.06)"
            data-testid="update-notes"
          >
            {{ u.info.value.notes }}
          </div>
        </template>
        <v-alert v-if="u.info.value.canInstall" type="info" variant="tonal" density="compact" class="mb-2">
          {{ t('update.dialog.installHint') }}
        </v-alert>
        <v-alert v-else type="warning" variant="tonal" density="compact" class="mb-2" data-testid="update-portable-hint">
          {{ t('update.dialog.portableHint') }}
        </v-alert>
        <div v-if="u.installing.value" class="mt-3" data-testid="update-progress">
          <div class="text-body-2 mb-1">
            {{ percent === null ? t('update.dialog.downloading') : t('update.dialog.downloadingPercent', { percent }) }}
          </div>
          <v-progress-linear :model-value="percent ?? 0" :indeterminate="percent === null" color="primary" height="6" rounded />
        </div>
        <v-alert v-if="u.installError.value" type="error" variant="tonal" density="compact" class="mt-3" data-testid="update-error">
          {{ u.installError.value }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-btn :disabled="u.installing.value" data-testid="update-skip" @click="u.skipVersion()">{{ t('update.dialog.skip') }}</v-btn>
        <v-spacer />
        <v-btn :disabled="u.installing.value" data-testid="update-later" @click="u.later()">{{ t('update.dialog.later') }}</v-btn>
        <v-btn
          v-if="u.info.value.canInstall"
          color="primary"
          variant="flat"
          :loading="u.installing.value"
          data-testid="update-install"
          @click="u.install()"
        >
          {{ t('update.dialog.install') }}
        </v-btn>
        <v-btn v-else color="primary" variant="flat" data-testid="update-open-release" @click="u.openRelease()">
          {{ t('update.dialog.openRelease') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
