<script setup lang="ts">
/** Settings > Backup: JSON export/import of all co-co data. */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBackup } from '@/components/backup/useBackup'
import type { ImportMode } from '@/domain/backup'

const { t, d } = useI18n()
const b = useBackup()
const mode = ref<ImportMode>('merge')
const savedPath = ref<string | null>(null)

onMounted(() => void b.refresh())

const lastExportText = computed(() =>
  b.lastExportAt.value
    ? t('backup.lastExport', { date: d(new Date(b.lastExportAt.value), 'dateTime') })
    : t('backup.neverExported'),
)
const errorText = computed(() =>
  b.errorCode.value ? t(`backup.errors.${b.errorCode.value}`, { detail: b.errorDetail.value ?? '' }) : null,
)
const previewRows = computed(() =>
  Object.entries(b.pending.value?.counts ?? {})
    .filter(([, n]) => n > 0)
    .map(([name, n]) => ({ name, label: t(`backup.tableNames.${name}`), n })),
)
const doneCount = computed(() => Object.values(b.report.value?.written ?? {}).reduce((s, n) => s + n, 0))

function reload() {
  window.location.reload()
}
async function doExport() {
  savedPath.value = await b.exportBackup()
}
async function doImport() {
  await b.confirmImport(mode.value)
}
</script>

<template>
  <div>
    <p class="text-body-2 text-medium-emphasis mb-3">{{ t('backup.intro') }}</p>
    <v-alert type="warning" variant="tonal" density="compact" class="mb-3" :text="t('backup.unencryptedWarning')" data-testid="backup-unencrypted-warning" />
    <div class="text-body-2 mb-3">{{ lastExportText }}</div>

    <div class="d-flex flex-wrap ga-2 mb-3">
      <v-btn color="primary" prepend-icon="mdi-export" density="comfortable" :loading="b.busy.value" @click="doExport">
        {{ t('backup.export') }}
      </v-btn>
      <v-btn variant="tonal" prepend-icon="mdi-import" density="comfortable" :disabled="b.busy.value" @click="b.chooseImportFile">
        {{ t('backup.import') }}
      </v-btn>
    </div>

    <v-switch
      v-model="b.omitRedDerived.value"
      :label="t('backup.omitMidata')"
      density="compact"
      hide-details
      color="primary"
    />

    <v-alert v-if="savedPath" type="success" variant="tonal" density="compact" class="mt-3" :text="t('backup.exported', { path: savedPath })" />
    <v-alert v-if="errorText" type="error" variant="tonal" density="compact" class="mt-3" :text="errorText" />

    <v-card v-if="b.pending.value" variant="outlined" class="mt-3">
      <v-card-title class="text-subtitle-1">{{ t('backup.preview.title') }}</v-card-title>
      <v-card-text>
        <div class="text-body-2">{{ t('backup.preview.file', { name: b.pending.value.fileName }) }}</div>
        <div class="text-body-2 mb-2">
          {{ t('backup.preview.exportedAt', { date: d(new Date(b.pending.value.data.exportedAt), 'dateTime') }) }}
        </div>
        <div class="text-caption text-medium-emphasis">{{ t('backup.preview.tables') }}</div>
        <div class="d-flex flex-wrap ga-1 mb-2">
          <v-chip v-for="r in previewRows" :key="r.name" size="small" label>{{ r.label }}: {{ r.n }}</v-chip>
        </div>
        <v-alert
          v-if="b.pending.value.unknownTables.length"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-2"
          :text="t('backup.preview.unknown', { names: b.pending.value.unknownTables.join(', ') })"
        />
        <div class="text-caption text-medium-emphasis">{{ t('backup.preview.mode') }}</div>
        <v-radio-group v-model="mode" density="compact" hide-details>
          <v-radio value="merge" :label="t('backup.preview.merge')" />
          <v-radio value="replace" :label="t('backup.preview.replace')" />
        </v-radio-group>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" @click="b.cancelImport">{{ t('backup.preview.cancel') }}</v-btn>
        <v-spacer />
        <v-btn
          :color="mode === 'replace' ? 'error' : 'primary'"
          variant="flat"
          :loading="b.busy.value"
          @click="doImport"
        >
          {{ mode === 'replace' ? t('backup.preview.confirmReplace') : t('backup.preview.confirmMerge') }}
        </v-btn>
      </v-card-actions>
    </v-card>

    <v-alert v-if="b.report.value" type="success" variant="tonal" density="compact" class="mt-3">
      {{ t('backup.done', { count: doneCount }) }}
      <template #append>
        <v-btn size="small" variant="text" @click="reload">{{ t('backup.reload') }}</v-btn>
      </template>
    </v-alert>
  </div>
</template>
