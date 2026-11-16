<script setup lang="ts">
/**
 * «Erkennung korrigieren»: grouped rows for the activity tags (catalog v2 §3.5) + SB approvals for `sb-*` tags.
 * Exclusive groups are btn-toggles with «Automatisch» (no tag = co-co decides); combinable groups are filter chips.
 * The group definition is shared with the resolver (domain/rules/lib/campConfigEdit.ts).
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCampRuleConfig } from '@/composables/useCampRuleConfig'
import {
  hasSbTag,
  isGroupVisible,
  TAG_GROUPS,
  tagsInGroup,
  withGroupChoice,
  withTagToggled,
  type TagGroup,
} from '@/domain/rules/lib/campConfigEdit'
import type { ActivityTag, CategoryClass, Iri, SbApprovalKind } from '@/domain/types'

const props = defineProps<{
  campIri: Iri
  activityIri: Iri
  /** J+S class derived from the category, shown in «Automatisch (aus Kategorie: …)» of the J+S row. */
  categoryClass?: CategoryClass | null
}>()
const { t } = useI18n()
const rc = useCampRuleConfig(() => props.campIri)
const error = ref<string | null>(null)

const tags = computed<ActivityTag[]>(() => rc.config.value.activityTags[props.activityIri] ?? [])
const groups = computed(() => TAG_GROUPS.filter((g) => isGroupVisible(g, tags.value)))
const approval = computed(() => rc.config.value.sbApprovals[props.activityIri] ?? null)
const kindItems = (['experte', 'bergfuehrer'] as const).map((v) => ({ value: v, title: t(`campConfig.sb.kind.${v}`) }))

/** Short option label inside a row: Ja/Nein, A/B/Keiner, else the full tag label. */
const OPTION_KEY: Partial<Record<ActivityTag, string>> = {
  unternehmung: 'yes',
  'keine-unternehmung': 'no',
  'js-aktivitaet': 'yes',
  'keine-js-aktivitaet': 'no',
  'ebb-a': 'a',
  'ebb-b': 'b',
  'kein-ebb': 'none',
  'kein-sb': 'none',
}
function optionLabel(tag: ActivityTag): string {
  const key = OPTION_KEY[tag]
  if (key) return t(`campConfig.tags.opt.${key}`)
  if (/^ef\d$/.test(tag)) return tag.slice(2)
  if (tag.startsWith('sb-')) return t(`rules.activityTag.${tag}`).replace(/^Sicherheitsbereich /, '')
  return t(`rules.activityTag.${tag}`)
}
function autoLabel(g: TagGroup): string {
  if (g.id === 'js' && props.categoryClass && props.categoryClass !== 'NONE') {
    return t('campConfig.tags.autoFromCategory', { category: t(`categoryClass.${props.categoryClass}`) })
  }
  return t('campConfig.tags.auto')
}
/** Exclusive groups have «Automatisch» + their tags; the multi group «sb» uses chips (incl. «Keiner»). */
const AUTO = 'auto'
const singleValue = (g: TagGroup): ActivityTag | typeof AUTO => tagsInGroup(g, tags.value)[0] ?? AUTO
const isOn = (tag: ActivityTag) => tags.value.includes(tag)

