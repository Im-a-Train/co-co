<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { safeExternalUrl, severityColor } from '@/domain/cockpit'
import { paramValueText, reasonText } from '@/components/camps/ruleConfigUi'
import type { Finding } from '@/domain/types'
import { useCampRoute } from '@/composables/useCampRoute'
import { useManualFindings } from '@/composables/useManualFindings'
import FindingExplainPanel from './FindingExplainPanel.vue'
import ManualFindingDialog from './ManualFindingDialog.vue'

const props = defineProps<{ finding: Finding; compact?: boolean; hideActions?: boolean; canExcludeCategory?: boolean }>()
const emit = defineEmits<{
  feedback: [finding: Finding]
  override: [finding: Finding]
  removeOverride: [finding: Finding]
  openActivity: [iri: string]
  excludeCategory: [finding: Finding]
  editRule: [finding: Finding]
}>()
const { t, te } = useI18n()
const moduleNote = computed(() => {
  const n = props.finding.moduleNote
  if (!n || !props.finding.module) return null
  return t('rules.module.suggestedNote', { module: t(`rules.catalog.module.${props.finding.module}`), reason: reasonText(t, te, n) })
})
const url = computed(() => safeExternalUrl(props.finding.source?.url))
/** Hilfsmittel key of the primary source (the cited source whose URL is the finding's source URL). */
const sourceKey = computed(() => {
  const list = props.finding.sources ?? []
  return (list.find((s) => s.url && s.url === props.finding.source?.url) ?? list[0])?.key ?? null
})
const isManual = computed(() => props.finding.origin === 'manual')
const { campIri } = useCampRoute()
const manualHandle = useManualFindings(campIri)
const manualRecord = computed(() => (isManual.value ? (manualHandle.items.value.find((m) => m.id === props.finding.id) ?? null) : null))
const editOpen = ref(false)
const confirmDelete = ref(false)
async function deleteManual() {
  if (!confirmDelete.value) {
    confirmDelete.value = true
    return
  }
  confirmDelete.value = false
  await manualHandle.remove(props.finding.id).catch(() => {})
}
const activityEvidence = computed(() =>
  props.finding.evidence.filter((e) => e.kind === 'activity' || e.kind === 'scheduleEntry'),
)
const otherEvidence = computed(() => props.finding.evidence.filter((e) => !activityEvidence.value.includes(e)))
</script>

