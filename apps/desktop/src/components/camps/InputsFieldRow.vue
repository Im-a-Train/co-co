<script setup lang="ts">
/**
 * One field of the Lager-Angaben form: the control, an optional MiData badge, inline validation messages and
 * a one-sentence purpose with a small «{n} Regeln» menu that links to the rule catalog (PREP-15).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import MidataBadge from '@/components/midata/MidataBadge.vue'

interface Item {
  value: string
  title: string
}
const props = defineProps<{
  fieldKey: string
  kind: 'count' | 'select'
  modelValue: string | number | null
  /** Items of a `select`. */
  items?: Item[]
  clearable?: boolean
  /** Purpose sentence key suffix (camps.inputs.purpose.<purposeKey>), defaults to the field key. */
  purposeKey?: string
  ruleIds?: readonly string[]
  ruleTitles?: ReadonlyMap<string, string>
  midataSince?: string | null
  errorMessages?: string[]
  /** Label key suffix (camps.inputs.fields.<labelKey>), defaults to the field key. */
  labelKey?: string
  testId?: string
  /** In «Fehlt noch für die Prüfung»: the finding that asked for this input is gone. */
  done?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()
const { t } = useI18n()

const label = computed(() => t(`camps.inputs.fields.${props.labelKey ?? props.fieldKey}`))
const purpose = computed(() => t(`camps.inputs.purpose.${props.purposeKey ?? props.fieldKey}`))
const rules = computed(() => (props.ruleIds ?? []).map((id) => ({ id, title: props.ruleTitles?.get(id) ?? id })))
</script>

<template>
  <div class="inputs-field">
    <v-text-field
      v-if="kind === 'count'"
      :model-value="modelValue ?? ''"
      type="number"
      min="0"
      :label="label"
      :error-messages="errorMessages"
      hide-details="auto"
      variant="outlined"
      density="comfortable"
      :data-testid="testId"
      @update:model-value="(v: string) => emit('update:modelValue', v)"
    >
      <template v-if="midataSince" #append-inner><MidataBadge :since="midataSince" /></template>
    </v-text-field>
    <v-select
      v-else
      :model-value="modelValue"
      :items="items"
      :label="label"
      :clearable="clearable"
      :error-messages="errorMessages"
      hide-details="auto"
      variant="outlined"
      density="comfortable"
      :data-testid="testId"
      @update:model-value="(v: string | number | null) => emit('update:modelValue', v === null ? null : String(v))"
    >
      <template v-if="midataSince" #append-inner><MidataBadge :since="midataSince" /></template>
    </v-select>
    <div class="text-caption text-medium-emphasis mt-1 d-flex flex-wrap align-center">
      <span v-if="done" class="text-success mr-1" :data-testid="`input-done-${fieldKey}`">
        <v-icon icon="mdi-check" size="x-small" class="mr-1" />{{ t('camps.inputs.missingResolved') }} ·
      </span>
      <span>{{ purpose }}</span>
      <v-menu v-if="rules.length" location="bottom start">
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            variant="text"
            size="x-small"
            density="compact"
            class="ml-1 text-none"
            :title="t('camps.inputs.rulesLinkTitle')"
            :data-testid="`input-rules-${fieldKey}`"
          >
            {{ t('camps.inputs.rulesLink', { n: rules.length }, rules.length) }}
          </v-btn>
        </template>
        <v-list density="compact">
          <v-list-item v-for="r in rules" :key="r.id" :to="{ name: 'rules', query: { rule: r.id } }" :title="r.title" />
        </v-list>
      </v-menu>
    </div>
  </div>
</template>
