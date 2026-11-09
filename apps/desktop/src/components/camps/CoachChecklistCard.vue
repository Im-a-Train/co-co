<script setup lang="ts">
/** Card «Coach-Checkliste» (catalog v2 §8): per camp, done/note per item, grouped by module. */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCampRuleConfig } from '@/composables/useCampRuleConfig'
import { safeExternalUrl } from '@/domain/cockpit'
import { checklistProgress, groupChecklist, type ChecklistItem, type ChecklistKind } from '@/domain/rules/lib/checklist'
import { getSourceRegistry } from '@/domain/rules/packs/registry'
import type { Iri } from '@/domain/types'

const props = defineProps<{ campIri: Iri }>()
const { t } = useI18n()
const rc = useCampRuleConfig(() => props.campIri)
const saveError = ref<string | null>(null)
const openNotes = ref<Record<string, boolean>>({})

const groups = computed(() => groupChecklist(rc.checklist.value))
const progress = computed(() => checklistProgress(rc.checklist.value, rc.config.value.checklist))

const KIND_COLOR: Record<ChecklistKind, string> = { B: 'primary', E: 'info', '2014': 'grey' }

function sourcesOf(item: ChecklistItem) {
  const reg = getSourceRegistry()
  return item.sources.map((s) => {
    const r = reg.resolve(s)
    return { key: s.key, page: s.page, title: r?.title ?? s.key, url: safeExternalUrl(r?.url) }
  })
}

async function patch(id: string, p: { done?: boolean; note?: string }): Promise<void> {
  saveError.value = null
  try {
    await rc.setChecklistItem(id, p)
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  }
}
const noteOf = (id: string): string => rc.config.value.checklist[id]?.note ?? ''
const doneOf = (id: string): boolean => rc.config.value.checklist[id]?.done === true
const noteOpen = (id: string): boolean => openNotes.value[id] === true || noteOf(id) !== ''
</script>

<template>
  <v-card variant="outlined" class="mb-4" data-testid="coach-checklist-card">
    <v-card-title class="d-flex align-center flex-wrap ga-2 text-subtitle-1">
      <span>{{ t('campConfig.checklist.title') }}</span>
      <v-chip v-if="progress.total" size="x-small" label variant="tonal" data-testid="checklist-progress">
        {{ t('campConfig.checklist.progress', progress) }}
      </v-chip>
    </v-card-title>
    <v-card-text>
      <p class="text-body-2 text-medium-emphasis mb-3">{{ t('campConfig.checklist.intro') }}</p>
      <div v-if="!groups.length" class="text-body-2 text-medium-emphasis">{{ t('campConfig.checklist.empty') }}</div>

      <section v-for="g in groups" :key="g.module" class="mb-4" :data-testid="`checklist-group-${g.module}`">
        <h3 class="text-subtitle-2 mb-1">{{ t(`rules.catalog.module.${g.module}`) }}</h3>
        <div v-for="item in g.items" :key="item.id" class="cl-item py-1" :data-testid="`checklist-${item.id}`">
          <div class="d-flex align-start ga-2">
            <v-checkbox-btn
              :model-value="doneOf(item.id)"
              density="compact"
              :aria-label="t('campConfig.checklist.done')"
              @update:model-value="(v: boolean | null) => patch(item.id, { done: v === true })"
            />
            <div class="flex-grow-1">
              <div class="text-body-2" :class="{ 'text-medium-emphasis': doneOf(item.id) }">{{ item.text }}</div>
              <div class="d-flex flex-wrap align-center ga-1 mt-1">
                <code class="text-caption text-medium-emphasis">{{ item.id }}</code>
                <v-chip
                  v-for="k in item.kinds"
                  :key="k"
                  size="x-small"
                  label
                  variant="tonal"
                  :color="KIND_COLOR[k]"
                  :title="t(`campConfig.checklist.kindHint.${k}`)"
                >
                  {{ t(`campConfig.checklist.kind.${k}`) }}
                </v-chip>
                <template v-for="s in sourcesOf(item)" :key="`${s.key}${s.page}`">
                  <a v-if="s.url" :href="s.url" target="_blank" rel="noopener noreferrer" class="text-caption">
                    {{ t('campConfig.checklist.source') }}: {{ s.title }}<template v-if="s.page">, {{ s.page }}</template>
                  </a>
                  <span v-else class="text-caption text-medium-emphasis">
                    {{ t('campConfig.checklist.source') }}: {{ s.title }}<template v-if="s.page">, {{ s.page }}</template>
                  </span>
                </template>
                <v-btn
                  v-if="!noteOpen(item.id)"
                  size="x-small"
                  variant="text"
                  prepend-icon="mdi-note-plus-outline"
                  :text="t('campConfig.checklist.noteAdd')"
                  @click="openNotes = { ...openNotes, [item.id]: true }"
                />
              </div>
              <v-text-field
                v-if="noteOpen(item.id)"
                :model-value="noteOf(item.id)"
                :label="t('campConfig.checklist.note')"
                density="compact"
                variant="outlined"
                hide-details
                class="mt-1"
                @blur="(e: FocusEvent) => patch(item.id, { note: (e.target as HTMLInputElement).value })"
              />
            </div>
          </div>
        </div>
      </section>

      <v-alert v-if="saveError" type="error" variant="tonal" density="compact">
        {{ t('campConfig.checklist.saveFailed') }}: {{ saveError }}
      </v-alert>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.cl-item + .cl-item {
  border-top: 1px solid rgba(var(--v-border-color), 0.08);
}
</style>
