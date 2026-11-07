<script setup lang="ts">
/** /lager/:campId/runden: review status, rounds, diff, export reminder. OWNER: rounds builder. */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import DiffView from '@/components/rounds/DiffView.vue'
import ReviewStatusStepper from '@/components/rounds/ReviewStatusStepper.vue'
import RoundTimeline from '@/components/rounds/RoundTimeline.vue'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampRoute } from '@/composables/useCampRoute'
import { useRounds } from '@/composables/useRounds'
import { RoundsError } from '@/domain/rounds'
import type { CampFacts, Diff, Iri, ReviewStatus } from '@/domain/types'

const { t } = useI18n()
const { campIri } = useCampRoute()
const { facts } = useCampFacts(campIri)
const r = useRounds(campIri)

const selectedId = ref<string | null>(null)
const selectedDiff = ref<Diff | null>(null)
const selectedFacts = ref<CampFacts | null>(null)
const dialog = ref(false)
const note = ref('')
const busy = ref(false)

onMounted(() => void r.load())
watch(campIri, () => {
  selectedId.value = null
  void r.load()
})

const latest = computed(() => r.rounds.value[r.rounds.value.length - 1] ?? null)
const nextNumber = computed(() => (latest.value?.number ?? 0) + 1)

const errorText = computed(() => {
  const e = r.error.value
  if (!e) return null
  return ['invalidTransition', 'noFacts', 'noRound'].includes(e) ? t(`rounds.errors.${e}`) : e
})

function titleFrom(f: CampFacts | null) {
  const map = new Map<Iri, string>((f?.activities ?? []).map((a) => [a.iri, a.title]))
  return (iri: Iri) => map.get(iri)
}
const liveTitleOf = computed(() => {
  const a = titleFrom(r.lastSnapshotFacts.value)
  const b = titleFrom(facts.value)
  return (iri: Iri) => b(iri) ?? a(iri)
})
const selectedTitleOf = computed(() => titleFrom(selectedFacts.value))

watch(selectedId, async (id) => {
  selectedDiff.value = null
  selectedFacts.value = null
  if (!id) return
  selectedDiff.value = await r.diffForRound(id)
  selectedFacts.value = (await r.snapshotOf(id))?.facts ?? null
})

async function setStatus(status: ReviewStatus, n: string | null) {
  try {
    await r.setStatus(status, n)
  } catch {
    // shown via r.error
  }
}
async function start() {
  busy.value = true
  try {
    await r.startRound(note.value.trim())
    dialog.value = false
    note.value = ''
  } catch (e) {
    if (!(e instanceof RoundsError)) throw e
    dialog.value = false
  } finally {
    busy.value = false
  }
}
async function close(id: string) {
  try {
    await r.closeRound(id)
  } catch {
    // shown via r.error
  }
}
</script>

<template>
  <div>
    <div class="d-flex align-center mb-2">
      <h1 class="text-h5">{{ t('rounds.title') }}</h1>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" density="comfortable" @click="dialog = true">
        {{ t('rounds.start.button') }}
      </v-btn>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-4">{{ t('rounds.intro') }}</p>

    <v-alert v-if="errorText" type="error" variant="tonal" density="compact" class="mb-4" :text="errorText" />

    <v-row>
      <v-col cols="12" md="5">
        <ReviewStatusStepper :review="r.review.value" class="mb-4" @set="setStatus" />
        <RoundTimeline :rounds="r.rounds.value" :selected-id="selectedId" @select="(id) => (selectedId = id)" @close="close" />
      </v-col>
      <v-col cols="12" md="7">
        <template v-if="selectedId && selectedDiff">
          <h2 class="text-subtitle-1 mb-2">
            {{ t('rounds.diff.roundVs', { n: r.rounds.value.find((x) => x.id === selectedId)?.number ?? '' }) }}
          </h2>
          <v-alert
            v-if="!selectedDiff.fromRoundId"
            type="info"
            variant="tonal"
            density="compact"
            class="mb-2"
            :text="t('rounds.diff.firstRound')"
          />
          <DiffView :diff="selectedDiff" :title-of="selectedTitleOf" />
        </template>
        <template v-else-if="latest && r.diffSinceLastRound.value">
          <h2 class="text-subtitle-1 mb-2">{{ t('rounds.diff.sinceLast', { n: latest.number }) }}</h2>
          <DiffView :diff="r.diffSinceLastRound.value" :title-of="liveTitleOf" />
        </template>
      </v-col>
    </v-row>

    <v-dialog v-model="dialog" max-width="480">
      <v-card>
        <v-card-title>{{ t('rounds.start.title') }}</v-card-title>
        <v-card-text>
          <p class="mb-3">{{ t('rounds.start.text', { n: nextNumber }) }}</p>
          <v-textarea v-model="note" :label="t('rounds.start.noteLabel')" rows="2" auto-grow variant="outlined" hide-details />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="busy" @click="start">{{ t('rounds.start.confirm') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
