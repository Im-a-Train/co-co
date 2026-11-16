<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  formatClock,
  formatDateShort,
  formatMinutes,
  meterPercent,
  meterThresholdPercent,
  minutesOfDay,
  SEVERITIES,
  severityStateColor,
  type GridBlock,
  type GridModel,
} from '@/domain/cockpit'
import type { JsDayReason } from '@/domain/rules/lib/jsDays'
import type { Severity } from '@/domain/types'

const props = defineProps<{
  grid: GridModel
  selected?: string | null
  /** Day IRIs to outline («Dieser Tag», opened from a day finding). */
  focusDays?: readonly string[]
  /** Extra sticky offset in px (bars above the grid that stick as well). */
  stickyOffset?: number
}>()
const emit = defineEmits<{ select: [activityIri: string]; openFinding: [findingId: string] }>()
const { t } = useI18n()

const HOUR_PX = 40

const highlight = ref(false)
const clock = (iso: string) => formatClock(minutesOfDay(iso))

function reasonText(r: JsDayReason): string {
  switch (r.code) {
    case 'fewUnits':
      return t('cockpit.grid.invalidReasons.fewUnits', { units: r.units, required: r.required })
    case 'tooShort':
      return t('cockpit.grid.invalidReasons.tooShort', { time: formatMinutes(r.minutes), required: formatMinutes(r.required) })
    case 'shortUnit':
      return t('cockpit.grid.invalidReasons.shortUnit', { start: clock(r.start), end: clock(r.end), minutes: r.minutes, required: r.required })
    case 'gap':
      return t('cockpit.grid.invalidReasons.gap', { start: clock(r.start), end: clock(r.end), minutes: r.minutes, required: r.required })
    case 'combinedOnly':
      return t('cockpit.grid.invalidReasons.combinedOnly')
    case 'bwz':
      return r.minutes > 0
        ? t('cockpit.grid.invalidReasons.bwz', { bwz: r.minutes, required: r.required })
        : t('cockpit.grid.invalidReasons.bwzMissing', { required: r.required })
  }
}

/** The first reason in a few words (under the meter); the tooltip lists all of them. */
function reasonShort(r: JsDayReason): string {
  switch (r.code) {
    case 'fewUnits':
      return t('cockpit.grid.reasonShort.fewUnits', { units: r.units, required: r.required })
    case 'tooShort':
      return t('cockpit.grid.reasonShort.tooShort', { time: formatMinutes(r.minutes), required: formatMinutes(r.required) })
    case 'shortUnit':
      return t('cockpit.grid.reasonShort.shortUnit', { minutes: r.minutes })
    case 'gap':
      return t('cockpit.grid.reasonShort.gap', { minutes: r.minutes, required: r.required })
    case 'combinedOnly':
      return t('cockpit.grid.reasonShort.combinedOnly')
    case 'bwz':
      return r.minutes > 0
        ? t('cockpit.grid.reasonShort.bwz', { bwz: r.minutes, required: r.required })
        : t('cockpit.grid.reasonShort.bwzMissing')
  }
}

interface DayNote {
  text: string
  warn: boolean
}
/** Short line under the meter: first failing criterion; an end day that only counts as a pair says so. */
function dayNote(d: GridModel['days'][number]): DayNote | null {
  if (props.grid.preview || d.valid === null || !d.invalidReasons.length) return null
  if (d.valid === false) return { text: reasonShort(d.invalidReasons[0]!), warn: true }
  if (d.invalidReasons.some((r) => r.code === 'combinedOnly')) return { text: t('cockpit.grid.reasonShort.combinedOnly'), warn: false }
  return null
}

/** First and last day count together (both carry `combinedOnly`). */
const endPair = computed(() => {
  const days = props.grid.days
  if (props.grid.preview || days.length < 2) return false
  const has = (i: number) => days[i]!.invalidReasons.some((r) => r.code === 'combinedOnly')
  return has(0) && has(days.length - 1)
})
const isEndDay = (i: number) => endPair.value && (i === 0 || i === props.grid.days.length - 1)
const isFocus = (d: GridModel['days'][number]) => !!d.dayIri && !!props.focusDays?.includes(d.dayIri)

function blockStyle(b: GridBlock, color: string) {
  const w = 100 / b.lanes
  return {
    top: `${b.topPct}%`,
    height: `${b.heightPct}%`,
    left: `calc(${b.lane * w}% + 1px)`,
    width: `calc(${w}% - 2px)`,
    backgroundColor: color,
  }
}