<template>
  <v-card
    variant="outlined"
    density="compact"
    :class="{ 'opacity-60': finding.override }"
    :style="{ borderLeft: `4px solid rgb(var(--v-theme-${severityColor(finding.severity)}))` }"
  >
    <v-card-text class="py-3">
      <div class="d-flex align-center flex-wrap ga-2 mb-1">
        <v-chip v-if="isManual" size="x-small" color="primary" label data-testid="finding-manual-tag">
          {{ t('findings.manual.tag') }}
        </v-chip>
        <template v-else>
          <v-chip size="x-small" label variant="outlined">{{ finding.ruleId }}</v-chip>
          <v-chip size="x-small" label variant="text">{{ t(`confidence.${finding.confidence}`) }}</v-chip>
        </template>
        <v-chip v-if="finding.origin === 'ai'" size="x-small" color="secondary" label>
          {{ t('findings.aiTag') }}
        </v-chip>
        <v-chip v-if="finding.override" size="x-small" color="grey" label>{{ t('findings.overridden') }}</v-chip>
      </div>
      <div class="text-subtitle-1">{{ finding.title }}</div>
      <div class="text-body-2">{{ finding.message }}</div>

      <div v-if="moduleNote" class="text-caption text-warning mt-1" data-testid="finding-module-note">
        <v-icon icon="mdi-lightbulb-on-outline" size="x-small" /> {{ moduleNote }}
      </div>
      <div v-for="n in finding.paramNotes ?? []" :key="n.key" class="text-caption text-medium-emphasis mt-1" data-testid="finding-param-note">
        <v-icon icon="mdi-tune-variant" size="x-small" />
        {{ t('rules.paramNote', { label: n.label, value: paramValueText(n.value), default: paramValueText(n.default) }) }}
      </div>

      <div v-if="finding.override" class="text-caption mt-1">
        {{ t('findings.overrideReason', { reason: finding.override.reason }) }}
      </div>

      <div v-if="!compact && finding.evidence.length" class="d-flex align-center flex-wrap ga-1 mt-2">
        <span class="text-caption text-medium-emphasis">{{ t('findings.evidence') }}:</span>
        <v-chip
          v-for="(e, i) in activityEvidence"
          :key="`a${i}`"
          size="small"
          variant="tonal"
          prepend-icon="mdi-calendar-text"
          :text="e.label"
          :title="e.snippet"
          @click="e.iri && emit('openActivity', e.iri)"
        />
        <v-chip
          v-for="(e, i) in otherEvidence"
          :key="`o${i}`"
          size="small"
          variant="outlined"
          :text="e.label"
          :title="e.snippet"
        />
      </div>

      <FindingExplainPanel v-if="!compact && finding.explain" :finding="finding" />

      <div class="d-flex align-center flex-wrap ga-2 mt-2">
        <template v-if="sourceKey">
          <router-link :to="{ name: 'resources', query: { key: sourceKey } }" class="text-body-2" data-testid="finding-source-link">
            {{ t('findings.source') }}: {{ finding.source?.title }}
          </router-link>
          <a v-if="url" :href="url" target="_blank" rel="noopener noreferrer" :title="t('resources.externalLink')" :aria-label="t('resources.externalLink')">
            <v-icon icon="mdi-open-in-new" size="x-small" />
          </a>
        </template>
        <a v-else-if="url" :href="url" target="_blank" rel="noopener noreferrer" class="text-body-2">
          <v-icon icon="mdi-open-in-new" size="x-small" />
          {{ t('findings.source') }}: {{ finding.source?.title }}
        </a>
        <v-spacer />
        <template v-if="isManual && !compact && !hideActions && manualRecord">
          <v-btn
            size="small"
            variant="text"
            prepend-icon="mdi-pencil-outline"
            :text="t('findings.manual.edit')"
            data-testid="finding-manual-edit"
            @click="editOpen = true"
          />
          <v-btn
            size="small"
            variant="text"
            :color="confirmDelete ? 'error' : undefined"
            prepend-icon="mdi-delete-outline"
            :text="confirmDelete ? t('findings.manual.deleteConfirm') : t('findings.manual.delete')"
            data-testid="finding-manual-delete"
            @click="deleteManual"
            @blur="confirmDelete = false"
          />
        </template>
        <template v-else-if="!compact && !hideActions && !isManual">
          <v-btn
            v-if="canExcludeCategory"
            size="small"
            variant="text"
            prepend-icon="mdi-filter-remove-outline"
            :text="t('findings.categoryExclusion.forRule')"
            data-testid="exclude-category-rule"
            @click="emit('excludeCategory', finding)"
          />
          <v-btn
            v-if="finding.origin === 'rule'"
            size="small"
            variant="text"
            prepend-icon="mdi-pencil-ruler"
            :text="t('findings.triage.editRule')"
            data-testid="edit-rule"
            @click="emit('editRule', finding)"
          />
          <v-btn
            v-if="!finding.override"
            size="small"
            variant="text"
            prepend-icon="mdi-eye-off-outline"
            :text="t('findings.override')"
            @click="emit('override', finding)"
          />
          <v-btn
            v-else
            size="small"
            variant="text"
            prepend-icon="mdi-undo"
            :text="t('findings.removeOverride')"
            @click="emit('removeOverride', finding)"
          />
        </template>
        <v-btn
          v-if="!hideActions"
          size="small"
          variant="tonal"
          color="primary"
          prepend-icon="mdi-message-draw"
          :text="t('findings.createFeedback')"
          @click="emit('feedback', finding)"
        />
      </div>
    </v-card-text>
    <ManualFindingDialog
      v-if="manualRecord"
      v-model="editOpen"
      :camp-iri="manualRecord.campIri"
      :scope="manualRecord.scope"
      :activity-iri="manualRecord.activityIri"
      :document-id="manualRecord.documentId"
      :anchor="manualRecord.anchor"
      :edit-id="manualRecord.id"
    />
  </v-card>
</template>
