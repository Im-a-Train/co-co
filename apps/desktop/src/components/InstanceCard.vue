<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInstances } from '@/composables/useInstances'
import { useSession } from '@/composables/useSession'

defineProps<{ disabled?: boolean }>()

const { t } = useI18n()
const { instances, selected, selectedId, selectedInfo, discovering, discoverError, select, addCustom, removeCustom, discover } =
  useInstances()
const { isLoggedIn } = useSession()

const items = computed(() =>
  instances.value.map((i) => ({
    value: i.id,
    title: i.labelKey ? t(i.labelKey) : i.label,
    subtitle: i.baseUrl,
  })),
)

const model = computed({
  get: () => selectedId.value,
  set: (id: string) => select(id),
})

const showAdd = ref(false)
const newUrl = ref('')
const newLabel = ref('')
const addError = ref<string | null>(null)

function submitAdd(): void {
  const res = addCustom(newUrl.value, newLabel.value)
  if (!res.ok) {
    addError.value = t(`instance.error.${res.reason}`)
    return
  }
  addError.value = null
  newUrl.value = ''
  newLabel.value = ''
  showAdd.value = false
}
</script>

<template>
  <v-card class="h-100">
    <v-card-item prepend-icon="mdi-server-network">
      <v-card-title>{{ t('instance.title') }}</v-card-title>
      <v-card-subtitle>{{ t('instance.subtitle') }}</v-card-subtitle>
    </v-card-item>

    <v-card-text>
      <v-select
        v-model="model"
        :items="items"
        :label="t('instance.select')"
        :disabled="isLoggedIn"
        :hint="isLoggedIn ? t('instance.lockedWhileLoggedIn') : selected.baseUrl"
        persistent-hint
        item-title="title"
        item-value="value"
      >
        <template #item="{ props: itemProps, item }">
          <v-list-item v-bind="itemProps" :subtitle="item.raw.subtitle" />
        </template>
      </v-select>

      <div class="d-flex flex-wrap ga-2 mt-4">
        <v-btn
          color="primary"
          variant="tonal"
          prepend-icon="mdi-magnify-scan"
          :loading="discovering"
          :disabled="disabled"
          @click="discover()"
        >
          {{ t('instance.check') }}
        </v-btn>
        <v-btn variant="text" prepend-icon="mdi-plus" :disabled="isLoggedIn" @click="showAdd = !showAdd">
          {{ t('instance.addCustom') }}
        </v-btn>
        <v-btn
          v-if="!selected.builtIn"
          variant="text"
          color="error"
          prepend-icon="mdi-delete-outline"
          :disabled="isLoggedIn"
          @click="removeCustom(selected.id)"
        >
          {{ t('instance.remove') }}
        </v-btn>
      </div>

      <v-expand-transition>
        <v-form v-if="showAdd" class="mt-4" @submit.prevent="submitAdd">
          <v-text-field
            v-model="newUrl"
            :label="t('instance.customUrl')"
            placeholder="https://ecamp.example.ch"
            :error-messages="addError ?? undefined"
            autocomplete="off"
            spellcheck="false"
          />
          <v-text-field v-model="newLabel" :label="t('instance.customLabel')" autocomplete="off" />
          <v-btn type="submit" color="primary" variant="flat">{{ t('instance.add') }}</v-btn>
        </v-form>
      </v-expand-transition>

      <v-alert v-if="discoverError" type="error" variant="tonal" density="compact" class="mt-4">
        {{ t('instance.discoverFailed') }}: {{ discoverError }}
      </v-alert>

      <v-table v-if="selectedInfo" density="compact" class="mt-4 info-table">
        <tbody>
          <tr>
            <th>{{ t('instance.info.apiRoot') }}</th>
            <td class="mono">{{ selectedInfo.apiRoot }}</td>
          </tr>
          <tr>
            <th>{{ t('instance.info.cookiePrefix') }}</th>
            <td class="mono">{{ selectedInfo.cookiePrefix }}</td>
          </tr>
          <tr>
            <th>{{ t('instance.info.version') }}</th>
            <td class="mono">{{ selectedInfo.version ?? t('common.unknown') }}</td>
          </tr>
          <tr>
            <th>{{ t('instance.info.comments') }}</th>
            <td>{{ selectedInfo.featureComments ? t('common.yes') : t('common.no') }}</td>
          </tr>
          <tr>
            <th>{{ t('instance.info.oauthProviders') }}</th>
            <td>
              <template v-if="selectedInfo.oauthProviders.length">
                <v-chip v-for="p in selectedInfo.oauthProviders" :key="p" size="x-small" class="me-1 mb-1">{{ p }}</v-chip>
              </template>
              <span v-else>{{ t('common.none') }}</span>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.info-table th {
  width: 40%;
  font-weight: 500;
  white-space: nowrap;
}
.mono {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 0.85em;
  word-break: break-all;
}
</style>
