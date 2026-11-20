<script setup lang="ts">
/**
 * Interactive swisstopo map (Leaflet, EPSG:3857). All tiles come from Rust via commands.mapTile (ADR 0015);
 * the webview never loads tiles from the network (CSP). A custom GridLayer turns each tile into a blob URL.
 */
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from 'vuetify'
import type { GpxPoint } from '@/domain/documents'
import { nearestIndexByXY } from '@/domain/documents/gpxView'
import { base64ToBytes, commands, type MapLayer } from '@/lib/tauri'

type BaseId = Extract<MapLayer, 'base' | 'grey' | 'winter' | 'aerial'>
type OverlayId = Exclude<MapLayer, BaseId>

const props = defineProps<{
  points: GpxPoint[]
  /** Point shown by the orange marker (hover or selection); null = none. */
  activeIdx: number | null
  /** Selected point: the map pans to it only when it is out of view. */
  selectedIdx: number | null
}>()
const emit = defineEmits<{ select: [index: number] }>()
const { t } = useI18n()
const theme = useTheme()

const BASES: BaseId[] = ['base', 'grey', 'winter', 'aerial']
const OVERLAY_GROUPS: Array<{ key: string; items: OverlayId[] }> = [
  { key: 'gpxGroupSport', items: ['hiking', 'mtb', 'bike', 'skitour', 'snowshoe'] },
  { key: 'gpxGroupSafety', items: ['slope', 'wildlife', 'gamereserve'] },
  { key: 'gpxGroupTravel', items: ['transit'] },
]
const ALL_OVERLAYS = OVERLAY_GROUPS.flatMap((g) => g.items)
const OVERLAY_SOURCE: Partial<Record<OverlayId, string>> = {
  mtb: 'ASTRA',
  bike: 'ASTRA',
  transit: 'BAV',
  wildlife: 'BAFU',
  gamereserve: 'BAFU',
}
const OVERLAY_OPACITY: Partial<Record<OverlayId, number>> = { slope: 0.7 }
const Z_INDEX: Record<MapLayer, number> = {
  base: 1, grey: 1, winter: 1, aerial: 1,
  slope: 2, wildlife: 3, gamereserve: 3, hiking: 4, snowshoe: 4, skitour: 4, mtb: 5, bike: 5, transit: 6,
}

const PREF_KEY = 'co-co.gpxMap.v3'
const base = ref<BaseId | 'none'>('base')
const overlays = ref<OverlayId[]>(['hiking'])

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as { base?: unknown; overlays?: unknown }
    if (saved.base === 'none' || BASES.includes(saved.base as BaseId)) base.value = saved.base as BaseId | 'none'
    if (Array.isArray(saved.overlays)) overlays.value = ALL_OVERLAYS.filter((o) => (saved.overlays as unknown[]).includes(o))
  } catch {
    /* storage unavailable: keep defaults */
  }
}
function savePrefs() {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ base: base.value, overlays: overlays.value }))
  } catch {
    /* storage unavailable: just not remembered */
  }
}

const el = ref<HTMLDivElement | null>(null)
const tall = ref(false)
const zoom = ref(0)
const layersOpen = ref(false)
const baseUnavailable = ref(false)
let map: L.Map | null = null
let attribution: L.Control.Attribution | null = null
let attributionText = ''
const layerObjs = new Map<MapLayer, L.GridLayer>()
const liveUrls = new Set<string>()
const stats = { ok: 0, err: 0 }
let marker: L.CircleMarker | null = null
let trackLatLngs: L.LatLng[] = []

type CocoGrid = L.GridLayer & { _cocoLayer: MapLayer }
const TileLayer = L.GridLayer.extend({
  initialize(this: CocoGrid, layer: MapLayer, options: L.GridLayerOptions) {
    this._cocoLayer = layer
    L.Util.setOptions(this, options)
  },
  createTile(this: CocoGrid, coords: L.Coords, done: L.DoneCallback) {
    const img = document.createElement('img')
    img.alt = ''
    img.draggable = false
    commands
      .mapTile(this._cocoLayer, coords.z, coords.x, coords.y)
      .then((r) => {
        const url = URL.createObjectURL(new Blob([base64ToBytes(r.bytesBase64) as BlobPart], { type: r.contentType }))
        liveUrls.add(url)
        img.onload = () => done(undefined, img)
        img.onerror = () => done(new Error('tile decode'), img)
        img.src = url
      })
      .catch((e) => done(e instanceof Error ? e : new Error(String(e)), img))
    return img
  },
}) as unknown as new (layer: MapLayer, options: L.GridLayerOptions) => L.GridLayer

