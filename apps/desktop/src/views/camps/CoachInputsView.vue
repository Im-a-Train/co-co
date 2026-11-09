<script setup lang="ts">
/** /lager/:campId/angaben: Lager-Angaben form (CoachInputs), persisted via useCampSettings. */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fromTri, INPUT_RULES, normalizeInputs, parseCount, STUFEN, toTri, validateInputs, type TriState } from '@/components/camps/inputsForm'
import RuleModulesCard from '@/components/camps/RuleModulesCard.vue'
import MidataBadge from '@/components/midata/MidataBadge.vue'
import MidataCard from '@/components/midata/MidataCard.vue'
import NdsBadge from '@/components/nds/NdsBadge.vue'
import NdsCard from '@/components/nds/NdsCard.vue'
import { useCampRoute } from '@/composables/useCampRoute'
import { useCampSettings } from '@/composables/useCampSettings'
import { adoptNdsFields } from '@/composables/useNds'
import { emptyCoachInputs } from '@/domain/campFacts/store'
import { adoptFields } from '@/domain/midata'
import { loadEffectivePacks } from '@/domain/rules/editsStore'
import type { CoachInputs, MidataAggregate, MidataField, NdsAggregate, NdsField } from '@/domain/types'

const { t } = useI18n()
const { campId, campIri } = useCampRoute()
const settings = useCampSettings(campIri)

const ready = ref(false)
const draft = ref<CoachInputs>(emptyCoachInputs(campIri.value))
const saving = ref(false)
const saved = ref(false)
const saveError = ref<string | null>(null)

function resetDraft(): void {
  draft.value = { ...(settings.coachInputs.value ?? emptyCoachInputs(campIri.value)) }
  saved.value = false
}
async function init(): Promise<void> {
  ready.value = false
  try {
    await settings.load()
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  }
  resetDraft()
  ready.value = true
}
onMounted(() => void init())
watch(campIri, () => void init())

const stufen = STUFEN.map((s) => ({ value: s, title: t(`camps.inputs.stufe.${s}`) }))
const triItems = (['yes', 'no', 'unknown'] as TriState[]).map((v) => ({ value: v, title: t(`camps.inputs.tri.${v}`) }))

const ruleTitles = computed(() => {
  const map = new Map<string, string>()
  try {
    for (const p of loadEffectivePacks()) for (const r of p.rules) map.set(r.meta.id, r.meta.title)
  } catch {
    // Titles are a nicety; fall back to the rule id.
  }
  return map
})
function usedBy(field: keyof CoachInputs): string {
  const ids = INPUT_RULES[field] ?? []
  if (ids.length === 0) return t('camps.inputs.usedByNone')
  return `${t('camps.inputs.usedBy')}: ${ids.map((id) => (ruleTitles.value.has(id) ? `${id} ${ruleTitles.value.get(id)}` : id)).join(', ')}`
}

const errors = computed(() => validateInputs(normalizeInputs(draft.value)))
const dirty = computed(() => {
  const base = settings.coachInputs.value ?? emptyCoachInputs(campIri.value)
  const { updatedAt: _a, ...a } = normalizeInputs(draft.value)
  const { updatedAt: _b, ...b } = base
  return JSON.stringify(a) !== JSON.stringify(b)
})

/** A manual edit of a MiData-adopted field removes its badge. */
function withoutBadge(key: string): CoachInputs['midataFields'] {
  const { [key as MidataField]: _drop, ...rest } = draft.value.midataFields ?? {}
  return rest
}
/** Same for NDS badges (only present once something was adopted from NDS). */
function withoutNdsBadge(key: string): Pick<CoachInputs, 'ndsFields'> {
  if (!draft.value.ndsFields) return {}
  const { [key as NdsField]: _drop, ...rest } = draft.value.ndsFields
  return { ndsFields: rest }
}
const ndsBadgeOf = (key: string): string | null => draft.value.ndsFields?.[key as NdsField] ?? null
const badgeOf = (key: string): string | null => draft.value.midataFields?.[key as MidataField] ?? null

