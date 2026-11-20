<script setup lang="ts">
/** M21: attendance counts per activity (NDS), incl. double bookings. Counts only, no persons. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate } from '@/components/midata/format'
import type { NdsAttendance } from '@/domain/types'

defineProps<{ attendance: NdsAttendance }>()
const { t } = useI18n()
const showDates = ref(false)
</script>

<template>
  <div class="mt-4" data-testid="nds-attendance">
    <div class="text-subtitle-2 mb-1">{{ t('nds.attendance.title') }}</div>
    <div class="text-body-2" data-testid="nds-attendance-read">
      {{ t('nds.attendance.read', { read: attendance.activitiesRead, total: attendance.activitiesTotal, checked: attendance.activitiesChecked }) }}
    </div>
    <div class="text-body-2">
      {{ t('nds.attendance.persons', { participants: attendance.participants, supervisors: attendance.supervisors }) }}
    </div>
    <div class="text-body-2">{{ t('nds.attendance.neverPresent', { n: attendance.participantsNeverPresent }) }}</div>
    <div class="text-body-2">{{ t('nds.attendance.notEligible', { n: attendance.participantsNotEligible }) }}</div>
    <div v-if="attendance.mountainGuides > 0" class="text-body-2">{{ t('nds.attendance.mountainGuides', { n: attendance.mountainGuides }) }}</div>

    <v-alert
      v-if="attendance.overlapParticipants + attendance.overlapSupervisors > 0"
      type="warning"
      variant="tonal"
      density="compact"
      class="mt-2"
      data-testid="nds-attendance-overlaps"
    >
      <div>
        {{
          t('nds.attendance.overlaps', {
            participants: attendance.overlapParticipants,
            supervisors: attendance.overlapSupervisors,
            activities: attendance.overlapActivities,
          })
        }}
      </div>
      <div v-if="attendance.overlapOfferNumbers.length" class="text-caption">
        {{ t('nds.attendance.overlapOffers', { list: attendance.overlapOfferNumbers.join(', ') }) }}
      </div>
      <div v-if="attendance.overlapDates.length" class="text-caption">
        {{ t('nds.attendance.overlapDates', { list: attendance.overlapDates.map(formatDate).join(', ') }) }}
      </div>
    </v-alert>

    <div v-if="attendance.truncated" class="text-caption text-medium-emphasis mt-1" data-testid="nds-attendance-truncated">
      {{ t('nds.attendance.truncated') }}
    </div>

    <template v-if="attendance.byDate.length">
      <v-btn
        variant="text"
        size="small"
        class="px-0 mt-1"
        :prepend-icon="showDates ? 'mdi-chevron-down' : 'mdi-chevron-right'"
        :aria-expanded="showDates"
        data-testid="nds-attendance-dates-toggle"
        @click="showDates = !showDates"
      >
        {{ t('nds.attendance.byDate', { n: attendance.byDate.length }) }}
      </v-btn>
      <v-table v-if="showDates" density="compact" data-testid="nds-attendance-dates">
        <thead>
          <tr>
            <th>{{ t('nds.attendance.date') }}</th>
            <th class="text-right">{{ t('nds.attendance.presentParticipants') }}</th>
            <th class="text-right">{{ t('nds.attendance.presentSupervisors') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in attendance.byDate" :key="d.date">
            <td>{{ formatDate(d.date) }}</td>
            <td class="text-right">{{ d.participantsPresent }}</td>
            <td class="text-right" :class="{ 'text-warning': d.supervisorsPresent === 0 }">{{ d.supervisorsPresent }}</td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </div>
</template>
