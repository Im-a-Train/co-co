<script setup lang="ts">
/**
 * «Mit KI aktualisieren»: the coach picks Hilfsmittel, sees the exact prompt, the AI proposes a patch which is
 * validated (origin 'ai') and shown as a diff. Nothing is applied without the coach pressing «übernehmen».
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResources } from '@/composables/useResources'
import { knownSourceKeys, saveRuleEdit } from '@/domain/rules/editsStore'
import { buildRuleUpdateRequest, parseRuleUpdate, runRuleUpdate, type RuleUpdatePreview, type RuleUpdateProposal } from '@/domain/zones/ruleUpdate'
import type { RuleMeta } from '@/domain/types'
import RuleDiffList from './RuleDiffList.vue'

const props = defineProps<{ meta: RuleMeta }>()
const emit = defineEmits<{ applied: [] }>()
const { t } = useI18n()
const store = useResources()

const withText = computed(() => store.resources.value.filter((r) => (r.content ?? '').trim()))
const picked = ref<string[]>([])
const preview = ref<RuleUpdatePreview | null>(null)
const proposal = ref<RuleUpdateProposal | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

function prepare() {
  error.value = notice.value = null
  proposal.value = null
  try {
    preview.value = buildRuleUpdateRequest(
      props.meta,
      withText.value.filter((r) => picked.value.includes(r.key)),
    )
  } catch (e) {
    preview.value = null
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function send() {
  if (!preview.value) return
  busy.value = true
  error.value = null
  try {
    const text = await runRuleUpdate(preview.value)
    proposal.value = parseRuleUpdate(text, props.meta, knownSourceKeys(), preview.value.usedKeys)
    preview.value = null
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function apply() {
  const p = proposal.value
  if (!p || p.errors.length || !Object.keys(p.patch).length) return
  busy.value = true
  error.value = null
  try {
    await saveRuleEdit(props.meta.id, p.patch, { origin: 'ai', reason: p.reason, resourceKeys: p.resourceKeys.length ? p.resourceKeys : (picked.value as string[]) })
    proposal.value = null
    notice.value = t('rules.edit.ai.applied')
    emit('applied')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div data-testid="rule-ai-panel">
    <p class="text-body-2 text-medium-emphasis mb-3">{{ t('rules.edit.ai.intro') }}</p>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3" :text="error" />
    <v-alert v-if="notice" type="success" variant="tonal" density="compact" class="mb-3" :text="notice" />

    <p v-if="!withText.length" class="text-body-2">{{ t('rules.edit.ai.pickNone') }}</p>
    <template v-else>
      <v-select
        v-model="picked"
        :items="withText.map((r) => ({ value: r.key, title: `${r.key} – ${r.title}` }))"
        :label="t('rules.edit.ai.pick')"
        multiple
        chips
        closable-chips
        density="compact"
        variant="outlined"
        data-testid="rule-ai-pick"
        class="mb-2"
      />
      <v-btn size="small" variant="tonal" prepend-icon="mdi-creation" :disabled="!picked.length || busy" :text="t('rules.edit.ai.prepare')" data-testid="rule-ai-prepare" @click="prepare" />
    </template>

    <div v-if="preview" class="mt-4" data-testid="rule-ai-preview">
      <h4 class="text-subtitle-2">{{ t('rules.edit.ai.previewTitle') }}</h4>
      <p class="text-caption text-medium-emphasis mb-2">{{ t('rules.edit.ai.previewHint') }}</p>
      <pre class="prompt-preview">{{ preview.previewText }}</pre>
      <v-btn color="primary" :loading="busy" :text="t('rules.edit.ai.send')" data-testid="rule-ai-send" @click="send" />
      <span v-if="busy" class="ml-3 text-caption">{{ t('rules.edit.ai.running') }}</span>
    </div>

    <div v-if="proposal" class="mt-4" data-testid="rule-ai-proposal">
      <h4 class="text-subtitle-2 mb-2">{{ t('rules.edit.ai.proposal') }}</h4>
      <v-alert v-if="proposal.errors.length" type="error" variant="tonal" density="compact" class="mb-3" data-testid="rule-ai-invalid">
        <strong>{{ t('rules.edit.ai.invalid') }}</strong>
        <ul class="ml-4">
          <li v-for="e in proposal.errors" :key="e">{{ e }}</li>
        </ul>
      </v-alert>
      <template v-else>
        <p v-if="proposal.reason" class="text-body-2 mb-2"><strong>{{ t('rules.edit.ai.reason') }}:</strong> {{ proposal.reason }}</p>
        <v-alert v-if="!Object.keys(proposal.patch).length" type="info" variant="tonal" density="compact" :text="t('rules.edit.ai.noChange')" />
        <RuleDiffList v-else-if="proposal.result" :before="meta" :after="proposal.result" />
      </template>
      <div class="mt-3 d-flex ga-2">
        <v-btn v-if="!proposal.errors.length && Object.keys(proposal.patch).length" color="primary" :loading="busy" :text="t('rules.edit.ai.apply')" data-testid="rule-ai-apply" @click="apply" />
        <v-btn variant="text" :text="t('rules.edit.ai.discard')" data-testid="rule-ai-discard" @click="proposal = null" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.prompt-preview {
  max-height: 16rem;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 0.75rem;
  padding: 8px;
  margin-bottom: 12px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border-radius: 4px;
}
</style>
