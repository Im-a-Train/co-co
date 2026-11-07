<script setup lang="ts">
/** Review status chip for the camp header; the menu offers only the allowed transitions. */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRounds } from '@/composables/useRounds'
import { allowedTransitions, reviewStatusColor } from '@/domain/rounds'
import type { Iri, ReviewStatus } from '@/domain/types'

const props = defineProps<{ campIri: Iri }>()
const { t } = useI18n()
const r = useRounds(() => props.campIri)
const error = ref<string | null>(null)

onMounted(() => void r.load())
watch(
  () => props.campIri,
  () => void r.load(),
)

const current = computed<ReviewStatus>(() => r.review.value?.status ?? 'neu')
const options = computed(() => allowedTransitions(current.value))

async function set(status: ReviewStatus) {
  error.value = null
  try {
    await r.setStatus(status)
  } catch {
    error.value = t('rounds.errors.invalidTransition')
  }
}
</script>

<template>
  <div class="d-flex align-center ga-2">
    <v-menu>
      <template #activator="{ props: menu }">
        <v-chip
          v-bind="menu"
          :color="reviewStatusColor(current)"
          variant="flat"
          prepend-icon="mdi-clipboard-check-outline"
          append-icon="mdi-menu-down"
          :aria-label="t('rounds.status.title')"
        >
          {{ t(`reviewStatus.${current}`) }}
        </v-chip>
      </template>
      <v-list density="compact">
        <v-list-subheader>{{ t('rounds.status.setTo') }}</v-list-subheader>
        <v-list-item v-for="s in options" :key="s" :title="t(`reviewStatus.${s}`)" @click="set(s)" />
        <v-list-item v-if="!options.length" :title="t('rounds.status.noTransitions')" disabled />
      </v-list>
    </v-menu>
    <span v-if="error" class="text-caption text-error">{{ error }}</span>
  </div>
</template>