function revokeTile(ev: L.TileEvent) {
  const src = (ev.tile as HTMLImageElement).src
  if (src && liveUrls.delete(src)) URL.revokeObjectURL(src)
}

function makeLayer(id: MapLayer): L.GridLayer {
  const isBase = (BASES as string[]).includes(id)
  const lyr = new TileLayer(id, {
    tileSize: 256,
    minZoom: 7,
    maxZoom: 19,
    maxNativeZoom: 18,
    zIndex: Z_INDEX[id],
    opacity: OVERLAY_OPACITY[id as OverlayId] ?? 1,
    updateWhenIdle: false,
    keepBuffer: 2,
  })
  lyr.on('tileunload', revokeTile as L.LeafletEventHandlerFn)
  if (isBase) {
    lyr.on('loading', () => {
      stats.ok = 0
      stats.err = 0
    })
    lyr.on('tileload', () => stats.ok++)
    lyr.on('tileerror', () => stats.err++)
    lyr.on('load', () => {
      baseUnavailable.value = stats.err > 0 && stats.ok === 0
    })
  }
  return lyr
}

function syncLayers() {
  if (!map) return
  const want = new Set<MapLayer>([...(base.value === 'none' ? [] : [base.value]), ...overlays.value])
  for (const [id, lyr] of layerObjs) {
    if (!want.has(id)) {
      lyr.remove()
      layerObjs.delete(id)
    }
  }
  for (const id of want) {
    if (layerObjs.has(id)) continue
    const lyr = makeLayer(id)
    layerObjs.set(id, lyr)
    lyr.addTo(map)
  }
  if (base.value === 'none') baseUnavailable.value = false
  syncAttribution()
}

function syncAttribution() {
  if (!attribution) return
  if (attributionText) attribution.removeAttribution(attributionText)
  const parts: string[] = []
  if (base.value !== 'none' || overlays.value.length) parts.push(t('documents.viewer.gpxAttribution'))
  for (const s of new Set(overlays.value.map((o) => OVERLAY_SOURCE[o]).filter(Boolean))) parts.push(`© ${s}`)
  attributionText = parts.join(' | ')
  if (attributionText) attribution.addAttribution(attributionText)
}

function fitTrack() {
  if (!map || !trackLatLngs.length) return
  map.fitBounds(L.latLngBounds(trackLatLngs), { padding: [24, 24], maxZoom: 17, animate: false })
}

function drawTrack() {
  if (!map) return
  const c = theme.current.value.colors
  trackLatLngs = props.points.map((p) => L.latLng(p.lat, p.lon))
  const first = trackLatLngs[0]!
  const last = trackLatLngs[trackLatLngs.length - 1]!
  const dot = (ll: L.LatLng, fill: string, r: number) =>
    L.circleMarker(ll, { radius: r, color: '#fff', weight: 2, fillColor: fill, fillOpacity: 1, interactive: false })
  L.featureGroup([
    L.polyline(trackLatLngs, { color: '#fff', weight: 7, opacity: 0.9, interactive: false }),
    L.polyline(trackLatLngs, { color: c.primary ?? '#1565c0', weight: 3.5, opacity: 1, interactive: false }),
    dot(first, c.success ?? '#2e7d32', 6),
    dot(last, c.error ?? '#c62828', 6),
  ]).addTo(map)
  marker = dot(first, c.warning ?? '#ef6c00', 8)
  updateMarker()
}

function updateMarker() {
  if (!map || !marker) return
  const i = props.activeIdx
  const p = i !== null ? trackLatLngs[i] : undefined
  if (!p) {
    marker.remove()
    return
  }
  marker.setLatLng(p)
  if (!map.hasLayer(marker)) marker.addTo(map)
  marker.bringToFront()
}

const MAX_CLICK_PX = 30
function onMapClick(ev: L.LeafletMouseEvent) {
  if (!map) return
  const pts = trackLatLngs.map((ll) => map!.latLngToContainerPoint(ll))
  const i = nearestIndexByXY(pts, ev.containerPoint.x, ev.containerPoint.y)
  if (i < 0) return
  if (Math.hypot(pts[i]!.x - ev.containerPoint.x, pts[i]!.y - ev.containerPoint.y) > MAX_CLICK_PX) return
  emit('select', i)
}

