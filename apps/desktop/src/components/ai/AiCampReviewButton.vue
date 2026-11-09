<script setup lang="ts">
/**
 * AI review of the whole camp program ("KI-Lagerreview", ADR 0014). Guidance = active ai/hard rules,
 * program = redacted camp content; the preview dialog always comes first. Results are emitted as findings
 * (origin 'ai', never 'must') and go to useFindings().addAiFindings. Renders nothing while AI is off.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAi, useAiFlow } from '@/composables/useAi'
import { useCampRuleConfig } from '@/composables/useCampRuleConfig'
import { useRuleState } from '@/composables/useRuleState'
import { aiGuidanceRules } from '@/domain/rules/aiGuidance'
import { loadEffectivePacks } from '@/domain/rules/editsStore'
import { selectPacks } from '@/domain/rules/packs'
import { disabledRuleIds } from '@/domain/rules/ruleState'
import { getAppSettings } from '@/domain/storage/settings'
import { reviewCamp, runCampReview } from '@/domain/zones/features'
import type { CampFacts, Finding, ModuleId, ModuleState } from '@/domain/types'
import RedactionPreviewDialog from './RedactionPreviewDialog.vue'

const props = defineProps<{ facts: CampFacts | null; findings: Finding[] }>()
const emit = defineEmits<{ findings: [findings: Finding[]] }>()

const { t } = useI18n()
const { ready } = useAi()
const { state: ruleState } = useRuleState()
const flow = useAiFlow<Finding[]>()
// Module states of this camp (same resolution as the engine): rules of modules that are off are no guidance.
const ruleConfig = useCampRuleConfig(() => props.facts?.camp.iri ?? '')
const moduleStates = computed(() => {
  const out: Partial<Record<ModuleId, ModuleState>> = {}
  for (const [id, res] of Object.entries(ruleConfig.moduleStates.value)) if (res) out[id as ModuleId] = res.state
  return out
})
const note = ref<string | null>(null)

async function start() {
  const facts = props.facts
  if (!facts) return
  note.value = null
  let enabledPackIds: string[] = []
  try {
    enabledPackIds = (await getAppSettings()).rulePacks
  } catch {
    // no storage: all packs
  }
  const packs = selectPacks(loadEffectivePacks(), enabledPackIds)
  const guidance = aiGuidanceRules(packs, {
    campStart: facts.camp.start ? facts.camp.start.slice(0, 10) : null,
    disabledRuleIds: disabledRuleIds(ruleState.value, facts.camp.iri),
    moduleStates: moduleStates.value,
  })
  flow.start(
    () => reviewCamp(facts, guidance, props.findings),
    (p) => runCampReview(p, facts),
    (list) => {
      note.value = list.length ? t('ai.campReview.done', { n: list.length }) : t('ai.campReview.none')
      emit('findings', list)
    },
  )
}
</script>

<template>
  <span v-if="ready" class="d-inline-flex align-center ga-2">
    <v-btn
      size="small"
      variant="tonal"
      prepend-icon="mdi-creation"
      :disabled="!facts"
      :text="t('ai.campReview.button')"
      data-testid="ai-camp-review"
      @click="start"
    />
    <span v-if="note" class="text-caption text-medium-emphasis" data-testid="ai-camp-review-note">{{ note }}</span>
    <RedactionPreviewDialog
      v-model="flow.open.value"
      :preview="flow.preview.value"
      :busy="flow.busy.value"
      :error="flow.error.value"
      @confirm="flow.confirm"
      @cancel="flow.cancel"
    />
  </span>
</template>
