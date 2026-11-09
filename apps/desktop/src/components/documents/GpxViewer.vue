<script setup lang="ts">
/**
 * GPX viewer: track polyline and elevation profile as inline SVG. The track sits on swisstopo Web-Mercator
 * tiles (base map plus optional hiking-trail and slope overlays) that Rust fetches via the map_tile command
 * (ADR 0015); the webview itself never loads tiles from the network. Tiles that fail stay empty.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { decodeUtf8, parseGpx } from '@/domain/documents/extract'
import type { GpxPoint } from '@/domain/documents'
import {
  cumulativeKm,
  elevationProfile,
  nearestIndexByKm,
  nearestIndexByXY,
  scaleProfile,
  segmentPaths,
} from '@/domain/documents/gpxView'
import { fitView, projectToView, tilesForView, TILE_SIZE } from '@/domain/documents/mapTiles'
import type { DocumentAnchor } from '@/domain/types'
import { base64ToBytes, commands, type MapLayer } from '@/lib/tauri'

const MAP_W = 600
const MAP_H = 340
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
const view = computed(() => fitView(points.value, MAP_W, MAP_H))
const projected = computed(() => ({ points: projectToView(points.value, view.value) }))
const paths = computed(() => segmentPaths(projected.value.points, points.value))
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
const activeMap = computed(() => (activeIdx.value !== null ? projected.value.points[activeIdx.value] ?? null : null))
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
function onMapClick(ev: MouseEvent) {
  const { x, y } = svgPos(ev, MAP_W, MAP_H)
  select(nearestIndexByXY(projected.value.points, x, y))
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

// --- map tiles ---------------------------------------------------------------------------------------
const PREF_KEY = 'co-co.gpxMap.v2'
const MAX_PARALLEL = 6
const LAYER_ORDER: MapLayer[] = ['base', 'slope', 'hiking']
type Toggles = Record<MapLayer, boolean>
const DEFAULT_TOGGLES: Toggles = { base: true, hiking: false, slope: false }

/** Layer toggles are a device preference (no user ids in localStorage). */
const toggles = reactive<Toggles>({ ...DEFAULT_TOGGLES })

function loadToggles() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<Toggles>
    for (const l of LAYER_ORDER) toggles[l] = typeof saved[l] === 'boolean' ? (saved[l] as boolean) : DEFAULT_TOGGLES[l]
  } catch {
    /* storage unavailable: keep defaults */
  }
}
function saveToggles() {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ base: toggles.base, hiking: toggles.hiking, slope: toggles.slope }))
  } catch {
    /* storage unavailable: toggles just are not remembered */
  }
}

/** Object URL per tile key, null = failed, absent = unknown. Per-component cache, revoked on unmount. */
const tileUrls = reactive(new Map<string, string | null>())
const tileRefs = computed(() => tilesForView(view.value))
const loading = ref(false)
let generation = 0
const tileKey = (l: MapLayer, t: { z: number; x: number; y: number }) => `${l}/${t.z}/${t.x}/${t.y}`

async function fetchTile(l: MapLayer, t: { z: number; x: number; y: number }) {
  const key = tileKey(l, t)
  try {
    const r = await commands.mapTile(l, t.z, t.x, t.y)
    const bytes = base64ToBytes(r.bytesBase64)
    tileUrls.set(key, URL.createObjectURL(new Blob([bytes as BlobPart], { type: r.contentType })))
  } catch {
    tileUrls.set(key, null)
  }
}

async function loadTiles() {
  const gen = ++generation
  const queue: Array<[MapLayer, { z: number; x: number; y: number }]> = []
  for (const l of LAYER_ORDER) {
    if (!toggles[l]) continue
    for (const t of tileRefs.value) if (!tileUrls.has(tileKey(l, t))) queue.push([l, t])
  }
  if (!queue.length) {
    loading.value = false
    return
  }
  loading.value = true
  const worker = async () => {
    for (;;) {
      if (gen !== generation) return // stale view or toggles: stop pulling work
      const next = queue.shift()
      if (!next) return
      await fetchTile(next[0], next[1])
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, queue.length) }, worker))
  if (gen === generation) loading.value = false
}