watch(tall, () => void nextTick(() => map?.invalidateSize()))
watch(
  () => props.activeIdx,
  () => updateMarker(),
)
watch(
  () => props.selectedIdx,
  (i) => {
    const p = i !== null ? trackLatLngs[i] : undefined
    if (map && p && !map.getBounds().contains(p)) map.panTo(p)
  },
)
watch([base, overlays], () => {
  savePrefs()
  syncLayers()
})

const layersButton = computed(() => t('documents.viewer.gpxLayersButton', { n: overlays.value.length }))
const baseItems = computed(() => [
  ...BASES.map((b) => ({ value: b as BaseId | 'none', title: t(`documents.viewer.gpxBase.${b}`) })),
  { value: 'none' as BaseId | 'none', title: t('documents.viewer.gpxBase.none') },
])

onMounted(() => {
  loadPrefs()
  if (!el.value) return
  map = L.map(el.value, { attributionControl: false, minZoom: 7, maxZoom: 19, scrollWheelZoom: true, zoomSnap: 1 })
  attribution = L.control.attribution({ prefix: false }).addTo(map)
  map.on('zoomend', () => (zoom.value = map!.getZoom()))
  map.on('click', onMapClick)
  drawTrack()
  fitTrack()
  zoom.value = map.getZoom()
  syncLayers()
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
  layerObjs.clear()
  for (const u of liveUrls) URL.revokeObjectURL(u)
  liveUrls.clear()
})
</script>

<template>
  <div class="d-flex flex-column ga-2">
    <div class="map-wrap">
      <div
        ref="el"
        class="gpx-map"
        :style="{ height: tall ? '640px' : '380px' }"
        :data-zoom="zoom"
        role="application"
        :aria-label="t('documents.viewer.gpxTrack')"
        data-testid="gpx-track"
      />
      <div class="map-actions">
        <v-btn
          size="small"
          icon="mdi-fit-to-page-outline"
          :title="t('documents.viewer.gpxFit')"
          :aria-label="t('documents.viewer.gpxFit')"
          data-testid="gpx-fit"
          @click="fitTrack"
        />
        <v-btn
          size="small"
          :icon="tall ? 'mdi-arrow-collapse-vertical' : 'mdi-arrow-expand-vertical'"
          :title="tall ? t('documents.viewer.gpxShrink') : t('documents.viewer.gpxEnlarge')"
          :aria-label="tall ? t('documents.viewer.gpxShrink') : t('documents.viewer.gpxEnlarge')"
          data-testid="gpx-height"
          @click="tall = !tall"
        />
      </div>
      <div v-if="baseUnavailable" class="unavailable text-caption" data-testid="gpx-map-unavailable">
        {{ t('documents.viewer.gpxMapUnavailable') }}
      </div>
    </div>

    <div role="group" :aria-label="t('documents.viewer.gpxMapLayers')" data-testid="gpx-layers">
      <div class="text-caption text-medium-emphasis">{{ t('documents.viewer.gpxBaseTitle') }}</div>
      <v-radio-group v-model="base" inline density="compact" hide-details>
        <v-radio v-for="b in baseItems" :key="b.value" :label="b.title" :value="b.value" :data-testid="`gpx-base-${b.value}`" />
      </v-radio-group>
      <v-btn
        variant="text"
        size="small"
        :prepend-icon="layersOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'"
        :aria-expanded="layersOpen"
        data-testid="gpx-overlays-toggle"
        @click="layersOpen = !layersOpen"
      >
        {{ layersButton }}
      </v-btn>
      <div v-show="layersOpen" class="d-flex flex-wrap ga-6 mt-1" data-testid="gpx-overlays">
        <div v-for="g in OVERLAY_GROUPS" :key="g.key">
          <div class="text-caption text-medium-emphasis">{{ t(`documents.viewer.${g.key}`) }}</div>
          <v-checkbox
            v-for="o in g.items"
            :key="o"
            v-model="overlays"
            :value="o"
            :label="t(`documents.viewer.gpxOverlay.${o}`)"
            density="compact"
            hide-details
            :data-testid="`gpx-overlay-${o}`"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.map-wrap {
  position: relative;
}
.gpx-map {
  width: 100%;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  background: #e8e8e8;
  z-index: 0;
  cursor: crosshair;
}
.map-actions {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1000;
  display: flex;
  gap: 6px;
}
.unavailable {
  position: absolute;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 1000;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.9);
  color: #333;
}
</style>