function setNum(key: 'participantsCount' | 'participantsJsAgeCount' | 'minAge' | 'maxAge' | 'leadersCount' | 'jsLeadersCount' | 'slrgCount', v: string | null): void {
  draft.value = { ...draft.value, [key]: parseCount(v), midataFields: withoutBadge(key), ...withoutNdsBadge(key) }
  saved.value = false
}
function setField<K extends keyof CoachInputs>(key: K, v: CoachInputs[K]): void {
  draft.value = { ...draft.value, [key]: v, midataFields: withoutBadge(key), ...withoutNdsBadge(key) }
  saved.value = false
}

function onAdopt(fields: MidataField[], agg: MidataAggregate): void {
  draft.value = adoptFields(draft.value, agg, fields, new Date().toISOString())
  void save(fields)
}

function onAdoptNds(fields: NdsField[], agg: NdsAggregate): void {
  draft.value = adoptNdsFields(draft.value, agg, fields, new Date().toISOString())
  void save(undefined, fields)
}

async function save(adopted?: MidataField[], adoptedNds?: NdsField[]): Promise<void> {
  if (errors.value.length > 0) return
  saving.value = true
  saveError.value = null
  try {
    const toSave = normalizeInputs(draft.value)
    await settings.saveCoachInputs(toSave, { adopted })
    // Saving drops badges of fields that changed against the stored inputs; fields adopted from NDS in
    // this save keep theirs by saving once more (values now equal the stored ones, so badges survive).
    if (adoptedNds?.length && toSave.ndsFields) await settings.saveCoachInputs(toSave, { adopted })
    resetDraft()
    saved.value = true
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

const numberFields = [
  { key: 'participantsCount', section: 'participants' },
  { key: 'participantsJsAgeCount', section: 'participants' },
  { key: 'minAge', section: 'participants' },
  { key: 'maxAge', section: 'participants' },
  { key: 'leadersCount', section: 'participants' },
  { key: 'jsLeadersCount', section: 'participants' },
  { key: 'slrgCount', section: 'participants' },
] as const
const flagFields = [
  { key: 'ndsRegistered', date: 'ndsRegisteredOn' },
  { key: 'ndsClosed', date: 'ndsClosedOn' },
  { key: 'leihmaterialOrdered', date: 'leihmaterialDeliveryDate' },
  { key: 'landeskartenOrdered', date: 'landeskartenDeliveryDate' },
  { key: 'lagerbewilligungDone', date: null },
] as const
</script>

<template>
  <div>
    <h1 class="text-h5 mb-2">{{ t('camps.inputs.title') }}</h1>
    <p class="text-medium-emphasis mb-4">{{ t('camps.inputs.intro') }}</p>

    <div v-if="!ready" class="text-center pa-8">
      <v-progress-circular indeterminate class="mb-2" />
      <div class="text-medium-emphasis">{{ t('camps.inputs.loading') }}</div>
    </div>

    <v-form v-else @submit.prevent="save()">
      <MidataCard :camp-iri="campIri" :inputs="draft" @adopt="onAdopt" />
      <NdsCard :camp-iri="campIri" :inputs="draft" @adopt="onAdoptNds" />

      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">{{ t('camps.inputs.sections.general') }}</v-card-title>
        <v-card-text>
          <v-select
            :model-value="toTri(draft.isJsCamp)"
            :items="triItems"
            :label="t('camps.inputs.fields.isJsCamp')"
            :hint="`${t('camps.inputs.fields.isJsCampHint')} ${usedBy('isJsCamp')}`"
            persistent-hint
            variant="outlined"
            density="comfortable"
            @update:model-value="(v: TriState) => setField('isJsCamp', fromTri(v))"
          />
          <v-select
            :model-value="draft.stufe"
            :items="stufen"
            :label="t('camps.inputs.fields.stufe')"
            :hint="usedBy('stufe')"
            persistent-hint
            clearable
            variant="outlined"
            density="comfortable"
            class="mt-4"
            @update:model-value="(v) => setField('stufe', v ?? null)"
          />
        </v-card-text>
      </v-card>

      <RuleModulesCard :camp-iri="campIri" />

      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">{{ t('camps.inputs.sections.participants') }}</v-card-title>
        <v-card-text>
          <v-row>
            <v-col v-for="f in numberFields" :key="f.key" cols="12" sm="6">
              <v-text-field
                :model-value="draft[f.key] ?? ''"
                type="number"
                min="0"
                :label="t(`camps.inputs.fields.${f.key}`)"
                :hint="usedBy(f.key)"
                persistent-hint
                variant="outlined"
                density="comfortable"
                :data-testid="`input-${f.key}`"
                @update:model-value="(v: string) => setNum(f.key, v)"
              >
                <template v-if="badgeOf(f.key)" #append-inner><MidataBadge :since="badgeOf(f.key)!" /></template>
              </v-text-field>
            </v-col>
          </v-row>
          <v-select
            :model-value="toTri(draft.lagerleiterAttested)"
            :items="triItems"
            :label="t('camps.inputs.fields.lagerleiterAttested')"
            :hint="usedBy('lagerleiterAttested')"
            persistent-hint
            variant="outlined"
            density="comfortable"
            class="mt-4"
            @update:model-value="(v: TriState) => setField('lagerleiterAttested', fromTri(v))"
          >
            <template v-if="badgeOf('lagerleiterAttested')" #append-inner><MidataBadge :since="badgeOf('lagerleiterAttested')!" /></template>
          </v-select>
        </v-card-text>
      </v-card>

      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">{{ t('camps.inputs.sections.deadlines') }}</v-card-title>
        <v-card-text>
          <v-row v-for="f in flagFields" :key="f.key" align="center">
            <v-col cols="12" sm="7">
              <v-checkbox
                :model-value="draft[f.key]"
                :label="t(`camps.inputs.fields.${f.key}`)"
                :hint="usedBy(f.key)"
                persistent-hint
                density="comfortable"
                :data-testid="`input-${f.key}`"
                @update:model-value="(v) => setField(f.key, v === true)"
              />
              <NdsBadge v-if="ndsBadgeOf(f.key)" :since="ndsBadgeOf(f.key)!" />
            </v-col>
            <v-col v-if="f.date" cols="12" sm="5">
              <v-text-field
                :model-value="draft[f.date] ?? ''"
                type="date"
                :label="t(`camps.inputs.fields.${f.date}`)"
                variant="outlined"
                density="comfortable"
                hide-details
                @update:model-value="(v: string) => setField(f.date, v || null)"
              >
                <template v-if="ndsBadgeOf(f.date)" #append-inner><NdsBadge :since="ndsBadgeOf(f.date)!" /></template>
              </v-text-field>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">{{ t('camps.inputs.sections.notes') }}</v-card-title>
        <v-card-text>
          <v-textarea
            :model-value="draft.notes"
            :label="t('camps.inputs.fields.notes')"
            rows="3"
            auto-grow
            variant="outlined"
            hide-details
            @update:model-value="(v: string) => setField('notes', v ?? '')"
          />
        </v-card-text>
      </v-card>

      <v-alert type="info" variant="tonal" density="compact" class="mb-4" data-testid="checklist-moved-hint">
        {{ t('campConfig.checklist.movedHint') }}
        <router-link :to="`/lager/${campId}/checkliste`">{{ t('campConfig.checklist.movedLink') }}</router-link>
      </v-alert>

      <v-alert v-for="e in errors":key="e" type="error" variant="tonal" class="mb-2">{{ t(`camps.inputs.errors.${e}`) }}</v-alert>
      <v-alert v-if="saveError" type="error" variant="tonal" class="mb-2">{{ t('camps.inputs.saveFailed') }}: {{ saveError }}</v-alert>

      <div class="d-flex align-center ga-3">
        <v-btn type="submit" color="primary" :loading="saving" :disabled="!dirty || errors.length > 0" data-testid="inputs-save">
          {{ t('camps.inputs.save') }}
        </v-btn>
        <v-btn variant="text" :disabled="!dirty" @click="resetDraft">{{ t('camps.inputs.reset') }}</v-btn>
        <span v-if="saved" class="text-success">{{ t('camps.inputs.saved') }}</span>
        <span v-else-if="dirty" class="text-medium-emphasis">{{ t('camps.inputs.unsaved') }}</span>
      </div>
    </v-form>
  </div>
</template>
