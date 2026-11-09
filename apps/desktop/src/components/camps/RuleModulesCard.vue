<script setup lang="ts">
/**
 * Card «Regelmodule» of the coach-input view (catalog v2 §2.4): Sportart, 3-state toggles per module with
 * the effective state and reasons, Lagerkontext, Angebotskontext and the camp-level SB-Winter approval.
 * Changes are saved immediately (campRuleConfig, separate from the form's «Speichern»).
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { reasonText } from '@/components/camps/ruleConfigUi'
import { useCampRuleConfig } from '@/composables/useCampRuleConfig'
import type { CampRuleConfig, Iri, ModuleCoachState, ModuleId, ModuleState, SbApprovalKind } from '@/domain/types'

const props = defineProps<{ campIri: Iri }>()
const { t, te } = useI18n()
const rc = useCampRuleConfig(() => props.campIri)
const saveError = ref<string | null>(null)

async function run(p: Promise<void>): Promise<void> {
  saveError.value = null
  try {
    await p
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  }
}

const toggleable = computed(() => rc.modules.value.filter((m) => m.toggleable))
const coachStateOf = (id: ModuleId): ModuleCoachState => rc.config.value.modules[id] ?? 'auto'
const STATE_COLOR: Record<ModuleState, string> = { on: 'success', suggested: 'warning', off: 'grey' }

const coachStates: ModuleCoachState[] = ['auto', 'on', 'off']

type Tri = 'yes' | 'no' | 'unset'
const toTri = (v: boolean | null): Tri => (v === true ? 'yes' : v === false ? 'no' : 'unset')
const fromTri = (v: Tri): boolean | null => (v === 'yes' ? true : v === 'no' ? false : null)
const triItems = (['unset', 'yes', 'no'] as Tri[]).map((v) => ({ value: v, title: t(`campConfig.tri.${v}`) }))

const regionItems = (['mittelland', 'jura', 'voralpen', 'alpen', 'ausland'] as const).map((v) => ({ value: v, title: t(`campConfig.context.region.${v}`) }))
const formItems = (['haus', 'zelt', 'gemischt'] as const).map((v) => ({ value: v, title: t(`campConfig.context.campForm.${v}`) }))
const sportItems = (['lst', 'other'] as const).map((v) => ({ value: v, title: t(`campConfig.modules.sport.${v}`) }))
const kindItems = (['experte', 'bergfuehrer'] as const).map((v) => ({ value: v, title: t(`campConfig.sb.kind.${v}`) }))

const angebotTri = ['other4DayCamp', 'unternehmungElsewhere', 'efCoveredElsewhere'] as const

const campApproval = computed(() => rc.config.value.sbApprovals.camp ?? null)
const showCampSb = computed(() => rc.config.value.camp.winterSafeAccess === false && rc.campInWinter.value)

function setCampSb(kind: SbApprovalKind | null, date?: string | null): void {
  const cur = campApproval.value
  void run(rc.setSbApproval('camp', kind ? { kind, approvedOn: date !== undefined ? date : (cur?.approvedOn ?? null) } : null))
}

type CampPatch = Partial<CampRuleConfig['camp']>
</script>

<template>
  <v-card variant="outlined" class="mb-4" data-testid="rule-modules-card">
    <v-card-title class="text-subtitle-1">{{ t('campConfig.modules.title') }}</v-card-title>
    <v-card-text>
      <p class="text-body-2 text-medium-emphasis mb-3">{{ t('campConfig.modules.intro') }}</p>
      <p class="text-caption text-medium-emphasis mb-3">{{ t('campConfig.modules.jsHint') }}</p>

      <v-select
        :model-value="rc.sport.value"
        :items="sportItems"
        :label="t('campConfig.modules.sport.label')"
        variant="outlined"
        density="comfortable"
        class="mb-4"
        data-testid="config-sport"
        @update:model-value="(v: 'lst' | 'other') => run(rc.setSport(v))"
      />

      <div v-for="m in toggleable" :key="m.id" class="module-row py-2" :data-testid="`module-${m.id}`">
        <div class="d-flex flex-wrap align-center ga-3">
          <div class="module-name text-body-1">{{ t(`rules.catalog.module.${m.id}`) }}</div>
          <v-btn-toggle
            :model-value="coachStateOf(m.id)"
            mandatory
            density="comfortable"
            variant="outlined"
            divided
            color="primary"
            @update:model-value="(v: ModuleCoachState) => run(rc.setModule(m.id, v))"
          >
            <v-btn v-for="s in coachStates" :key="s" :value="s" size="small" :data-testid="`module-${m.id}-${s}`">
              {{ t(`rules.module.state.${s}`) }}
            </v-btn>
          </v-btn-toggle>
          <v-chip
            v-if="rc.moduleStates.value[m.id]"
            size="small"
            label
            variant="tonal"
            :color="STATE_COLOR[rc.moduleStates.value[m.id]!.state]"
            :data-testid="`module-${m.id}-effective`"
          >
            {{ t('campConfig.modules.effective') }}: {{ t(`rules.module.state.${rc.moduleStates.value[m.id]!.state}`) }}
          </v-chip>
        </div>
        <ul v-if="coachStateOf(m.id) === 'auto' && rc.moduleStates.value[m.id]?.reasons.length" class="reasons text-caption text-medium-emphasis">
          <li v-for="(r, i) in rc.moduleStates.value[m.id]!.reasons" :key="i">{{ reasonText(t, te, r) }}</li>
        </ul>
      </div>
      <div v-if="!Object.keys(rc.moduleStates.value).length" class="text-caption text-medium-emphasis">{{ t('campConfig.modules.waiting') }}</div>

      <v-divider class="my-4" />

      <div class="text-subtitle-2 mb-2">{{ t('campConfig.context.title') }}</div>
      <v-row>
        <v-col cols="12" sm="6">
          <v-select
            :model-value="rc.config.value.camp.region"
            :items="regionItems"
            :label="t('campConfig.context.region.label')"
            clearable
            variant="outlined"
            density="comfortable"
            hide-details
            data-testid="config-region"
            @update:model-value="(v: CampPatch['region'] | null) => run(rc.setCamp({ region: v ?? null }))"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <v-select
            :model-value="rc.config.value.camp.campForm"
            :items="formItems"
            :label="t('campConfig.context.campForm.label')"
            clearable
            variant="outlined"
            density="comfortable"
            hide-details
            data-testid="config-campForm"
            @update:model-value="(v: CampPatch['campForm'] | null) => run(rc.setCamp({ campForm: v ?? null }))"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <v-select
            :model-value="toTri(rc.config.value.camp.winterSafeAccess)"
            :items="triItems"
            :label="t('campConfig.context.winterSafeAccess')"
            variant="outlined"
            density="comfortable"
            hide-details
            data-testid="config-winterSafeAccess"
            @update:model-value="(v: Tri) => run(rc.setCamp({ winterSafeAccess: fromTri(v) }))"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <v-select
            :model-value="toTri(rc.config.value.camp.abroad)"
            :items="triItems"
            :label="t('campConfig.context.abroad')"
            variant="outlined"
            density="comfortable"
            hide-details
            data-testid="config-abroad"
            @update:model-value="(v: Tri) => run(rc.setCamp({ abroad: fromTri(v) }))"
          />
        </v-col>
      </v-row>

      <div v-if="showCampSb" class="sb-box mt-4 pa-3" data-testid="sb-camp">
        <div class="text-subtitle-2">{{ t('campConfig.sb.campTitle') }}</div>
        <div class="text-caption text-medium-emphasis mb-2">{{ t('campConfig.sb.campHint') }}</div>
        <v-row>
          <v-col cols="12" sm="6">
            <v-select
              :model-value="campApproval?.kind ?? null"
              :items="kindItems"
              :label="t('campConfig.sb.kind.label')"
              clearable
              variant="outlined"
              density="comfortable"
              hide-details
              @update:model-value="(v: SbApprovalKind | null) => setCampSb(v)"
            />
          </v-col>
          <v-col cols="12" sm="6">
            <v-text-field
              :model-value="campApproval?.approvedOn ?? ''"
              type="date"
              :label="t('campConfig.sb.date')"
              :disabled="!campApproval || campApproval.kind === 'bergfuehrer'"
              :hint="campApproval?.kind === 'bergfuehrer' ? t('campConfig.sb.noDateNeeded') : undefined"
              persistent-hint
              variant="outlined"
              density="comfortable"
              @update:model-value="(v: string) => campApproval && setCampSb(campApproval.kind, v || null)"
            />
          </v-col>
        </v-row>
      </div>

      <v-divider class="my-4" />

      <div class="text-subtitle-2 mb-2">{{ t('campConfig.angebot.title') }}</div>
      <v-row>
        <v-col v-for="f in angebotTri" :key="f" cols="12" sm="6">
          <v-select
            :model-value="toTri(rc.config.value.angebot[f])"
            :items="triItems"
            :label="t(`campConfig.angebot.${f}`)"
            variant="outlined"
            density="comfortable"
            hide-details
            :data-testid="`config-${f}`"
            @update:model-value="(v: Tri) => run(rc.setAngebot({ [f]: fromTri(v) }))"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <v-text-field
            :model-value="rc.config.value.angebot.lastActivityDate ?? ''"
            type="date"
            :label="t('campConfig.angebot.lastActivityDate')"
            variant="outlined"
            density="comfortable"
            hide-details
            data-testid="config-lastActivityDate"
            @update:model-value="(v: string) => run(rc.setAngebot({ lastActivityDate: v || null }))"
          />
        </v-col>
      </v-row>

      <v-alert v-if="saveError || rc.error.value" type="error" variant="tonal" density="compact" class="mt-3">
        {{ t('campConfig.modules.saveFailed') }}: {{ saveError ?? rc.error.value }}
      </v-alert>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.module-row + .module-row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.module-name {
  min-width: 14rem;
}
.reasons {
  margin: 0.25rem 0 0 0;
  padding-left: 1.25rem;
}
.sb-box {
  border: 1px dashed rgba(var(--v-border-color), 0.4);
  border-radius: 4px;
}
</style>
