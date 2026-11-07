<script setup lang="ts">
/** «Aus MiData übernehmen»: field | current value | MiData | accept checkbox. */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MidataFieldDiff, MidataFieldValue } from '@/domain/midata'
import type { MidataField } from '@/domain/types'
import { preChecked, valueKey } from './format'

const props = defineProps<{ modelValue: boolean; diffs: MidataFieldDiff[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; apply: [fields: MidataField[]] }>()
const { t } = useI18n()

const checked = ref<Set<MidataField>>(new Set())
watch(
  () => [props.modelValue, props.diffs] as const,
  ([open]) => {
    if (open) checked.value = new Set(props.diffs.filter(preChecked).map((d) => d.field))
  },
  { immediate: true },
)

function toggle(f: MidataField, on: boolean): void {
  const next = new Set(checked.value)
  if (on) next.add(f)
  else next.delete(f)
  checked.value = next
}
function show(v: MidataFieldValue): string {
  const k = valueKey(v)
  if (!k) return '–'
  return 'key' in k ? t(`midata.adopt.values.${k.key}`) : k.text
}
const selectable = (d: MidataFieldDiff): boolean => d.midataValue !== null && !d.same
const count = computed(() => checked.value.size)
</script>

<template>
  <v-dialog :model-value="modelValue" scroll-strategy="none" max-width="720" @update:model-value="emit('update:modelValue', $event)">
    <v-card data-testid="midata-adopt">
      <v-card-title>{{ t('midata.adopt.title') }}</v-card-title>
      <v-card-text>
        <p class="text-medium-emphasis mb-3">{{ t('midata.adopt.intro') }}</p>
        <v-table density="compact">
          <thead>
            <tr>
              <th>{{ t('midata.adopt.field') }}</th>
              <th>{{ t('midata.adopt.current') }}</th>
              <th>{{ t('midata.adopt.midata') }}</th>
              <th class="text-center">{{ t('midata.adopt.accept') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in diffs" :key="d.field" :data-testid="`adopt-row-${d.field}`">
              <td>{{ t(`camps.inputs.fields.${d.field}`) }}</td>
              <td>
                <span v-if="valueKey(d.currentValue)">{{ show(d.currentValue) }}</span>
                <span v-else class="text-medium-emphasis">{{ t('midata.adopt.empty') }}</span>
              </td>
              <td>
                {{ show(d.midataValue) }}
                <v-chip v-if="d.same && d.midataValue !== null" size="x-small" variant="tonal" class="ml-1">{{ t('midata.adopt.same') }}</v-chip>
              </td>
              <td class="text-center">
                <v-checkbox-btn
                  :model-value="checked.has(d.field)"
                  :disabled="!selectable(d)"
                  :data-testid="`adopt-check-${d.field}`"
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
        <v-btn color="primary" variant="flat" :disabled="count === 0" data-testid="adopt-apply" @click="emit('apply', [...checked])">
          {{ t('midata.adopt.apply', { n: count }) }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
