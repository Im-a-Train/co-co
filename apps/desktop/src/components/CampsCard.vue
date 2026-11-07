<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCamps } from '@/composables/useCamps'
import { useSession } from '@/composables/useSession'
import { formatPeriodRange, type CampSummary } from '@/lib/camps'

const { t } = useI18n()
const { session, isLoggedIn } = useSession()
const { camps, loaded, loading, error, selectedIri, activities, activitiesLoading, activitiesError, loadCamps, selectCamp, reset } =
  useCamps()

// Identity of the current session (instance + user); unchanged by token refreshes.
const sessionKey = computed(() => (session.value ? `${session.value.baseUrl}|${session.value.userIri ?? ''}` : null))

// Load camps automatically once a session exists. On logout or a switch to
// another instance/account, drop the old camps (and any request in flight).
watch(
  sessionKey,
  (key, prevKey) => {
    if (key !== prevKey && prevKey != null) reset()
    if (key != null && !loaded.value && !loading.value) void loadCamps()
  },
  { immediate: true },
)

function onSelect(camp: CampSummary): void {
  void selectCamp(camp)
}
</script>

<template>
  <v-card class="h-100">
    <v-card-item prepend-icon="mdi-tent">
      <v-card-title>{{ t('camps.title') }}</v-card-title>
      <v-card-subtitle>{{ loaded ? t('camps.count', { n: camps.length }, camps.length) : t('camps.subtitle') }}</v-card-subtitle>
      <template #append>
        <v-btn
          icon="mdi-refresh"
          variant="text"
          size="small"
          :title="t('camps.reload')"
          :aria-label="t('camps.reload')"
          :loading="loading"
          :disabled="!isLoggedIn"
          @click="loadCamps"
        />
      </template>
    </v-card-item>

    <v-card-text>
      <v-empty-state v-if="!isLoggedIn" icon="mdi-tent" :text="t('camps.loginFirst')" size="56" />

      <template v-else>
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">
          {{ t('camps.failed') }}: {{ error }}
        </v-alert>

        <v-skeleton-loader v-if="loading && !camps.length" type="list-item-two-line@3" />

        <p v-else-if="loaded && !camps.length" class="text-body-2 text-medium-emphasis">{{ t('camps.empty') }}</p>

        <v-list v-else lines="three" density="compact" class="py-0 camp-list" nav>
          <v-list-item
            v-for="camp in camps"
            :key="camp.iri"
            :active="camp.iri === selectedIri"
            color="primary"
            @click="onSelect(camp)"
          >
            <v-list-item-title class="font-weight-medium">
              {{ camp.title }}
              <span v-if="camp.shortTitle && camp.shortTitle !== camp.title" class="text-medium-emphasis">
                ({{ camp.shortTitle }})
              </span>
            </v-list-item-title>
            <v-list-item-subtitle>
              <span v-if="camp.motto">{{ t('camps.motto') }}: {{ camp.motto }}</span>
              <span v-if="camp.motto && camp.coachName"> · </span>
              <span v-if="camp.coachName">{{ t('camps.coach') }}: {{ camp.coachName }}</span>
            </v-list-item-subtitle>
            <div v-if="camp.periods?.length" class="text-caption mt-1">
              <v-icon icon="mdi-calendar-range" size="x-small" class="me-1" />
              <span v-for="(p, i) in camp.periods" :key="i">
                <span v-if="i > 0">; </span>{{ formatPeriodRange(p) }}<span v-if="p.description"> ({{ p.description }})</span>
              </span>
            </div>
          </v-list-item>
        </v-list>

        <v-sheet v-if="selectedIri" border rounded="lg" class="pa-3 mt-3">
          <div class="text-subtitle-2 mb-1">
            <v-icon icon="mdi-format-list-checks" size="small" class="me-1" />
            {{ t('camps.activities.title') }}
          </div>
          <v-progress-linear v-if="activitiesLoading" indeterminate color="primary" />
          <div v-else-if="activitiesError" class="text-error text-body-2">
            {{ t('camps.activities.failed') }}: {{ activitiesError }}
          </div>
          <template v-else-if="activities">
            <div class="text-body-2">{{ t('camps.activities.count', { n: activities.count }, activities.count) }}</div>
            <ul v-if="activities.titles.length" class="text-body-2 ms-5 mt-1">
              <li v-for="(title, i) in activities.titles" :key="i">{{ title }}</li>
            </ul>
          </template>
        </v-sheet>
      </template>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.camp-list {
  max-height: 420px;
  overflow-y: auto;
}
</style>
