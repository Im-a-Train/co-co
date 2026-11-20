<script setup lang="ts">
/** M22: camp details from the NDS (risk answers, flags, subsidies, present counts, minimum-requirement messages). */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { NdsCampDetails } from '@/domain/types'
import { formatChf, presentParticipants, triKey } from './format'

const props = defineProps<{ details: NdsCampDetails }>()
const { t } = useI18n()

const tri = (v: boolean | null): string => t(`nds.tri.${triKey(v)}`)
const num = (n: number | null): string => (n === null ? '–' : String(n))

const rows = computed(() => {
  const d = props.details
  const f = d.offerFlags
  const list: { key: string; value: string }[] = [
    { key: 'riskActivitiesPlanned', value: tri(d.riskActivitiesPlanned) },
    { key: 'supervisorExpertise', value: tri(d.supervisorExpertisePresent) },
    { key: 'overnightStay', value: tri(d.overnightStay) },
    { key: 'lateSubmission', value: tri(d.lateSubmission) },
    { key: 'approvalWithReservation', value: tri(d.approvalWithReservation) },
    { key: 'itemsInCorrection', value: tri(f.itemsInCorrection) },
    { key: 'lateSubmittedItems', value: tri(f.lateSubmittedItems) },
    { key: 'handicapRegistration', value: tri(f.handicapRegistration) },
  ]
  return list
})
const answers = computed(() => props.details.riskActivityAnswers.map((a, i) => ({ n: i + 1, value: tri(a) })))
const present = computed(() => props.details.present)
const presentTotal = computed(() => presentParticipants(props.details.present))
const campDays = computed(() => props.details.campDaysWithActivities !== null || props.details.campDaysWithoutActivities !== null)
const subsidies = computed(() => props.details.subsidies)
const hasSubsidies = computed(() => subsidies.value.planned !== null || subsidies.value.actual !== null || subsidies.value.total !== null)
const hasPresent = computed(() => Object.values(present.value).some((v) => v !== null))
const messages = computed(() => props.details.minimalRequirementsMessages ?? [])
</script>

<template>
  <div class="mt-4" data-testid="nds-details">
    <div class="text-subtitle-2 mb-1">{{ t('nds.details.title') }}</div>

    <v-table density="compact" class="mb-2" data-testid="nds-details-flags">
      <tbody>
        <tr v-for="r in rows" :key="r.key">
          <td>{{ t(`nds.details.flag.${r.key}`) }}</td>
          <td class="text-right">{{ r.value }}</td>
        </tr>
        <tr v-for="a in answers" :key="`a${a.n}`">
          <td class="pl-6">{{ t('nds.details.riskAnswer', { n: a.n }) }}</td>
          <td class="text-right">{{ a.value }}</td>
        </tr>
      </tbody>
    </v-table>

    <div v-if="campDays" class="text-body-2" data-testid="nds-details-days">
      {{ t('nds.details.campDays', { with: num(details.campDaysWithActivities), without: num(details.campDaysWithoutActivities) }) }}
    </div>

    <div v-if="hasPresent" class="text-body-2" data-testid="nds-details-present">
      {{
        t('nds.details.present', {
          mc: num(present.maleChildren),
          fc: num(present.femaleChildren),
          ma: num(present.maleAdolescents),
          fa: num(present.femaleAdolescents),
          total: num(presentTotal),
          supervisors: num(present.supervisors),
        })
      }}
    </div>

    <div v-if="hasSubsidies" class="text-body-2" data-testid="nds-details-subsidies">
      {{
        t('nds.details.subsidies', {
          planned: formatChf(subsidies.planned),
          actual: formatChf(subsidies.actual),
          total: formatChf(subsidies.total),
        })
      }}
    </div>

    <v-alert v-if="messages.length" type="warning" variant="tonal" density="compact" class="mt-2" data-testid="nds-details-messages">
      <div class="font-weight-medium">{{ t('nds.details.minimalRequirements') }}</div>
      <ul class="pl-4">
        <li v-for="(m, i) in messages" :key="i">{{ m }}</li>
      </ul>
    </v-alert>
  </div>
</template>
