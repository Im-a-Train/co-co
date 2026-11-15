<script setup lang="ts">
/** Details of one rule inside the catalogue (severity, confidence, validity, inputs, source). */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAi } from '@/composables/useAi'
import { useResources } from '@/composables/useResources'
import { loadEffectivePacks } from '@/domain/rules/editsStore'
import { safeExternalUrl } from '@/domain/cockpit'
import { getSourceRegistry } from '@/domain/rules/packs/registry'
import type { Rule } from '@/domain/types'

const props = defineProps<{ rule: Rule }>()
const { t } = useI18n()
const { version: resourcesVersion } = useResources()
const { ready: aiReady } = useAi()

const meta = computed(() => props.rule.meta)
const sources = computed(() => {
  void resourcesVersion.value // the effective registry changes with the Hilfsmittel
  const reg = getSourceRegistry()
  return (meta.value.sources ?? []).map((ref) => {
    const r = reg.resolve(ref)
    return { key: ref.key, page: ref.page, quote: ref.quote, binding: r?.binding ?? ref.binding === true, title: r?.title ?? ref.key, url: safeExternalUrl(r?.url) }
  })
})
const guarded = computed(() => meta.value.confidence === 'unverified' || meta.value.confidence === 'conflict')

/** The finding text as the coach sees it: «{src}» dropped, other placeholders shown as «…». */
const example = computed(() =>
  meta.value.message.replace(/\{src\}/g, '').replace(/\{\w+\}/g, '…').replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ').trim(),
)

