<script setup lang="ts">
/**
 * /lager/:campId/angaben: Lager-Angaben form (CoachInputs), persisted via useCampSettings.
 * Autosave (debounced, only while the draft is valid); the first card lists what open findings still wait for.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import {
  ERROR_FIELDS,
  fromTri,
  INPUT_RULES,
  missingInputKeys,
  normalizeInputs,
  parseCount,
  STUFEN,
  toTri,
  validateInputs,
  type MissingInputKey,
  type TriState,
} from '@/components/camps/inputsForm'
import InputsFieldRow from '@/components/camps/InputsFieldRow.vue'
import RuleModulesCard from '@/components/camps/RuleModulesCard.vue'
import MidataCard from '@/components/midata/MidataCard.vue'
import NdsCard from '@/components/nds/NdsCard.vue'
import { useCampRoute } from '@/composables/useCampRoute'
import { useCampRuleConfig } from '@/composables/useCampRuleConfig'
import { useCampSettings } from '@/composables/useCampSettings'
import { useFindings } from '@/composables/useFindings'
import { adoptNdsFields, useNds } from '@/composables/useNds'
import { emptyCoachInputs } from '@/domain/campFacts/store'
import { adoptFields } from '@/domain/midata'
import { loadEffectivePacks } from '@/domain/rules/editsStore'
import type { CoachInputs, Iri, MidataAggregate, MidataField, NdsAggregate, NdsField } from '@/domain/types'

const AUTOSAVE_MS = 600

const { t } = useI18n()
const route = useRoute()
const { campIri } = useCampRoute()
const settings = useCampSettings(campIri)
const findingsHandle = useFindings(campIri)
const rc = useCampRuleConfig(() => campIri.value)
const nds = useNds()

const ready = ref(false)
const draft = ref<CoachInputs>(emptyCoachInputs(campIri.value))
/** Normalised snapshot of what is stored (or being stored): the draft is «pending» while it differs. */
const baseline = ref('')
const savingCount = ref(0)
const savedOnce = ref(false)
const saveError = ref<string | null>(null)

const snapshot = (i: CoachInputs): string => {
  const { updatedAt: _u, ...rest } = normalizeInputs(i)
  return JSON.stringify(rest)
}