async function run(p: Promise<void>): Promise<void> {
  error.value = null
  try {
    await p
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
const setTags = (v: ActivityTag[]) => run(rc.setTags(props.activityIri, v))
const choose = (g: TagGroup, tag: ActivityTag | typeof AUTO | null | undefined) =>
  setTags(withGroupChoice(tags.value, g, !tag || tag === AUTO ? null : tag))
const toggle = (tag: ActivityTag) => setTags(withTagToggled(tags.value, tag))
function setApproval(kind: SbApprovalKind | null, date?: string | null): void {
  void run(rc.setSbApproval(props.activityIri, kind ? { kind, approvedOn: date !== undefined ? date : (approval.value?.approvedOn ?? null) } : null))
}
</script>

<template>
  <div class="mb-3" data-testid="activity-tags">
    <div class="text-subtitle-2">{{ t('campConfig.tags.title') }}</div>
    <div class="text-caption text-medium-emphasis mb-2">{{ t('campConfig.tags.hint') }}</div>
    <div v-for="g in groups" :key="g.id" class="tag-row" :data-testid="`tag-group-${g.id}`">
      <div v-if="g.mode !== 'switch'" class="text-body-2 tag-label">{{ t(`campConfig.tags.group.${g.id}`) }}</div>
      <v-btn-toggle
        v-if="g.mode === 'single'"
        :model-value="singleValue(g)"
        mandatory="force"
        density="compact"
        variant="outlined"
        divided
        color="primary"
        class="tag-toggle"
        @update:model-value="(v: ActivityTag | typeof AUTO | null) => choose(g, v)"
      >
        <v-btn :value="AUTO" size="small" :text="autoLabel(g)" :data-testid="`tag-${g.id}-auto`" />
        <v-btn v-for="tag in g.tags" :key="tag" :value="tag" size="small" :text="optionLabel(tag)" :data-testid="`tag-${tag}`" />
        <v-btn v-if="g.none" :value="g.none" size="small" :text="optionLabel(g.none)" :data-testid="`tag-${g.none}`" />
      </v-btn-toggle>
      <div v-else-if="g.mode === 'multi'" class="d-flex flex-wrap ga-1">
        <v-chip
          v-for="tag in g.tags"
          :key="tag"
          size="small"
          :variant="isOn(tag) ? 'flat' : 'outlined'"
          :color="isOn(tag) ? 'primary' : undefined"
          :prepend-icon="isOn(tag) ? 'mdi-check' : undefined"
          :text="optionLabel(tag)"
          :data-testid="`tag-${tag}`"
          @click="toggle(tag)"
        />
        <v-chip
          v-if="g.none"
          size="small"
          :variant="isOn(g.none) ? 'flat' : 'outlined'"
          :color="isOn(g.none) ? 'primary' : undefined"
          :prepend-icon="isOn(g.none) ? 'mdi-check' : undefined"
          :text="optionLabel(g.none)"
          :data-testid="`tag-${g.none}`"
          @click="toggle(g.none)"
        />
      </div>
      <v-switch
        v-else
        :model-value="isOn(g.tags[0]!)"
        density="compact"
        color="primary"
        hide-details
        :label="t(`rules.activityTag.${g.tags[0]}`)"
        :data-testid="`tag-${g.tags[0]}`"
        @update:model-value="toggle(g.tags[0]!)"
      />
    </div>
    <div v-if="hasSbTag(tags)" class="sb-box mt-2 pa-2" data-testid="activity-sb-approval">
      <div class="text-caption mb-1">{{ t('campConfig.sb.activityHint') }}</div>
      <v-select
        :model-value="approval?.kind ?? null"
        :items="kindItems"
        :label="t('campConfig.sb.kind.label')"
        clearable
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v: SbApprovalKind | null) => setApproval(v)"
      />
      <v-text-field
        :model-value="approval?.approvedOn ?? ''"
        type="date"
        :label="t('campConfig.sb.date')"
        :disabled="!approval || approval.kind === 'bergfuehrer'"
        :hint="approval?.kind === 'bergfuehrer' ? t('campConfig.sb.noDateNeeded') : undefined"
        persistent-hint
        density="compact"
        variant="outlined"
        @update:model-value="(v: string) => approval && setApproval(approval.kind, v || null)"
      />
    </div>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-2">{{ t('campConfig.tags.saveFailed') }}: {{ error }}</v-alert>
  </div>
</template>

<style scoped>
.tag-row {
  margin-bottom: 8px;
}
.tag-label {
  margin-bottom: 2px;
}
/* switch rows read like the other rows (body-2), not like form fields */
.tag-row :deep(.v-switch .v-label) {
  font-size: 0.875rem;
}
/* the buttons take the group's height: keep the fixed compact height (an auto height squeezes them to the text) */
.tag-toggle {
  max-width: 100%;
}
.sb-box {
  border: 1px dashed rgba(var(--v-border-color), 0.4);
  border-radius: 4px;
}
</style>
