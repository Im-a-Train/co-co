<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  formatClock,
  formatDateShort,
  formatMinutes,
  meterPercent,
  meterThresholdPercent,
  minutesOfDay,
  type GridBlock,
  type GridModel,
} from '@/domain/cockpit'
import type { JsDayReason } from '@/domain/rules/lib/jsDays'

defineProps<{ grid: GridModel; selected?: string | null }>()
const emit = defineEmits<{ select: [activityIri: string] }>()
const { t, tm } = useI18n()
void tm

const HOUR_PX = 40

const clock = (iso: string) => formatClock(minutesOfDay(iso))

function reasonText(r: JsDayReason): string {
  const p = t
  switch (r.code) {
    case 'fewUnits':
      return p('cockpit.grid.invalidReasons.fewUnits', { units: r.units, required: r.required })
    case 'tooShort':
      return p('cockpit.grid.invalidReasons.tooShort', { time: formatMinutes(r.minutes), required: formatMinutes(r.required) })
    case 'shortUnit':
      return p('cockpit.grid.invalidReasons.shortUnit', { start: clock(r.start), end: clock(r.end), minutes: r.minutes, required: r.required })
    case 'gap':
      return p('cockpit.grid.invalidReasons.gap', { start: clock(r.start), end: clock(r.end), minutes: r.minutes, required: r.required })
    case 'combinedOnly':
      return p('cockpit.grid.invalidReasons.combinedOnly')
  }
}

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
</script>

<template>
  <div class="week-grid">
    <div class="wg-head">
      <div class="wg-time" />
      <div v-for="d in grid.days" :key="d.date" class="wg-colhead">
        <div class="font-weight-medium">{{ t('cockpit.grid.day', { n: d.number }) }}</div>
        <div class="text-caption text-medium-emphasis">{{ formatDateShort(d.date) }}</div>
        <div class="wg-meter" :title="t('cockpit.grid.jsMeter')">
          <div
            class="wg-meter-fill"
            :class="d.valid === false ? 'bg-warning' : 'bg-success'"
            :style="{ width: `${meterPercent(d.jsMinutes)}%` }"
          />
          <div class="wg-meter-line" :style="{ left: `${meterThresholdPercent()}%` }" />
        </div>
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
        <div v-if="d.valid === false && d.invalidReasons.length" class="text-caption" data-testid="grid-invalid-why">
          <span class="wg-why text-warning">
            {{ t('cockpit.grid.whyInvalid') }}
            <v-tooltip activator="parent" location="bottom" max-width="320">
              <ul class="wg-why-list">
                <li v-for="(r, i) in d.invalidReasons" :key="i">{{ reasonText(r) }}</li>
              </ul>
            </v-tooltip>
          </span>
        </div>
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
          :class="{ 'wg-block-off': !b.isJs, 'wg-block-sel': selected === b.activityIri }"
          :style="blockStyle(b, b.color)"
          :title="`${formatClock(b.startMin)}–${formatClock(b.endMin)} ${b.title} (${t(`categoryClass.${b.categoryClass}`)})`"
          @click="emit('select', b.activityIri)"
        >
          <span class="wg-block-nr">{{ b.number }}</span>
          <span class="wg-block-title">{{ b.title }}</span>
        </button>
      </div>
    </div>

    <div class="d-flex flex-wrap align-center ga-4 mt-3 text-caption">
      <span class="d-flex align-center ga-1"><span class="wg-swatch wg-gap" /> {{ t('cockpit.grid.legendGap') }}</span>
      <span class="d-flex align-center ga-1"><span class="wg-swatch wg-swatch-off" /> {{ t('cockpit.grid.legendNotJs') }}</span>
      <span class="d-flex align-center ga-1"><span class="wg-meter-line-sample" /> {{ t('cockpit.overview.jsTime.threshold') }}</span>
    </div>
  </div>
</template>

<style scoped>
.week-grid {
  overflow-x: auto;
}
.wg-head,
.wg-body {
  display: flex;
  min-width: 720px;
}
.wg-time {
  flex: 0 0 48px;
  position: relative;
}
.wg-colhead {
  flex: 1 1 0;
  min-width: 0;
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
.wg-why {
  cursor: help;
  text-decoration: underline dotted;
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
.wg-block-sel {
  outline: 2px solid rgb(var(--v-theme-primary));
  z-index: 3;
}
.wg-block-nr {
  font-weight: 700;
  margin-right: 4px;
}
</style>