const tileImages = computed(() =>
  LAYER_ORDER.filter((l) => toggles[l]).flatMap((l) =>
    tileRefs.value.flatMap((t) => {
      const href = tileUrls.get(tileKey(l, t))
      return href ? [{ key: `${tileKey(l, t)}@${t.px},${t.py}`, href, x: t.px, y: t.py }] : []
    }),
  ),
)
const baseUnavailable = computed(
  () => toggles.base && !loading.value && tileRefs.value.length > 0 && tileRefs.value.every((t) => tileUrls.get(tileKey('base', t)) === null),
)

watch([tileRefs, () => toggles.base, () => toggles.hiking, () => toggles.slope], () => {
  if (points.value.length) void loadTiles()
})
function onToggle() {
  saveToggles()
}
onBeforeUnmount(() => {
  generation++
  for (const u of tileUrls.values()) if (u) URL.revokeObjectURL(u)
  tileUrls.clear()
})

onMounted(() => {
  loadToggles()
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
      <svg
        class="map"
        :viewBox="`0 0 ${MAP_W} ${MAP_H}`"
        role="img"
        :aria-label="t('documents.viewer.gpxTrack')"
        data-testid="gpx-track"
        @click="onMapClick"
      >
        <rect :width="MAP_W" :height="MAP_H" class="bg" />
        <image
          v-for="img in tileImages"
          :key="img.key"
          :href="img.href"
          :x="img.x"
          :y="img.y"
          :width="TILE_SIZE"
          :height="TILE_SIZE"
          class="tile"
        />
        <path v-for="(d, i) in paths" :key="'h' + i" :d="d" class="track-halo" />
        <path v-for="(d, i) in paths" :key="i" :d="d" class="track" />
        <circle :cx="projected.points[0]!.x" :cy="projected.points[0]!.y" r="6" class="start" />
        <circle :cx="projected.points[projected.points.length - 1]!.x" :cy="projected.points[projected.points.length - 1]!.y" r="6" class="end" />
        <circle v-if="activeMap" :cx="activeMap.x" :cy="activeMap.y" r="7" class="sel" />
        <text v-if="toggles.base && !baseUnavailable" :x="MAP_W - 4" :y="MAP_H - 4" text-anchor="end" class="attribution">{{ t('documents.viewer.gpxAttribution') }}</text>
        <text v-if="baseUnavailable" :x="MAP_W / 2" :y="MAP_H - 8" text-anchor="middle" class="attribution" data-testid="gpx-map-unavailable">{{ t('documents.viewer.gpxMapUnavailable') }}</text>
      </svg>
      <div class="d-flex flex-wrap align-center ga-4" role="group" :aria-label="t('documents.viewer.gpxMapLayers')" data-testid="gpx-layers">
        <v-switch v-model="toggles.base" :label="t('documents.viewer.gpxLayerBase')" density="compact" hide-details color="primary" @update:model-value="onToggle" />
        <v-checkbox v-model="toggles.hiking" :label="t('documents.viewer.gpxLayerHiking')" density="compact" hide-details @update:model-value="onToggle" />
        <v-checkbox v-model="toggles.slope" :label="t('documents.viewer.gpxLayerSlope')" density="compact" hide-details @update:model-value="onToggle" />
      </div>
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
.map {
  cursor: crosshair;
}
.profile {
  cursor: col-resize;
}
.bg {
  fill: rgba(var(--v-theme-on-surface), 0.04);
}
.tile {
  pointer-events: none;
}
.attribution {
  font-size: 10px;
  fill: #333;
  paint-order: stroke;
  stroke: rgba(255, 255, 255, 0.8);
  stroke-width: 3px;
  pointer-events: none;
}
.track-halo {
  fill: none;
  stroke: #fff;
  stroke-opacity: 0.9;
  stroke-width: 6;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.track {
  fill: none;
  stroke: rgb(var(--v-theme-primary));
  stroke-width: 3;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.start {
  fill: rgb(var(--v-theme-success));
  stroke: #fff;
  stroke-width: 2;
}
.end {
  fill: rgb(var(--v-theme-error));
  stroke: #fff;
  stroke-width: 2;
}
.sel {
  fill: rgb(var(--v-theme-warning));
  stroke: #fff;
  stroke-width: 2;
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