const RULE_ID_RE = /\b[A-Z]{2,}(?:-[A-Z0-9]+)+\b/g
/** Retired rules name their successors in the description: turn known rule ids into links. */
const descriptionSegments = computed<Array<{ text: string; ruleId?: string }>>(() => {
  const text = meta.value.description
  if (meta.value.status !== 'retired') return [{ text }]
  let known: Set<string>
  try {
    known = new Set(loadEffectivePacks().flatMap((p) => p.rules.map((r) => r.meta.id)))
  } catch {
    return [{ text }]
  }
  const out: Array<{ text: string; ruleId?: string }> = []
  let last = 0
  for (const m of text.matchAll(RULE_ID_RE)) {
    if (!known.has(m[0]) || m[0] === meta.value.id) continue
    if (m.index! > last) out.push({ text: text.slice(last, m.index) })
    out.push({ text: m[0], ruleId: m[0] })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
})

function fmt(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}
</script>

<template>
  <div class="rule-card">
    <div v-if="meta.kind === 'ai'" class="mb-3" data-testid="kind-ai-block">
      <v-chip size="small" label color="secondary" variant="tonal" prepend-icon="mdi-creation" data-testid="kind-ai-chip">{{ t('rules.catalog.kind.aiChip') }}</v-chip>
      <span class="text-caption text-medium-emphasis ml-2">{{ t('rules.catalog.kind.aiHint') }}</span>
      <v-alert v-if="!aiReady" type="info" variant="tonal" density="compact" class="mt-2" :text="t('rules.catalog.kind.aiOff')" data-testid="kind-ai-off" />
    </div>

    <v-alert v-if="meta.status === 'retired'" type="info" variant="tonal" density="compact" class="mb-3" data-testid="rule-retired-note">
      {{ t('rules.status.retired') }}
    </v-alert>
    <p class="text-body-2 mb-3" data-testid="rule-description">
      <template v-for="(seg, i) in descriptionSegments" :key="i">
        <router-link v-if="seg.ruleId" :to="{ name: 'rules', query: { rule: seg.ruleId } }" data-testid="rule-successor-link">{{ seg.text }}</router-link>
        <template v-else>{{ seg.text }}</template>
      </template>
    </p>

    <div v-if="example" class="mb-3" data-testid="rule-example">
      <div class="text-caption text-medium-emphasis">{{ t('rules.catalog.card.example') }}</div>
      <div class="text-body-2 example">{{ example }}</div>
    </div>

    <div class="mb-1">
      <div class="text-caption text-medium-emphasis">{{ t('rules.catalog.card.sources') }}</div>
      <ul class="sources" data-testid="rule-sources">
        <li v-for="s in sources" :key="`${s.key}${s.page}`">
          <router-link :to="{ name: 'resources', query: { key: s.key } }" :title="t('resources.linkTitle', { key: s.key })" data-testid="rule-source-link">{{ s.title }}</router-link>
          <a v-if="s.url" :href="s.url" target="_blank" rel="noopener noreferrer" class="ml-1" :title="t('resources.externalLink')" :aria-label="t('resources.externalLink')">
            <v-icon icon="mdi-open-in-new" size="x-small" />
          </a>
          <span v-if="s.page">, {{ s.page }}</span>
          <v-chip v-if="s.binding" size="x-small" label variant="tonal" color="primary" class="ml-1">{{ t('rules.catalog.card.sourceBinding') }}</v-chip>
          <div v-if="s.quote" class="text-caption text-medium-emphasis">«{{ s.quote }}»</div>
        </li>
        <li v-if="!sources.length"><a :href="meta.source.url" target="_blank" rel="noopener noreferrer">{{ meta.source.title }}</a></li>
      </ul>
    </div>

    <details class="technical mt-3" data-testid="rule-technical">
      <summary class="text-body-2">{{ t('rules.catalog.card.technical') }}</summary>
      <v-table density="compact" class="rule-meta mt-2">
        <tbody>
          <tr>
            <th scope="row">{{ t('rules.catalog.card.message') }}</th>
            <td class="text-medium-emphasis">{{ meta.message }}</td>
          </tr>
          <tr v-if="meta.feedbackText">
            <th scope="row">{{ t('rules.catalog.card.feedbackText') }}</th>
            <td class="text-medium-emphasis">{{ meta.feedbackText }}</td>
          </tr>
          <tr>
            <th scope="row">{{ t('rules.catalog.card.severity') }}</th>
            <td>{{ t(`severity.${meta.severity}`) }}</td>
          </tr>
          <tr>
            <th scope="row">{{ t('rules.catalog.card.confidence') }}</th>
            <td>{{ t(`confidence.${meta.confidence}`) }}</td>
          </tr>
          <tr>
            <th scope="row">{{ t('rules.catalog.card.scope') }}</th>
            <td>{{ t(`rules.catalog.scope.${meta.scope}`) }}</td>
          </tr>
          <tr v-if="meta.inputs?.length">
            <th scope="row">{{ t('rules.catalog.card.needs') }}</th>
            <td>{{ meta.inputs.map((input) => t(`rules.catalog.input.${input}`)).join(', ') }}</td>
          </tr>
          <tr>
            <th scope="row">{{ t('rules.catalog.card.validity') }}</th>
            <td>
              <template v-if="meta.validFrom || meta.validTo">
                <span v-if="meta.validFrom">{{ t('rules.catalog.card.validFrom', { date: fmt(meta.validFrom) }) }}</span>
                <span v-if="meta.validFrom && meta.validTo">, </span>
                <span v-if="meta.validTo">{{ t('rules.catalog.card.validTo', { date: fmt(meta.validTo) }) }}</span>
              </template>
              <template v-else>{{ t('rules.catalog.card.always') }}</template>
            </td>
          </tr>
          <tr v-if="meta.tags?.length">
            <th scope="row">{{ t('rules.catalog.card.tags') }}</th>
            <td>{{ meta.tags.join(', ') }}</td>
          </tr>
        </tbody>
      </v-table>
      <div class="text-caption text-medium-emphasis mt-2">
        {{ t('rules.catalog.card.version', { version: meta.version }) }}
        <span v-if="guarded"> · {{ t('rules.catalog.card.mustGuard') }}</span>
      </div>
    </details>
  </div>
</template>

<style scoped>
.rule-meta th {
  width: 9rem;
  font-weight: 500;
  vertical-align: top;
}
.example {
  font-style: italic;
}
.technical summary {
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.sources {
  list-style: none;
  padding: 0;
  margin: 0;
}
.rule-meta td {
  white-space: normal;
}
</style>
