<script setup lang="ts">
/**
 * One deadline row of /fristen: checkbox (not for NDS-Pendenzen), title (rule-backed ones link to the
 * rule), camp link, date with relative, colour-coded text. Unconfirmed milestones carry an asterisk after
 * the date; the real source sits in its title attribute.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import type { Deadline } from '@/domain/types'
import type { DeadlineStatus } from '@/domain/rules/lib/deadlines'

type Row = Deadline & {
  key: string
  campId: string
  status: DeadlineStatus
  left: number
  /** Short title (kind title or milestone title). */
  title: string
  /** Long wording of a built-in kind (the rule in brackets), shown as title attribute. */
  titleHint?: string
}

const props = defineProps<{ row: Row }>()
const emit = defineEmits<{ toggle: [row: Row, done: boolean] }>()
const { t } = useI18n()

const isLeader = computed(() => props.row.audience === 'leaders')
const hasCheckbox = computed(() => props.row.kind !== 'nds-task')
const unconfirmed = computed(() => props.row.kind === 'pbs-milestone' && props.row.confidence === 'unverified')

function fmt(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

const relative = computed(() => {
  const left = props.row.left
  if (left === 0) return t('rules.deadlines.relative.today')
  if (left === 1) return t('rules.deadlines.relative.inOne')
  if (left === -1) return t('rules.deadlines.relative.agoOne')
  return left > 0 ? t('rules.deadlines.relative.in', { n: left }) : t('rules.deadlines.relative.ago', { n: -left })
})

/** Colour = state: overdue or due within a week = warning (deadlines never block approval, so never red), everything else neutral. */
const relativeClass = computed(() => {
  if (props.row.done) return 'text-medium-emphasis'
  if (props.row.left <= 7) return 'text-warning'
  return 'text-medium-emphasis'
})

const dateTitle = computed(() => {
  const parts: string[] = []
  if (unconfirmed.value) parts.push(t('rules.deadlines.unconfirmedHint', { source: props.row.source?.title ?? '' }))
  for (const a of props.row.alsoNamed ?? []) parts.push(t('rules.deadlines.alsoNamed', { source: a.source, date: fmt(a.due) }))
  return parts.join(' · ') || undefined
})

/** Names the row, so a screen reader can tell the checkboxes apart. */
const checkboxLabel = computed(() =>
  t(isLeader.value ? 'rules.deadlines.leaderDoneAria' : 'rules.deadlines.doneAria', { title: props.row.title, camp: props.row.campTitle }),
)
const ruleLinkTitle = computed(() => {
  const hint = t('rules.deadlines.ruleLinkHint', { id: props.row.ruleId ?? '' })
  return props.row.titleHint ? `${props.row.titleHint} · ${hint}` : hint
})
</script>

<template>
  <div
    :id="`deadline-${row.key}`"
    class="deadline-row d-flex align-start ga-2 py-2 px-3"
    :class="{ 'deadline-archived': row.archived }"
    :data-testid="row.kind === 'pbs-milestone' ? 'milestone-row' : 'deadline-row'"
  >
    <v-checkbox-btn
      v-if="hasCheckbox"
      class="flex-grow-0"
      :model-value="row.done"
      density="compact"
      :disabled="row.archived"
      :aria-label="checkboxLabel"
      :title="isLeader ? t('rules.deadlines.leaderDoneHint') : undefined"
      data-testid="deadline-done"
      @update:model-value="(v: boolean | null) => emit('toggle', row, v === true)"
    />
    <v-icon
      v-else
      icon="mdi-shield-lock-outline"
      size="small"
      class="mt-2 mx-1 text-medium-emphasis"
      :title="t('rules.deadlines.ndsTasks.readOnly')"
      :aria-label="t('rules.deadlines.ndsTasks.readOnly')"
      data-testid="nds-task-lock"
    />

    <div class="flex-grow-1 min-w-0">
      <div class="text-body-2 d-flex align-center flex-wrap ga-1" :class="{ 'text-medium-emphasis': row.done }">
        <v-chip v-if="isLeader" size="x-small" label variant="tonal" data-testid="leader-chip">{{ t('rules.deadlines.leaderChip') }}</v-chip>
        <RouterLink
          v-if="row.ruleId"
          :to="{ path: '/regeln', query: { rule: row.ruleId } }"
          :title="ruleLinkTitle"
          data-testid="deadline-rule-link"
        >
          {{ row.title }}
        </RouterLink>
        <span v-else :title="row.titleHint">{{ row.title }}</span>
        <v-chip v-if="row.archived" size="x-small" label variant="tonal" data-testid="archived-badge">{{ t('rules.deadlines.archivedBadge') }}</v-chip>
      </div>
      <div class="text-caption text-truncate">
        <span v-if="row.kind === 'nds-task'" class="text-medium-emphasis">{{ row.campTitle }}</span>
        <RouterLink v-else :to="`/lager/${row.campId}/checkliste`" :title="t('rules.deadlines.openChecklist')" data-testid="deadline-camp-link">{{ row.campTitle }}</RouterLink>
      </div>
    </div>

    <div class="text-right text-no-wrap">
      <div class="text-body-2" :title="dateTitle" :class="{ 'text-medium-emphasis': row.done }">
        {{ fmt(row.due) }}<span v-if="unconfirmed" data-testid="unconfirmed-mark" aria-hidden="true">*</span>
      </div>
      <div class="text-caption" :class="relativeClass">{{ relative }}</div>
    </div>
  </div>
</template>

<style scoped>
.deadline-row + .deadline-row {
  border-top: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.deadline-archived {
  opacity: 0.55;
}
.min-w-0 {
  min-width: 0;
}
</style>
