<script setup lang="ts">
/**
 * Settings > NDS: the coach's own NDS person (detected or manual) and the coach profile (organisations,
 * finished offers). Red zone: the profile lives in memory only, nothing is stored except the numeric person id.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate, formatStand } from '@/components/midata/format'
import { useNds } from '@/composables/useNds'
import type { NdsFinishedOffer } from '@/domain/types'
import { isTauri } from '@/lib/tauri'

const { t } = useI18n()
const nds = useNds()
const inTauri = isTauri()

const draft = ref(nds.personId.value ?? '')
watch(nds.personId, (v) => {
  draft.value = v ?? ''
})
const invalid = ref(false)
const dirty = computed(() => draft.value.trim() !== (nds.personId.value ?? ''))

async function save(): Promise<void> {
  invalid.value = !(await nds.setPersonId(draft.value))
}

const profile = nds.coachProfile
const showOffers = ref(false)
const offersByYear = computed(() => {
  const by = new Map<string, number>()
  for (const o of profile.value?.finishedOffers ?? []) {
    const y = (o.end ?? o.start ?? '').slice(0, 4) || '–'
    by.set(y, (by.get(y) ?? 0) + 1)
  }
  return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0]))
})
function offerLine(o: NdsFinishedOffer): string {
  const dates = o.start ? (o.end && o.end !== o.start ? `${formatDate(o.start)} – ${formatDate(o.end)}` : formatDate(o.start)) : ''
  return [o.offerNumber ? t('nds.card.link.offer', { n: o.offerNumber }) : '', o.organisationName, dates, o.sports.join(', ')].filter(Boolean).join(' · ')
}
</script>

<template>
  <div class="mt-5" data-testid="nds-person">
    <div class="text-subtitle-2 mb-1">{{ t('nds.settings.person.title') }}</div>
    <p class="text-caption text-medium-emphasis mb-2">{{ t('nds.settings.person.explain') }}</p>
    <div class="d-flex align-start flex-wrap ga-2">
      <v-text-field
        v-model="draft"
        :label="t('nds.settings.person.label')"
        density="compact"
        variant="outlined"
        inputmode="numeric"
        :error-messages="invalid ? [t('nds.settings.person.invalid')] : []"
        hide-details="auto"
        style="max-width: 240px"
        data-testid="nds-personid"
        @update:model-value="invalid = false"
        @keyup.enter="save"
      />
      <v-btn variant="tonal" :disabled="!dirty" data-testid="nds-personid-save" @click="save">{{ t('nds.settings.person.save') }}</v-btn>
      <v-btn
        variant="tonal"
        prepend-icon="mdi-account-search-outline"
        :disabled="!inTauri || !nds.connected.value"
        :loading="nds.detecting.value"
        data-testid="nds-personid-detect"
        @click="nds.detectPerson()"
      >
        {{ t('nds.settings.person.detect') }}
      </v-btn>
    </div>
    <div v-if="nds.detection.value" class="text-caption mt-1" data-testid="nds-person-detection">
      {{
        nds.detection.value.personId
          ? t('nds.settings.person.detected', { matched: nds.detection.value.offersMatched, seen: nds.detection.value.offersSeen })
          : t('nds.settings.person.notDetected', { seen: nds.detection.value.offersSeen })
      }}
    </div>
    <div v-if="nds.personError.value" class="text-caption text-error mt-1">{{ nds.personError.value }}</div>

    <div class="text-subtitle-2 mt-4 mb-1">{{ t('nds.settings.profile.title') }}</div>
    <div class="d-flex align-center flex-wrap ga-2">
      <v-btn
        variant="tonal"
        prepend-icon="mdi-shield-lock-outline"
        :disabled="!inTauri || !nds.connected.value || !nds.personId.value"
        :loading="nds.profileLoading.value"
        data-testid="nds-profile-load"
        @click="nds.loadCoachProfile()"
      >
        {{ profile ? t('nds.settings.profile.reload') : t('nds.settings.profile.load') }}
      </v-btn>
      <span v-if="!nds.personId.value" class="text-caption text-medium-emphasis">{{ t('nds.settings.profile.needsPerson') }}</span>
      <span v-else-if="profile" class="text-caption" data-testid="nds-profile-stand">{{ t('nds.card.stand', { date: formatStand(profile.fetchedAt) }) }}</span>
    </div>
    <div class="text-caption text-medium-emphasis mt-1">{{ t('nds.settings.profile.memoryOnly') }}</div>
    <div v-if="nds.profileError.value" class="text-caption text-error mt-1">{{ nds.profileError.value }}</div>

    <div v-if="profile" class="mt-3" data-testid="nds-profile">
      <div class="text-caption text-medium-emphasis">{{ t('nds.settings.profile.organisations') }}</div>
      <div v-if="!profile.organisations.length" class="text-body-2">{{ t('nds.settings.profile.noOrganisations') }}</div>
      <div v-for="o in profile.organisations" :key="o.businessId" class="text-body-2" data-testid="nds-profile-org">
        {{ o.name }}
        <span class="text-medium-emphasis">
          <template v-if="o.relationType"> · {{ o.relationType }}</template>
          <template v-if="o.since"> · {{ t('nds.settings.profile.since', { date: formatDate(o.since) }) }}</template>
        </span>
      </div>

      <div class="text-caption text-medium-emphasis mt-3">{{ t('nds.settings.profile.offers', { n: profile.finishedOffers.length }) }}</div>
      <div v-if="offersByYear.length" class="d-flex flex-wrap ga-2 mt-1" data-testid="nds-profile-years">
        <v-chip v-for="[y, n] in offersByYear" :key="y" size="small" variant="tonal">{{ y }}: {{ n }}</v-chip>
      </div>
      <template v-if="profile.finishedOffers.length">
        <v-btn
          variant="text"
          size="small"
          class="px-0"
          :prepend-icon="showOffers ? 'mdi-chevron-down' : 'mdi-chevron-right'"
          :aria-expanded="showOffers"
          data-testid="nds-profile-offers-toggle"
          @click="showOffers = !showOffers"
        >
          {{ t('nds.settings.profile.offerList') }}
        </v-btn>
        <div v-if="showOffers" data-testid="nds-profile-offers">
          <div v-for="o in profile.finishedOffers" :key="o.offerBusinessId" class="text-body-2">{{ offerLine(o) }}</div>
        </div>
      </template>
    </div>
  </div>
</template>