function blockTotal(b: GridBlock): number {
  return SEVERITIES.reduce((n, s) => n + b.findings[s], 0)
}
function blockTop(b: GridBlock) {
  return SEVERITIES.find((s) => b.findings[s] > 0) ?? null
}
function blockFindingsTitle(b: GridBlock): string {
  return SEVERITIES.filter((s) => b.findings[s] > 0)
    .map((s) => `${b.findings[s]} ${t(`severity.${s}`)}`)
    .join(', ')
}
const anyFindings = computed(() => props.grid.days.some((d) => d.blocks.some((b) => blockTotal(b) > 0)))
// Right under the sticky camp tabs (CampLayout, density comfortable = 44px) and any bar above the grid.
const stickyTop = computed(() => `calc(var(--v-layout-top, 0px) + var(--camp-tabs-height, 44px) + ${props.stickyOffset ?? 0}px)`)

/** Same mapping as the DP chips: Muss red, Soll orange, Hinweis neutral (colour = state, informational = none). */
const badgeClass = (s: Severity): string => {
  const c = severityStateColor(s)
  return c ? `bg-${c}` : 'wg-badge-hint'
}
</script>

<template>
  <div class="week-grid" :class="{ 'wg-preview': grid.preview }" data-testid="week-grid">
    <div class="wg-summary d-flex align-center flex-wrap mb-2">
      <span v-if="grid.summary && !grid.preview" class="text-body-1 font-weight-medium" data-testid="grid-summary">
        {{ t('cockpit.grid.summary', grid.summary) }}
      </span>
      <span v-if="endPair" class="text-body-2 text-medium-emphasis d-flex align-center ga-1" data-testid="grid-end-pair">
        <v-icon icon="mdi-link-variant" size="small" />
        {{ t('cockpit.grid.endPair') }}
      </span>
      <span v-if="grid.preview" class="text-body-2 text-medium-emphasis" data-testid="grid-preview-note">
        {{ t('cockpit.grid.previewNote') }}
      </span>
      <v-spacer />
      <v-switch
        v-if="anyFindings"
        v-model="highlight"
        density="compact"
        color="primary"
        hide-details
        inset
        :label="t('cockpit.grid.highlightFindings')"
        data-testid="grid-highlight-findings"
      />
    </div>

    <div class="wg-legend d-flex flex-wrap align-center mb-2 text-caption text-medium-emphasis" data-testid="grid-legend">
      <span>{{ t('cockpit.grid.legendColor') }}</span>
      <span class="d-flex align-center ga-1"><span class="wg-swatch wg-gap" /> {{ t('cockpit.grid.legendGap') }}</span>
      <span class="d-flex align-center ga-1"><span class="wg-swatch wg-swatch-off" /> {{ t('cockpit.grid.legendNotJs') }}</span>
      <span v-if="grid.preview" class="d-flex align-center ga-1"><span class="wg-swatch wg-swatch-preview" /> {{ t('cockpit.grid.legendPreview') }}</span>
      <span class="d-flex align-center ga-1"><v-icon icon="mdi-eye-off" size="x-small" /> {{ t('cockpit.grid.legendExcluded') }}</span>
      <span class="d-flex align-center ga-1"><span class="wg-meter-line-sample" /> {{ t('cockpit.overview.jsTime.threshold') }}</span>
    </div>

    <div class="wg-head" :style="{ top: stickyTop }">
      <div class="wg-time" />
      <div v-for="(d, i) in grid.days" :key="d.date" class="wg-colhead" :class="{ 'wg-focus': isFocus(d) }" :data-testid="isFocus(d) ? 'grid-focus-day' : undefined">
        <div v-if="isFocus(d)" class="wg-thisday text-caption font-weight-bold">{{ t((focusDays?.length ?? 0) > 1 ? 'cockpit.grid.affectedDay' : 'cockpit.grid.thisDay') }}</div>
        <component
          :is="d.findingId ? 'button' : 'div'"
          :type="d.findingId ? 'button' : undefined"
          class="wg-daytitle"
          :class="{ 'wg-daylink': d.findingId }"
          :title="d.findingId ? t('cockpit.grid.openDayFinding') : undefined"
          :aria-label="d.findingId ? `${t('cockpit.grid.day', { n: d.number })}: ${t('cockpit.grid.openDayFinding')}` : undefined"
          data-testid="grid-day-title"
          @click="d.findingId && emit('openFinding', d.findingId)"
        >
          <span class="font-weight-medium">{{ t('cockpit.grid.day', { n: d.number }) }}</span>
          <v-icon v-if="isEndDay(i)" icon="mdi-link-variant" size="x-small" class="ml-1" :title="t('cockpit.grid.endPair')" />
          <span class="text-caption text-medium-emphasis d-block">{{ formatDateShort(d.date) }}</span>
        </component>
        <div class="wg-meter" :title="t('cockpit.grid.jsMeter')">
          <div
            class="wg-meter-fill"
            :class="grid.preview ? 'wg-meter-preview' : d.valid === false ? 'bg-warning' : 'bg-success'"
            :style="{ width: `${meterPercent(d.jsMinutes)}%` }"
          />
          <div class="wg-meter-line" :style="{ left: `${meterThresholdPercent()}%` }" />
        </div>
        <div v-if="grid.preview" class="text-caption text-medium-emphasis" data-testid="grid-preview-minutes">
          {{ t('cockpit.grid.jsMinutesPreview', { time: formatMinutes(d.jsMinutes) }) }}
        </div>
        <template v-else>
          <div class="text-caption d-flex align-center justify-center ga-1">
            <v-icon
              v-if="d.valid !== null"
              :icon="d.valid ? 'mdi-check-circle' : 'mdi-alert-circle'"
              :color="d.valid ? 'success' : 'warning'"
              size="x-small"
              :title="d.valid ? t('cockpit.grid.valid') : t('cockpit.grid.invalid')"
            />
            {{ t('cockpit.grid.jsMinutes', { time: formatMinutes(d.jsMinutes) }) }}
          </div>
          <div v-if="dayNote(d)" class="wg-note text-caption" data-testid="grid-invalid-why">
            <span :class="dayNote(d)!.warn ? 'text-warning' : 'text-medium-emphasis'">
              {{ dayNote(d)!.text }}
              <v-tooltip activator="parent" location="bottom" max-width="320">
                <ul class="wg-why-list">
                  <li v-for="(r, k) in d.invalidReasons" :key="k">{{ reasonText(r) }}</li>
                </ul>
              </v-tooltip>
            </span>
          </div>
        </template>
        <div v-if="d.hiddenEntries" class="text-caption text-medium-emphasis">
          {{ t('cockpit.grid.hidden', d.hiddenEntries) }}
        </div>
      </div>
    </div>

    <div class="wg-body">
      <div class="wg-time wg-hours" :style="{ height: `${(grid.endHour - grid.startHour) * HOUR_PX}px` }">
        <div
          v-for="h in grid.hours"
          :key="h"
          class="wg-hour text-caption text-medium-emphasis"
          :style="{ top: `${((h - grid.startHour) / (grid.endHour - grid.startHour)) * 100}%` }"
        >
          {{ formatClock(h * 60) }}
        </div>
      </div>
      <div
        v-for="d in grid.days"
        :key="d.date"
        class="wg-col"
        :class="{ 'wg-focus-col': isFocus(d) }"
        :style="{ height: `${(grid.endHour - grid.startHour) * HOUR_PX}px`, '--hour-px': `${HOUR_PX}px` }"
      >
        <div
          v-for="(g, i) in d.badGaps"
          :key="`gap${i}`"
          class="wg-gap"
          :style="{ top: `${g.topPct}%`, height: `max(${g.heightPct}%, 4px)` }"
          :title="t('cockpit.grid.gap', { minutes: g.minutes })"
        />
        <button
          v-for="b in d.blocks"
          :key="b.entryIri"
          type="button"
          class="wg-block"
          :class="{
            'wg-block-off': !b.isJs,
            'wg-block-preview': grid.preview && b.isJs,
            'wg-block-sel': selected === b.activityIri,
            'wg-block-dim': highlight && blockTotal(b) === 0,
          }"
          :style="blockStyle(b, b.color)"
          :title="`${formatClock(b.startMin)}–${formatClock(b.endMin)} ${b.title} (${t(`categoryClass.${b.categoryClass}`)})`"
          @click="emit('select', b.activityIri)"
        >
          <span class="wg-block-nr">{{ b.number }}</span>
          <span class="wg-block-title">{{ b.title }}</span>
          <v-icon v-if="b.excluded" icon="mdi-eye-off" size="x-small" class="wg-block-excluded" :title="t('cockpit.grid.legendExcluded')" data-testid="grid-block-excluded" />
          <span
            v-if="blockTop(b)"
            class="wg-badge"
            :class="badgeClass(blockTop(b)!)"
            :title="blockFindingsTitle(b)"
            data-testid="grid-block-badge"
          >
            {{ blockTotal(b) }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * No min-width and no overflow-x container: a scroll container would break the sticky head, and a fixed minimum
 * pushed the last days under the (non-modal) activity drawer. The day columns shrink instead.
 */
.wg-head,
.wg-body {
  display: flex;
}
.wg-head {
  position: sticky;
  z-index: 4;
  background: rgb(var(--v-theme-surface));
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.wg-time {
  flex: 0 0 48px;
  position: relative;
}
.wg-colhead {
  flex: 1 1 0;
  min-width: 0;
  overflow-wrap: break-word;
  text-align: center;
  padding: 4px 4px 8px;
  border-left: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.wg-col {
  flex: 1 1 0;
  min-width: 0;
  position: relative;
  border-left: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background-image: linear-gradient(
    to bottom,
    rgba(var(--v-border-color), 0.12) 1px,
    transparent 1px
  );
  background-size: 100% var(--hour-px);
}
.wg-hour {
  position: absolute;
  right: 6px;
  transform: translateY(-50%);
}
.wg-hour:first-child {
  transform: none;
}
.wg-meter {
  position: relative;
  height: 8px;
  margin: 4px 6px 2px;
  border-radius: 4px;
  background: rgba(var(--v-border-color), 0.2);
  overflow: hidden;
}
.wg-meter-fill {
  height: 100%;
}
.wg-meter-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgb(var(--v-theme-on-surface));
}
.wg-meter-line-sample {
  display: inline-block;
  width: 2px;
  height: 12px;
  background: rgb(var(--v-theme-on-surface));
}
.wg-legend,
.wg-summary {
  gap: 4px 16px;
}
.wg-legend > span {
  white-space: nowrap;
}
.wg-daylink > span:first-child {
  text-decoration: underline dotted;
}
.wg-note {
  cursor: help;
  line-height: 1.25;
  padding: 0 2px;
}
.wg-daytitle {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1.25;
}
.wg-daylink {
  cursor: pointer;
  border-radius: 4px;
}
.wg-daylink:hover,
.wg-daylink:focus-visible {
  background: rgba(var(--v-theme-primary), 0.12);
}
.wg-thisday {
  color: rgb(var(--v-theme-primary));
}
.wg-focus {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
  border-radius: 4px 4px 0 0;
}
.wg-focus-col {
  box-shadow: inset 2px 0 0 rgb(var(--v-theme-primary)), inset -2px 0 0 rgb(var(--v-theme-primary));
}
.wg-meter-preview {
  background: rgba(var(--v-theme-on-surface), 0.35);
}
.wg-swatch-preview {
  border: 1px dotted currentColor;
}
.wg-why-list {
  margin: 0;
  padding-left: 16px;
  text-align: left;
}
.wg-gap {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 2;
  pointer-events: auto;
  background: repeating-linear-gradient(
    45deg,
    rgba(var(--v-theme-error), 0.65) 0 4px,
    rgba(var(--v-theme-error), 0.1) 4px 8px
  );
}
.wg-swatch {
  position: static;
  display: inline-block;
  width: 16px;
  height: 12px;
}
.wg-swatch-off {
  border: 1px dashed currentColor;
}
.wg-block {
  position: absolute;
  z-index: 1;
  overflow: hidden;
  border: 0;
  border-radius: 4px;
  padding: 2px 4px;
  text-align: left;
  font-size: 11px;
  line-height: 1.2;
  color: #fff;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
  cursor: pointer;
}
.wg-block-off {
  opacity: 0.55;
  border: 1px dashed rgba(0, 0, 0, 0.5);
}
.wg-block-preview {
  border: 2px dotted rgba(0, 0, 0, 0.55);
}
.wg-block-dim {
  opacity: 0.3;
}
.wg-block-excluded {
  position: absolute;
  bottom: 2px;
  right: 2px;
  color: #fff;
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.7));
}
.wg-badge-hint {
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface-variant));
}
.wg-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  text-shadow: none;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.8);
}
.wg-block-sel {
  outline: 2px solid rgb(var(--v-theme-primary));
  z-index: 3;
}
.wg-block-nr {
  font-weight: 700;
  margin-right: 4px;
}
</style>
