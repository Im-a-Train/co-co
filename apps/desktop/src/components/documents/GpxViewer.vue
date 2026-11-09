<script setup lang="ts">
/**
 * GPX viewer: interactive swisstopo map (SwisstopoMap.vue, Leaflet) plus elevation profile as inline SVG.
 * Tiles come from Rust via the map_tile command (ADR 0015); the webview never loads them from the network.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { decodeUtf8, parseGpx } from '@/domain/documents/extract'
import type { GpxPoint } from '@/domain/documents'
import {
  cumulativeKm,
  elevationProfile,
  nearestIndexByKm,
  scaleProfile,
} from '@/domain/documents/gpxView'
import SwisstopoMap from './SwisstopoMap.vue'
import type { DocumentAnchor } from '@/domain/types'

const PROF_W = 600
const PROF_H = 150

const props = defineProps<{ bytes: Uint8Array; target?: DocumentAnchor | null }>()
const emit = defineEmits<{ anchor: [anchor: DocumentAnchor | undefined] }>()
const { t } = useI18n()

const points = ref<GpxPoint[]>([])
const error = ref<string | null>(null)
const selectedIdx = ref<number | null>(null)
const hoverIdx = ref<number | null>(null)

const cum = computed(() => cumulativeKm(points.value))
const profile = computed(() => elevationProfile(points.value))
const scaled = computed(() => scaleProfile(profile.value, PROF_W, PROF_H))
const profilePath = computed(() => scaled.value.xy.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
const areaPath = computed(() => {
  const xy = scaled.value.xy
  if (xy.length < 2) return ''
  const base = PROF_H - 16
  return `${profilePath.value} L${xy[xy.length - 1]!.x.toFixed(1)},${base} L${xy[0]!.x.toFixed(1)},${base} Z`
})
const totalKm = computed(() => (cum.value.length ? cum.value[cum.value.length - 1]! : 0))

const activeIdx = computed(() => hoverIdx.value ?? selectedIdx.value)
const activePoint = computed(() => (activeIdx.value !== null ? points.value[activeIdx.value] ?? null : null))
/** Profile x of the active point (nearest profile entry by km). */
const activeProfileX = computed(() => {
  if (activeIdx.value === null || !profile.value.length) return null
  const km = cum.value[activeIdx.value]!
  const i = nearestIndexByKm(
    profile.value.map((p) => p.km),
    km,
  )
  return scaled.value.xy[i]?.x ?? null
})

function anchorFor(i: number): DocumentAnchor {
  const p = points.value[i]!
  return { km: Math.round(cum.value[i]! * 100) / 100, lat: Math.round(p.lat * 1e5) / 1e5, lon: Math.round(p.lon * 1e5) / 1e5 }
}
function select(i: number) {
  if (i < 0 || i >= points.value.length) return
  selectedIdx.value = i
  emit('anchor', anchorFor(i))
}

function svgPos(ev: MouseEvent, w: number, h: number) {
  const r = (ev.currentTarget as SVGElement).getBoundingClientRect()
  return { x: ((ev.clientX - r.left) / r.width) * w, y: ((ev.clientY - r.top) / r.height) * h }
}
function profileIndexAt(ev: MouseEvent): number {
  const { x } = svgPos(ev, PROF_W, PROF_H)
  const xy = scaled.value.xy
  if (!xy.length) return -1
  let best = 0
  let bd = Infinity
  xy.forEach((p, i) => {
    const d = Math.abs(p.x - x)
    if (d < bd) {
      bd = d
      best = i
    }
  })
  return profile.value[best]!.index
}
function onProfileMove(ev: MouseEvent) {
  const i = profileIndexAt(ev)
  hoverIdx.value = i >= 0 ? i : null
}
/** Keyboard: arrows move the selected point along the track (about 1 % per step, Shift for 10 %). */
function onProfileKey(ev: KeyboardEvent) {
  const n = points.value.length
  if (!n) return
  const step = Math.max(1, Math.round(n / (ev.shiftKey ? 10 : 100)))
  const cur = selectedIdx.value ?? 0
  let next: number | null = null
  if (ev.key === 'ArrowRight') next = Math.min(n - 1, cur + step)
  else if (ev.key === 'ArrowLeft') next = Math.max(0, cur - step)
  else if (ev.key === 'Home') next = 0
  else if (ev.key === 'End') next = n - 1
  if (next === null) return
  ev.preventDefault()
  select(next)
}
function onProfileClick(ev: MouseEvent) {
  const i = profileIndexAt(ev)
  if (i >= 0) select(i)
}

