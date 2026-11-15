<script setup lang="ts">
/**
 * Camp frame: header (title, dates, reload) + tabs + child view. Shared by all modules; change with care.
 * Loads CampFacts once per camp via useCampFacts; child views use the same handle.
 */
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampRoute } from '@/composables/useCampRoute'
import ConnectionStatusChips from '@/components/settings/ConnectionStatusChips.vue'
import CampSearch from '@/components/search/CampSearch.vue'
import ReviewStatusMenu from '@/components/rounds/ReviewStatusMenu.vue'
import { CAMP_TABS } from '@/router'

const { t } = useI18n()
const { campId, campIri } = useCampRoute()
const { facts, loading, error, progress, load } = useCampFacts(campIri)

const title = computed(() => facts.value?.camp.title ?? campId.value)
const loadedAtLabel = computed(() => {
  const at = facts.value?.loadedAt
  if (!at) return null
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return null
  const time = d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
  return t('campLayout.loadedAt', { time })
})
const dates = computed(() => {
  const c = facts.value?.camp
  if (!c?.start || !c.end) return null
  const f = (d: string) => d.split('-').reverse().join('.')
  return `${f(c.start)} – ${f(c.end)}`
})

watch(campIri, () => void load(), { immediate: true })
</script>

<template>
  <div class="camp-layout">
    <div class="d-flex align-center flex-wrap ga-2 mb-2">
      <v-btn :to="{ name: 'camps' }" icon="mdi-arrow-left" variant="text" :aria-label="t('campLayout.backToList')" />
      <div>
        <div class="text-h5">{{ title }}</div>
        <div v-if="dates" class="text-body-2 text-medium-emphasis">{{ dates }}</div>
        <div v-if="loadedAtLabel" class="text-caption text-medium-emphasis" data-testid="camp-loaded-at">{{ loadedAtLabel }}</div>
      </div>
      <ReviewStatusMenu :camp-iri="campIri" class="ms-2" />
      <v-spacer />
      <CampSearch />
      <v-spacer />
      <ConnectionStatusChips />
      <v-btn
        variant="tonal"
        icon="mdi-refresh"
        :loading="loading"
        :aria-label="t('campLayout.reloadTooltip')"
        data-testid="camp-reload"
        @click="load(true)"
      >
        <v-icon icon="mdi-refresh" />
        <v-tooltip activator="parent" location="bottom">{{ t('campLayout.reloadTooltip') }}</v-tooltip>
      </v-btn>
    </div>

    <v-progress-linear
      v-if="loading"
      :model-value="progress && progress.total ? (100 * progress.done) / progress.total : undefined"
      :indeterminate="!progress || !progress.total"
      class="mb-2"
    />
    <v-alert v-if="error" type="error" variant="tonal" class="mb-2" :title="t('campLayout.loadFailed')" :text="error" />

    <v-tabs density="comfortable" show-arrows class="camp-tabs mb-4">
      <template v-for="tab in CAMP_TABS" :key="tab.name">
        <v-tab
          :to="{ name: tab.name, params: { campId } }"
          :text="t(tab.titleKey)"
          :title="'titleLongKey' in tab ? t(tab.titleLongKey) : undefined"
        />
        <v-divider v-if="'groupEnd' in tab" vertical class="my-3 mx-1" />
      </template>
    </v-tabs>

    <router-view />
  </div>
</template>

<style scoped>
/* Height of the sticky tab bar (v-tabs density comfortable); views stick their own heads below it (WeekGrid). */
.camp-layout {
  --camp-tabs-height: 44px;
}
.camp-tabs {
  position: sticky;
  top: var(--v-layout-top, 0px);
  z-index: 5;
  background: rgb(var(--v-theme-surface));
}
/* Short tabs (GP/DP) must not be padded to 90px: otherwise the bar never leaves overflow mode (arrows) after the drawer closed. */
.camp-tabs :deep(.v-tab) {
  min-width: 0;
}
</style>

<style>
/* scrollIntoView / anchor targets must not end up under the sticky app bar (48 px) + camp tab bar (44 px). */
html:has(.camp-tabs) {
  scroll-padding-top: 100px;
}
</style>
