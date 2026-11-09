<script setup lang="ts">
/**
 * Card «Coach-Checkliste» (catalog v2 §8) in the camp tab «Checkliste»: rows grouped by module. Done comes
 * from the rows (linked items follow their milestone); toggling is delegated to the parent (sync plan),
 * notes are saved here.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCampRuleConfig } from '@/composables/useCampRuleConfig'
import { safeExternalUrl } from '@/domain/cockpit'
import type { ChecklistItem, ChecklistKind } from '@/domain/rules/lib/checklist'
import type { ChecklistRow } from '@/domain/rules/lib/checklistSync'
import DeadlineStatusChip from '@/components/rules/DeadlineStatusChip.vue'
import { getSourceRegistry } from '@/domain/rules/packs/registry'
import { MODULE_IDS, type Iri } from '@/domain/types'

const props = defineProps<{ campIri: Iri; rows: ChecklistRow[]; saveError?: string | null }>()
const emit = defineEmits<{ toggle: [row: ChecklistRow, done: boolean] }>()
const { t } = useI18n()
const rc = useCampRuleConfig(() => props.campIri)
const noteError = ref<string | null>(null)
const openNotes = ref<Record<string, boolean>>({})

const groups = computed(() =>
  MODULE_IDS.map((module) => ({ module, rows: props.rows.filter((r) => r.item.module === module) })).filter((g) => g.rows.length > 0),
)
const progress = computed(() => ({ done: props.rows.filter((r) => r.done).length, total: props.rows.length }))

const KIND_COLOR: Record<ChecklistKind, string> = { B: 'primary', E: 'info', '2014': 'grey' }

function sourcesOf(item: ChecklistItem) {
  const reg = getSourceRegistry()
  return item.sources.map((s) => {
    const r = reg.resolve(s)
    return { key: s.key, page: s.page, title: r?.title ?? s.key, url: safeExternalUrl(r?.url) }
  })
}

async function saveNote(id: string, note: string): Promise<void> {
  noteError.value = null
  try {
    await rc.setChecklistItem(id, { note })
  } catch (e) {
    noteError.value = e instanceof Error ? e.message : String(e)
  }
}
const fmt = (iso: string): string => iso.split('-').reverse().join('.')
const noteOf = (id: string): string => rc.config.value.checklist[id]?.note ?? ''
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
        <div v-for="row in g.rows" :key="row.item.id" class="cl-item py-1" :data-testid="`checklist-${row.item.id}`">
          <div class="d-flex align-start ga-2">
            <v-checkbox-btn
              class="flex-grow-0"
              :model-value="row.done"
              density="compact"
              :aria-label="t('campConfig.checklist.done')"
              @update:model-value="(v: boolean | null) => emit('toggle', row, v === true)"
            />
            <div class="flex-grow-1">
              <div class="text-body-2" :class="{ 'text-medium-emphasis': row.done }">{{ row.item.text }}</div>
              <div v-if="row.deadline && row.status" class="d-flex flex-wrap align-center ga-2 mt-1" data-testid="checklist-deadline">
                <v-icon size="x-small" icon="mdi-link-variant" />
                <span class="text-caption">{{ t('campConfig.checklist.dueOn', { date: fmt(row.deadline.due) }) }}</span>
                <DeadlineStatusChip :status="row.status" />
              </div>
              <div class="d-flex flex-wrap align-center ga-1 mt-1">
                <code class="text-caption text-medium-emphasis">{{ row.item.id }}</code>
                <v-chip
                  v-for="k in row.item.kinds"
                  :key="k"
                  size="x-small"
                  label
                  variant="tonal"
                  :color="KIND_COLOR[k]"
                  :title="t(`campConfig.checklist.kindHint.${k}`)"
                >
                  {{ t(`campConfig.checklist.kind.${k}`) }}
                </v-chip>
                <template v-for="s in sourcesOf(row.item)" :key="`${s.key}${s.page}`">
                  <a v-if="s.url" :href="s.url" target="_blank" rel="noopener noreferrer" class="text-caption">
                    {{ t('campConfig.checklist.source') }}: {{ s.title }}<template v-if="s.page">, {{ s.page }}</template>
                  </a>
                  <span v-else class="text-caption text-medium-emphasis">
                    {{ t('campConfig.checklist.source') }}: {{ s.title }}<template v-if="s.page">, {{ s.page }}</template>
                  </span>
                </template>
                <v-btn
                  v-if="!noteOpen(row.item.id)"
                  size="x-small"
                  variant="text"
                  prepend-icon="mdi-note-plus-outline"
                  :text="t('campConfig.checklist.noteAdd')"
                  @click="openNotes = { ...openNotes, [row.item.id]: true }"
                />
              </div>
              <v-text-field
                v-if="noteOpen(row.item.id)"
                :model-value="noteOf(row.item.id)"
                :label="t('campConfig.checklist.note')"
                density="compact"
                variant="outlined"
                hide-details
                class="mt-1"
                @blur="(e: FocusEvent) => saveNote(row.item.id, (e.target as HTMLInputElement).value)"
              />
            </div>
          </div>
        </div>
      </section>

      <v-alert v-if="saveError || noteError" type="error" variant="tonal" density="compact" data-testid="checklist-save-error">
        {{ t('campConfig.checklist.saveFailed') }}: {{ saveError || noteError }}
      </v-alert>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.cl-item + .cl-item {
  border-top: 1px solid rgba(var(--v-border-color), 0.08);
}
</style>
