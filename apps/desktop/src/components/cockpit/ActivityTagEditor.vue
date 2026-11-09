<script setup lang="ts">
/** Activity tags (catalog v2 §3.5) + SB approvals for `sb-*` tags; used in the activity drawer. */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCampRuleConfig } from '@/composables/useCampRuleConfig'
import { hasSbTag } from '@/domain/rules/lib/campConfigEdit'
import { ACTIVITY_TAGS, type ActivityTag, type Iri, type SbApprovalKind } from '@/domain/types'

const props = defineProps<{ campIri: Iri; activityIri: Iri }>()
const { t } = useI18n()
const rc = useCampRuleConfig(() => props.campIri)
const error = ref<string | null>(null)

const tags = computed<ActivityTag[]>(() => rc.config.value.activityTags[props.activityIri] ?? [])
const items = ACTIVITY_TAGS.map((tag) => ({ value: tag, title: t(`rules.activityTag.${tag}`) }))
const approval = computed(() => rc.config.value.sbApprovals[props.activityIri] ?? null)
const kindItems = (['experte', 'bergfuehrer'] as const).map((v) => ({ value: v, title: t(`campConfig.sb.kind.${v}`) }))

async function run(p: Promise<void>): Promise<void> {
  error.value = null
  try {
    await p
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
const setTags = (v: ActivityTag[]) => run(rc.setTags(props.activityIri, v))
function setApproval(kind: SbApprovalKind | null, date?: string | null): void {
  void run(rc.setSbApproval(props.activityIri, kind ? { kind, approvedOn: date !== undefined ? date : (approval.value?.approvedOn ?? null) } : null))
}
</script>

<template>
  <div class="mb-3" data-testid="activity-tags">
    <div class="text-subtitle-2">{{ t('campConfig.tags.title') }}</div>
    <div class="text-caption text-medium-emphasis mb-2">{{ t('campConfig.tags.hint') }}</div>
    <v-select
      :model-value="tags"
      :items="items"
      :label="t('campConfig.tags.label')"
      multiple
      chips
      closable-chips
      density="comfortable"
      variant="outlined"
      hide-details
      data-testid="activity-tag-select"
      @update:model-value="(v: ActivityTag[]) => setTags(v)"
    />
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
.sb-box {
  border: 1px dashed rgba(var(--v-border-color), 0.4);
  border-radius: 4px;
}
</style>
