<script setup lang="ts">
/** «Aus NDS übernehmen»: field | current value | NDS | accept checkbox. */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate } from '@/components/midata/format'
import type { NdsFieldDiff, NdsFieldValue } from '@/domain/nds'
import type { NdsField } from '@/domain/types'
import { ndsPreChecked, ndsValueKey } from './format'

const props = defineProps<{ modelValue: boolean; diffs: NdsFieldDiff[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; apply: [fields: NdsField[]] }>()
const { t } = useI18n()

const checked = ref<Set<NdsField>>(new Set())
watch(
  () => [props.modelValue, props.diffs] as const,
  ([open]) => {
    if (open) checked.value = new Set(props.diffs.filter(ndsPreChecked).map((d) => d.field))
  },
  { immediate: true },
)

function toggle(f: NdsField, on: boolean): void {
  const next = new Set(checked.value)
  if (on) next.add(f)
  else next.delete(f)
  checked.value = next
}
function show(v: NdsFieldValue): string {
  const k = ndsValueKey(v)
  if (!k) return '–'
  if ('key' in k) return t(`nds.adopt.values.${k.key}`)
  return formatDate(k.text) || k.text
}
const selectable = (d: NdsFieldDiff): boolean => d.ndsValue !== null && !d.same
</script>

<template>
  <v-dialog :model-value="modelValue" scroll-strategy="none" max-width="720" @update:model-value="emit('update:modelValue', $event)">
    <v-card data-testid="nds-adopt">
      <v-card-title>{{ t('nds.adopt.title') }}</v-card-title>
      <v-card-text>
        <p class="text-medium-emphasis mb-3">{{ t('nds.adopt.intro') }}</p>
        <v-table density="compact">
          <thead>
            <tr>
              <th>{{ t('nds.adopt.field') }}</th>
              <th>{{ t('nds.adopt.current') }}</th>
              <th>{{ t('nds.adopt.nds') }}</th>
              <th class="text-center">{{ t('nds.adopt.accept') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in diffs" :key="d.field" :data-testid="`nds-adopt-row-${d.field}`">
              <td>
                {{ t(`camps.inputs.fields.${d.field}`) }}
                <div v-if="d.field === 'ndsRegisteredOn'" class="text-caption text-medium-emphasis">{{ t('nds.adopt.registeredOnHint') }}</div>
              </td>
              <td>
                <span v-if="ndsValueKey(d.currentValue)">{{ show(d.currentValue) }}</span>
                <span v-else class="text-medium-emphasis">{{ t('nds.adopt.empty') }}</span>
              </td>
              <td>
                {{ show(d.ndsValue) }}
                <v-chip v-if="d.same && d.ndsValue !== null" size="x-small" variant="tonal" class="ml-1">{{ t('nds.adopt.same') }}</v-chip>
              </td>
              <td class="text-center">
                <v-checkbox-btn
                  :model-value="checked.has(d.field)"
                  :disabled="!selectable(d)"
                  :data-testid="`nds-adopt-check-${d.field}`"
                  :aria-label="t(`camps.inputs.fields.${d.field}`)"
                  @update:model-value="(v: boolean | null) => toggle(d.field, v === true)"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="emit('update:modelValue', false)">{{ t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :disabled="checked.size === 0" data-testid="nds-adopt-apply" @click="emit('apply', [...checked])">
          {{ t('nds.adopt.apply', { n: checked.size }) }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