function resetDraft(): void {
  draft.value = { ...(settings.coachInputs.value ?? emptyCoachInputs(campIri.value)) }
  baseline.value = snapshot(draft.value)
  savedOnce.value = false
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
onMounted(() => {
  void init()
  void nds.init()
})
watch(campIri, async () => {
  await flush()
  await init()
})

const stufen = STUFEN.map((s) => ({ value: s as string, title: t(`camps.inputs.stufe.${s}`) }))
const triItems = (['yes', 'no', 'unknown'] as TriState[]).map((v) => ({ value: v as string, title: t(`camps.inputs.tri.${v}`) }))
const configTriItems = (['unset', 'yes', 'no'] as const).map((v) => ({ value: v as string, title: t(`campConfig.tri.${v}`) }))

const ruleTitles = computed(() => {
  const map = new Map<string, string>()
  try {
    for (const p of loadEffectivePacks()) for (const r of p.rules) map.set(r.meta.id, r.meta.title)
  } catch {
    // Titles are a nicety; fall back to the rule id.
  }
  return map
})
const rulesOf = (field: keyof CoachInputs): readonly string[] => INPUT_RULES[field] ?? []

// ---- Validation, inline at the field ---------------------------------------------------------------

const errors = computed(() => validateInputs(normalizeInputs(draft.value)))
function errorsOf(field: keyof CoachInputs): string[] {
  return errors.value.filter((e) => ERROR_FIELDS[e]?.includes(field)).map((e) => t(`camps.inputs.errors.${e}`))
}

// ---- Autosave ----------------------------------------------------------------------------------------

const pending = computed(() => ready.value && snapshot(draft.value) !== baseline.value)
const saving = computed(() => savingCount.value > 0)
let timer: ReturnType<typeof setTimeout> | null = null
let chain: Promise<void> = Promise.resolve()

function clearTimer(): void {
  if (timer) clearTimeout(timer)
  timer = null
}

async function doSave(adopted?: MidataField[], adoptedNds?: NdsField[]): Promise<void> {
  if (errors.value.length > 0 || !ready.value) return
  const snap = snapshot(draft.value)
  if (snap === baseline.value && !adopted?.length && !adoptedNds?.length) return
  savingCount.value += 1
  saveError.value = null
  try {
    const toSave = normalizeInputs(draft.value)
    await settings.saveCoachInputs(toSave, { adopted })
    // Saving drops badges of fields that changed against the stored inputs; fields adopted from NDS in
    // this save keep theirs by saving once more (values now equal the stored ones, so badges survive).
    if (adoptedNds?.length && toSave.ndsFields) await settings.saveCoachInputs(toSave, { adopted })
    // Only the baseline moves: the draft is left alone so keystrokes typed during the save are kept.
    baseline.value = snap
    savedOnce.value = true
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  } finally {
    savingCount.value -= 1
  }
}
function save(adopted?: MidataField[], adoptedNds?: NdsField[]): Promise<void> {
  clearTimer()
  chain = chain.then(() => doSave(adopted, adoptedNds))
  return chain
}
/** Saves a pending valid draft now (route leave, camp switch) and waits for running saves. */
async function flush(): Promise<void> {
  await save()
}

watch(draft, () => {
  if (!ready.value) return
  clearTimer()
  if (!pending.value || errors.value.length > 0) return
  timer = setTimeout(() => void save(), AUTOSAVE_MS)
})
/**
 * Leaving the page saves a pending valid draft. A change that cannot be saved (invalid, or the save failed)
 * is never dropped silently: the coach chooses between going back to the form and discarding it.
 */
const leaveDialog = ref(false)
let leaveAnswer: ((leave: boolean) => void) | null = null
function answerLeave(leave: boolean): void {
  leaveDialog.value = false
  leaveAnswer?.(leave)
  leaveAnswer = null
}
onBeforeRouteLeave(async () => {
  await flush()
  if (!pending.value) return true
  leaveDialog.value = true
  return new Promise<boolean>((resolve) => {
    leaveAnswer = resolve
  })
})
onBeforeUnmount(clearTimer)

type StatusState = 'saving' | 'invalid' | 'failed' | 'saved' | 'idle'
const status = computed<StatusState>(() => {
  if (saving.value) return 'saving'
  if (pending.value) return errors.value.length > 0 ? 'invalid' : saveError.value ? 'failed' : 'saving'
  return savedOnce.value ? 'saved' : 'idle'
})

// ---- Edits -------------------------------------------------------------------------------------------

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
const badgeOf = (key: string): string | null => draft.value.midataFields?.[key as MidataField] ?? null

type CountKey = 'participantsCount' | 'participantsJsAgeCount' | 'minAge' | 'maxAge' | 'leadersCount' | 'jsLeadersCount' | 'slrgCount'
function setNum(key: CountKey, v: string | number | null): void {
  stick()
  draft.value = { ...draft.value, [key]: parseCount(v), midataFields: withoutBadge(key), ...withoutNdsBadge(key) }
}
function setField<K extends keyof CoachInputs>(key: K, v: CoachInputs[K]): void {
  stick()
  draft.value = { ...draft.value, [key]: v, midataFields: withoutBadge(key), ...withoutNdsBadge(key) }
}
const setTri = (key: 'isJsCamp' | 'lagerleiterAttested') => (v: string | null) => setField(key, fromTri(v as TriState | null))

function onAdopt(fields: MidataField[], agg: MidataAggregate): void {
  stick()
  draft.value = adoptFields(draft.value, agg, fields, new Date().toISOString())
  void save(fields)
}
function onAdoptNds(fields: NdsField[], agg: NdsAggregate): void {
  stick()
  draft.value = adoptNdsFields(draft.value, agg, fields, new Date().toISOString())
  void save(undefined, fields)
}

// ---- «Fehlt noch für die Prüfung» -----------------------------------------------------------------

const missingNow = computed<MissingInputKey[]>(() => missingInputKeys(findingsHandle.findings.value))
/**
 * Inputs shown in the first card, per camp. Until the coach edits something it follows the open findings
 * (so a field resolved while data is still loading never shows up); from the first edit on, fields stay
 * after their finding is gone (marked «erledigt»), so nothing jumps away under the cursor. Keyed by camp: a
 * camp switch starts a fresh list no matter in which order the watchers run.
 */
const shown = ref<{ camp: Iri; keys: MissingInputKey[]; sticky: boolean }>({ camp: campIri.value, keys: [], sticky: false })
watch(
  [missingNow, campIri],
  ([keys, camp]) => {
    const same = shown.value.camp === camp
    const sticky = same && shown.value.sticky
    const prev = same ? shown.value.keys : []
    const kept = sticky ? prev : prev.filter((k) => keys.includes(k))
    const add = keys.filter((k) => !kept.includes(k))
    if (!same || add.length || kept.length !== prev.length) shown.value = { camp, keys: [...kept, ...add], sticky }
  },
  { immediate: true },
)
/** Called on every edit of the coach: from now on the card keeps its fields. */
function stick(): void {
  if (shown.value.camp === campIri.value && !shown.value.sticky) shown.value = { ...shown.value, sticky: true }
}
const shownMissing = computed<MissingInputKey[]>(() => (shown.value.camp === campIri.value ? shown.value.keys : []))
const missingCount = computed(() => shownMissing.value.filter((k) => missingNow.value.includes(k)).length)
const isShownMissing = (k: MissingInputKey): boolean => shownMissing.value.includes(k)
const isResolved = (k: MissingInputKey): boolean => !missingNow.value.includes(k)

const countFields: Array<{ key: CountKey }> = [
  { key: 'participantsCount' },
  { key: 'participantsJsAgeCount' },
  { key: 'leadersCount' },
  { key: 'jsLeadersCount' },
  { key: 'slrgCount' },
]
const moreCountFields: Array<{ key: CountKey }> = [{ key: 'minAge' }, { key: 'maxAge' }]
const panelCount = computed(() => countFields.filter((f) => !isShownMissing(f.key)))

// ---- Panels (collapsed; `#teilnehmende` / `#regelmodule` / `#weitere` in the URL open one) --------------

const PANEL_OF_HASH: Record<string, string> = { teilnehmende: 'participants', regelmodule: 'rules', weitere: 'more' }
const panels = ref<string[]>([])
function openPanel(id: string): void {
  if (!panels.value.includes(id)) panels.value = [...panels.value, id]
}
/** Opens the panel named by the hash and scrolls to it once the form is rendered (the router has no scrollBehavior). */
function openPanelFromHash(): void {
  const h = route.hash.replace('#', '')
  const id = PANEL_OF_HASH[h]
  if (!id) return
  openPanel(id)
  if (ready.value) void nextTick(() => setTimeout(() => document.getElementById(h)?.scrollIntoView({ block: 'start' }), 150))
}
watch([() => route.hash, ready], openPanelFromHash, { immediate: true })

/** A validation error inside a collapsed panel opens that panel, so «bitte Angaben prüfen» never points at hidden fields. */
function panelOfField(field: keyof CoachInputs): string | null {
  if (moreCountFields.some((f) => f.key === field)) return 'more'
  if (countFields.some((f) => f.key === field) && !isShownMissing(field)) return 'participants'
  return null
}
watch(errors, (errs) => {
  for (const e of errs) for (const field of ERROR_FIELDS[e] ?? []) {
    const id = panelOfField(field)
    if (id) openPanel(id)
  }
})

const ndsOn = computed(() => nds.enabled.value)
const winterTri = computed(() => {
  const v = rc.config.value.camp.winterSafeAccess
  return v === true ? 'yes' : v === false ? 'no' : 'unset'
})
function setWinterSafeAccess(v: string | null): void {
  stick()
  void rc.setCamp({ winterSafeAccess: v === 'yes' ? true : v === 'no' ? false : null })
}
</script>

<template>
  <div>
    <div class="d-flex align-start flex-wrap ga-3 mb-4">
      <p class="text-medium-emphasis flex-grow-1 mb-0">{{ t('camps.inputs.intro') }}</p>
      <span
        class="text-body-2 inputs-status"
        :class="status === 'invalid' || status === 'failed' ? 'text-warning' : status === 'saved' ? 'text-success' : 'text-medium-emphasis'"
        :data-state="status"
        role="status"
        data-testid="inputs-status"
      >
        <template v-if="status === 'saving'">{{ t('camps.inputs.status.saving') }}</template>
        <template v-else-if="status === 'invalid'">{{ t('camps.inputs.status.invalid') }}</template>
        <template v-else-if="status === 'failed'">{{ t('camps.inputs.status.failed') }}</template>
        <template v-else-if="status === 'saved'">{{ t('camps.inputs.status.saved') }}</template>
      </span>
    </div>

    <div v-if="!ready" class="text-center pa-8">
      <v-progress-circular indeterminate class="mb-2" />
      <div class="text-medium-emphasis">{{ t('camps.inputs.loading') }}</div>
    </div>

    <v-form v-else @submit.prevent>
      <v-card v-if="shownMissing.length" variant="outlined" class="mb-4" data-testid="inputs-missing">
        <v-card-title class="text-subtitle-1">
          {{ missingCount > 0 ? t('camps.inputs.missingTitle', { n: missingCount }) : t('camps.inputs.missingDone') }}
        </v-card-title>
        <v-card-text>
          <p v-if="missingCount > 0" class="text-body-2 text-medium-emphasis mb-3">{{ t('camps.inputs.missingHint') }}</p>
          <v-row>
            <template v-for="k in shownMissing" :key="k">
              <v-col v-if="k === 'winterSafeAccess'" cols="12" sm="6">
                <InputsFieldRow
                  field-key="winterSafeAccess"
                  kind="select"
                  :label-key="'winterSafeAccess'"
                  :model-value="winterTri"
                  :items="configTriItems"
                  test-id="missing-winterSafeAccess"
                  :done="isResolved('winterSafeAccess')"
                  :rule-ids="['LST-WINTER-01']"
                  :rule-titles="ruleTitles"
                  @update:model-value="setWinterSafeAccess"
                />
              </v-col>
              <v-col v-else-if="k === 'lagerleiterAttested'" cols="12" sm="6">
                <InputsFieldRow
                  field-key="lagerleiterAttested"
                  kind="select"
                  :model-value="toTri(draft.lagerleiterAttested)"
                  :items="triItems"
                  :midata-since="badgeOf('lagerleiterAttested')"
                  test-id="input-lagerleiterAttested"
                  :done="isResolved('lagerleiterAttested')"
                  :rule-ids="rulesOf('lagerleiterAttested')"
                  :rule-titles="ruleTitles"
                  @update:model-value="setTri('lagerleiterAttested')"
                />
              </v-col>
              <v-col v-else-if="countFields.some((f) => f.key === k)" cols="12" sm="6">
                <InputsFieldRow
                  :field-key="k"
                  kind="count"
                  :model-value="draft[k as CountKey] ?? null"
                  :midata-since="badgeOf(k)"
                  :error-messages="errorsOf(k as CountKey)"
                  :test-id="`input-${k}`"
                  :done="isResolved(k)"
                  :rule-ids="rulesOf(k as CountKey)"
                  :rule-titles="ruleTitles"
                  @update:model-value="(v) => setNum(k as CountKey, v)"
                />
              </v-col>
            </template>
          </v-row>
        </v-card-text>
      </v-card>

      <MidataCard :camp-iri="campIri" :inputs="draft" @adopt="onAdopt" />
      <NdsCard v-if="ndsOn" :camp-iri="campIri" :inputs="draft" @adopt="onAdoptNds" />

      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">{{ t('camps.inputs.sections.general') }}</v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" sm="6">
              <InputsFieldRow
                field-key="isJsCamp"
                kind="select"
                :model-value="toTri(draft.isJsCamp)"
                :items="triItems"
                test-id="input-isJsCamp"
                :rule-ids="rulesOf('isJsCamp')"
                :rule-titles="ruleTitles"
                @update:model-value="setTri('isJsCamp')"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <InputsFieldRow
                field-key="stufe"
                kind="select"
                :model-value="draft.stufe"
                :items="stufen"
                clearable
                test-id="input-stufe"
                :rule-ids="rulesOf('stufe')"
                :rule-titles="ruleTitles"
                @update:model-value="(v) => setField('stufe', (v as CoachInputs['stufe']) ?? null)"
              />
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <v-expansion-panels v-model="panels" multiple variant="accordion" class="mb-4">
        <v-expansion-panel id="teilnehmende" value="participants" eager data-testid="inputs-panel-participants">
          <v-expansion-panel-title class="text-subtitle-1">{{ t('camps.inputs.sections.participants') }}</v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-row class="pt-2">
              <v-col v-for="f in panelCount" :key="f.key" cols="12" sm="6">
                <InputsFieldRow
                  :field-key="f.key"
                  kind="count"
                  :model-value="draft[f.key] ?? null"
                  :midata-since="badgeOf(f.key)"
                  :error-messages="errorsOf(f.key)"
                  :test-id="`input-${f.key}`"
                  :rule-ids="rulesOf(f.key)"
                  :rule-titles="ruleTitles"
                  @update:model-value="(v) => setNum(f.key, v)"
                />
              </v-col>
              <v-col v-if="!isShownMissing('lagerleiterAttested')" cols="12" sm="6">
                <InputsFieldRow
                  field-key="lagerleiterAttested"
                  kind="select"
                  :model-value="toTri(draft.lagerleiterAttested)"
                  :items="triItems"
                  :midata-since="badgeOf('lagerleiterAttested')"
                  test-id="input-lagerleiterAttested"
                  :rule-ids="rulesOf('lagerleiterAttested')"
                  :rule-titles="ruleTitles"
                  @update:model-value="setTri('lagerleiterAttested')"
                />
              </v-col>
            </v-row>
          </v-expansion-panel-text>
        </v-expansion-panel>

        <v-expansion-panel id="regelmodule" value="rules" eager data-testid="inputs-panel-rules">
          <v-expansion-panel-title class="text-subtitle-1">{{ t('camps.inputs.sections.rules') }}</v-expansion-panel-title>
          <v-expansion-panel-text>
            <RuleModulesCard :camp-iri="campIri" embedded />
          </v-expansion-panel-text>
        </v-expansion-panel>

        <v-expansion-panel id="weitere" value="more" eager data-testid="inputs-panel-more">
          <v-expansion-panel-title class="text-subtitle-1">{{ t('camps.inputs.sections.more') }}</v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-row class="pt-2">
              <v-col v-for="f in moreCountFields" :key="f.key" cols="12" sm="6">
                <InputsFieldRow
                  :field-key="f.key"
                  kind="count"
                  :model-value="draft[f.key] ?? null"
                  :midata-since="badgeOf(f.key)"
                  :error-messages="errorsOf(f.key)"
                  :test-id="`input-${f.key}`"
                  :rule-ids="rulesOf(f.key)"
                  :rule-titles="ruleTitles"
                  @update:model-value="(v) => setNum(f.key, v)"
                />
              </v-col>
            </v-row>
            <v-textarea
              :model-value="draft.notes"
              :label="t('camps.inputs.fields.notes')"
              rows="3"
              auto-grow
              variant="outlined"
              hide-details
              class="mt-4"
              data-testid="input-notes"
              @update:model-value="(v: string) => setField('notes', v ?? '')"
            />
            <div class="text-caption text-medium-emphasis mt-1">{{ t('camps.inputs.purpose.notes') }}</div>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>

      <v-alert v-if="saveError" type="error" variant="tonal" class="mb-2">{{ t('camps.inputs.saveFailed') }}: {{ saveError }}</v-alert>
    </v-form>

    <v-dialog
      :model-value="leaveDialog"
      max-width="480"
      :close-on-back="false"
      @update:model-value="(v: boolean) => !v && answerLeave(false)"
    >
      <v-card data-testid="inputs-leave-dialog">
        <v-card-title class="text-h6">{{ t('camps.inputs.leave.title') }}</v-card-title>
        <v-card-text>{{ status === 'failed' ? t('camps.inputs.leave.textFailed') : t('camps.inputs.leave.text') }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="inputs-leave-discard" @click="answerLeave(true)">{{ t('camps.inputs.leave.discard') }}</v-btn>
          <v-btn variant="flat" color="primary" data-testid="inputs-leave-stay" @click="answerLeave(false)">{{ t('camps.inputs.leave.stay') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
