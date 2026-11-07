<script setup lang="ts">
/**
 * Camp frame: header (title, dates, reload) + tabs + child view. FROZEN (architect).
 * Loads CampFacts once per camp via useCampFacts (data builder); child views use the same handle.
 */
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampRoute } from '@/composables/useCampRoute'
import ExportReminder from '@/components/backup/ExportReminder.vue'
import ReviewStatusMenu from '@/components/rounds/ReviewStatusMenu.vue'
import { CAMP_TABS } from '@/router'

const { t } = useI18n()
const { campId, campIri } = useCampRoute()
const { facts, loading, error, progress, load } = useCampFacts(campIri)

const title = computed(() => facts.value?.camp.title ?? campId.value)
const dates = computed(() => {
  const c = facts.value?.camp
  if (!c?.start || !c.end) return null
  const f = (d: string) => d.split('-').reverse().join('.')
  return `${f(c.start)} – ${f(c.end)}`
})

watch(campIri, () => void load(), { immediate: true })
</script>

<template>
  <div>
    <div class="d-flex align-center flex-wrap ga-2 mb-2">
      <v-btn :to="{ name: 'camps' }" icon="mdi-arrow-left" variant="text" :aria-label="t('campLayout.backToList')" />
      <div>
        <div class="text-h5">{{ title }}</div>
        <div v-if="dates" class="text-body-2 text-medium-emphasis">{{ dates }}</div>
      </div>
      <ReviewStatusMenu :camp-iri="campIri" class="ms-2" />
      <v-spacer />
      <v-btn
        variant="tonal"
        prepend-icon="mdi-refresh"
        :loading="loading"
        :text="t('common.reload')"
        @click="load(true)"
      />
    </div>

    <ExportReminder class="mb-2" />

    <v-progress-linear
      v-if="loading"
      :model-value="progress && progress.total ? (100 * progress.done) / progress.total : undefined"
      :indeterminate="!progress || !progress.total"
      class="mb-2"
    />
    <v-alert v-if="error" type="error" variant="tonal" class="mb-2" :title="t('campLayout.loadFailed')" :text="error" />

    <v-tabs density="comfortable" show-arrows class="mb-4">
      <v-tab
        v-for="tab in CAMP_TABS"
        :key="tab.name"
        :to="{ name: tab.name, params: { campId } }"
        :prepend-icon="tab.icon"
        :text="t(tab.titleKey)"
      />
    </v-tabs>

    <router-view />
  </div>
</template>
