<script setup lang="ts">
/** Settings: plain-language visualisation of the data zones (ADR 0005). Facts mirror domain/zones, domain/backup. */
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const zones = [
  { key: 'green', color: 'success', icon: 'mdi-shield-check' },
  { key: 'yellow', color: 'warning', icon: 'mdi-shield-alert' },
  { key: 'red', color: 'error', icon: 'mdi-shield-lock' },
] as const
const rows = ['source', 'stored', 'ai', 'backup', 'leaves'] as const
const details = ['keychain', 'encryption', 'ai', 'backup'] as const
</script>

<template>
  <div data-testid="data-zones">
    <p class="mb-4">{{ t('settings.dataZones.intro') }}</p>

    <v-row>
      <v-col v-for="z in zones" :key="z.key" cols="12" md="4">
        <v-card :color="z.color" variant="tonal" height="100%" :data-testid="`zone-${z.key}`">
          <v-card-title class="d-flex align-center ga-2">
            <v-icon :icon="z.icon" />
            {{ t(`settings.dataZones.${z.key}.name`) }}
          </v-card-title>
          <v-card-subtitle class="text-wrap">{{ t(`settings.dataZones.${z.key}.title`) }}</v-card-subtitle>
          <v-card-text>
            <p class="font-weight-medium mb-2">{{ t(`settings.dataZones.${z.key}.examples`) }}</p>
            <v-expansion-panels variant="accordion" flat>
              <v-expansion-panel bg-color="transparent" :data-testid="`zone-more-${z.key}`">
                <v-expansion-panel-title class="px-0">{{ t('settings.dataZones.more') }}</v-expansion-panel-title>
                <v-expansion-panel-text>
                  <div v-for="r in rows" :key="r" class="mb-2">
                    <div class="text-caption font-weight-bold">{{ t(`settings.dataZones.rows.${r}`) }}</div>
                    <div>{{ t(`settings.dataZones.${z.key}.${r}`) }}</div>
                  </div>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <h3 class="text-subtitle-1 mt-4 mb-2">{{ t('settings.dataZones.flow.title') }}</h3>
    <svg viewBox="0 0 800 180" role="img" :aria-label="t('settings.dataZones.flow.alt')" class="flow" data-testid="data-zones-flow">
      <defs>
        <marker id="dz-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L10 5L0 10z" class="arrow" />
        </marker>
      </defs>
      <g class="box">
        <rect x="4" y="30" width="150" height="100" rx="10" />
        <rect x="204" y="30" width="190" height="100" rx="10" />
        <rect x="444" y="30" width="150" height="100" rx="10" />
        <rect x="644" y="30" width="152" height="100" rx="10" class="ai" />
      </g>
      <g class="line">
        <path d="M154 80H202" marker-end="url(#dz-arrow)" />
        <path d="M394 80H442" marker-end="url(#dz-arrow)" />
        <path d="M594 80H642" marker-end="url(#dz-arrow)" class="dashed" />
      </g>
      <g class="txt">
        <text x="79" y="58" text-anchor="middle" class="b">{{ t('settings.dataZones.flow.sources') }}</text>
        <text x="79" y="82" text-anchor="middle" class="s">eCamp · MiData</text>
        <text x="79" y="100" text-anchor="middle" class="s">NDS · Dokumente</text>
        <text x="299" y="54" text-anchor="middle" class="b">{{ t('settings.dataZones.flow.rust') }}</text>
        <text x="299" y="74" text-anchor="middle" class="s">{{ t('settings.dataZones.flow.rustA') }}</text>
        <text x="299" y="91" text-anchor="middle" class="s">{{ t('settings.dataZones.flow.rustB') }}</text>
        <text x="299" y="108" text-anchor="middle" class="s">{{ t('settings.dataZones.flow.rustB2') }}</text>
        <text x="299" y="125" text-anchor="middle" class="s">{{ t('settings.dataZones.flow.rustC') }}</text>
        <text x="519" y="58" text-anchor="middle" class="b">{{ t('settings.dataZones.flow.app') }}</text>
        <text x="519" y="82" text-anchor="middle" class="s">{{ t('settings.dataZones.flow.appA') }}</text>
        <text x="519" y="99" text-anchor="middle" class="s">{{ t('settings.dataZones.flow.appB') }}</text>
        <text x="720" y="58" text-anchor="middle" class="b">{{ t('settings.dataZones.flow.gateway') }}</text>
        <text x="720" y="82" text-anchor="middle" class="s">{{ t('settings.dataZones.flow.gatewayA') }}</text>
        <text x="720" y="99" text-anchor="middle" class="s">{{ t('settings.dataZones.flow.gatewayB') }}</text>
      </g>
      <g class="blocked">
        <rect x="654" y="140" width="132" height="30" rx="15" />
        <text x="720" y="160" text-anchor="middle">{{ t('settings.dataZones.flow.redLabel') }}: {{ t('settings.dataZones.flow.blocked') }}</text>
      </g>
    </svg>

    <v-expansion-panels variant="accordion" class="mt-4" data-testid="data-zones-details">
      <v-expansion-panel v-for="d in details" :key="d">
        <v-expansion-panel-title>{{ t(`settings.dataZones.details.${d}Title`) }}</v-expansion-panel-title>
        <v-expansion-panel-text>{{ t(`settings.dataZones.details.${d}`) }}</v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>

<style scoped>
.flow {
  width: 100%;
  max-width: 800px;
  height: auto;
  font-size: 13px;
}
.box rect {
  fill: rgb(var(--v-theme-surface));
  stroke: rgb(var(--v-theme-on-surface));
  stroke-opacity: 0.4;
  stroke-width: 1.5;
}
.box rect.ai {
  stroke: rgb(var(--v-theme-warning));
  stroke-opacity: 1;
}
.line path {
  fill: none;
  stroke: rgb(var(--v-theme-on-surface));
  stroke-opacity: 0.7;
  stroke-width: 2;
}
.line path.dashed {
  stroke-dasharray: 5 4;
}
.arrow {
  fill: rgb(var(--v-theme-on-surface));
  fill-opacity: 0.7;
}
.txt text {
  fill: rgb(var(--v-theme-on-surface));
}
.txt .b {
  font-weight: 700;
}
.txt .s {
  font-size: 11px;
}
.blocked rect {
  fill: rgb(var(--v-theme-error));
}
.blocked text {
  fill: rgb(var(--v-theme-on-error));
  font-weight: 700;
  font-size: 12px;
}
</style>