watch(
  () => props.target,
  (a) => {
    if (a?.km === undefined || !points.value.length) return
    select(nearestIndexByKm(cum.value, a.km))
  },
)

onMounted(() => {
  try {
    points.value = parseGpx(decodeUtf8(props.bytes)).points
    if (props.target?.km !== undefined && points.value.length) select(nearestIndexByKm(cum.value, props.target.km))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})
</script>

<template>
  <div class="d-flex flex-column ga-3">
    <v-alert v-if="error" type="error" variant="tonal" density="compact" :text="t('documents.viewer.error', { msg: error })" />
    <v-alert v-else-if="!points.length" type="info" variant="tonal" density="compact" :text="t('documents.viewer.gpxEmpty')" />
    <template v-else>
      <SwisstopoMap :points="points" :active-idx="activeIdx" :selected-idx="selectedIdx" @select="select" />
      <div class="text-caption text-medium-emphasis">{{ t('documents.viewer.gpxLegend') }}</div>

      <svg
        v-if="profile.length > 1"
        class="profile"
        :viewBox="`0 0 ${PROF_W} ${PROF_H}`"
        role="img"
        :aria-label="t('documents.viewer.gpxProfile')"
        data-testid="gpx-profile"
        tabindex="0"
        @keydown="onProfileKey"
        @mousemove="onProfileMove"
        @mouseleave="hoverIdx = null"
        @click="onProfileClick"
      >
        <rect :width="PROF_W" :height="PROF_H" class="bg" />
        <path :d="areaPath" class="area" />
        <path :d="profilePath" class="line" />
        <text x="2" y="14" class="axis">{{ Math.round(scaled.maxEle) }} m</text>
        <text x="2" :y="PROF_H - 18" class="axis">{{ Math.round(scaled.minEle) }} m</text>
        <text :x="PROF_W - 8" :y="PROF_H - 3" text-anchor="end" class="axis">{{ totalKm.toFixed(1) }} km</text>
        <line v-if="activeProfileX !== null" :x1="activeProfileX" :x2="activeProfileX" y1="8" :y2="PROF_H - 16" class="cursor" />
      </svg>

      <div class="text-body-2" style="min-height: 1.5em">
        <template v-if="activePoint && activeIdx !== null">
          {{ t('documents.viewer.gpxPoint', { km: cum[activeIdx]!.toFixed(2) }) }}
          <template v-if="activePoint.ele !== null"> · {{ Math.round(activePoint.ele) }} m</template>
          · {{ activePoint.lat.toFixed(5) }}, {{ activePoint.lon.toFixed(5) }}
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
svg {
  width: 100%;
  height: auto;
  display: block;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
}
.profile {
  cursor: col-resize;
}
.bg {
  fill: rgba(var(--v-theme-on-surface), 0.04);
}
.area {
  fill: rgba(var(--v-theme-primary), 0.18);
}
.line {
  fill: none;
  stroke: rgb(var(--v-theme-primary));
  stroke-width: 2;
}
.axis {
  font-size: 11px;
  fill: rgba(var(--v-theme-on-surface), 0.7);
}
.cursor {
  stroke: rgb(var(--v-theme-warning));
  stroke-width: 2;
}
</style>
