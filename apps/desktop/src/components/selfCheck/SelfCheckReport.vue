<script setup lang="ts">
/** Native rendering of the self-check report model: chips, a section per severity, fixed list. */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SelfCheckReportModel } from '@/domain/selfCheck'
import { triageLocation } from '@/domain/triage'
import type { Iri, Severity } from '@/domain/types'
import { commands } from '@/lib/tauri'

defineProps<{ model: SelfCheckReportModel; campIri: Iri }>()
const { t } = useI18n()

const SEV: Record<Severity, { color: string; icon: string }> = {
  must: { color: 'error', icon: 'mdi-alert-circle' },
  should: { color: 'warning', icon: 'mdi-alert' },
  hint: { color: 'info', icon: 'mdi-information' },
}

const openError = ref<string | null>(null)
async function openEcamp(url: string) {
  openError.value = null
  try {
    await commands.openEcampUrl(url)
  } catch (e) {
    openError.value = `${t('selfCheck.report.openInEcampFailed')}: ${e instanceof Error ? e.message : String(e)}`
  }
}
</script>

<template>
  <div data-testid="selfcheck-report">
    <div class="text-subtitle-1 mb-2">{{ model.heading }}</div>
    <div class="d-flex flex-wrap ga-2 mb-3">
      <v-chip color="error" variant="tonal" size="small">{{ t('selfCheck.kpi.must') }} {{ model.counts.must }}</v-chip>
      <v-chip color="warning" variant="tonal" size="small">{{ t('selfCheck.kpi.should') }} {{ model.counts.should }}</v-chip>
      <v-chip color="info" variant="tonal" size="small">{{ t('selfCheck.kpi.hint') }} {{ model.counts.hint }}</v-chip>
      <v-chip v-if="model.jsDays" variant="tonal" size="small">{{ t('selfCheck.report.jsDaysChip', model.jsDays) }}</v-chip>
    </div>
    <v-alert v-if="openError" type="error" variant="tonal" density="compact" class="mb-2">{{ openError }}</v-alert>

    <div v-if="model.groups.length === 0" class="text-medium-emphasis">{{ t('selfCheck.report.none') }}</div>
    <section v-for="g in model.groups" :key="g.severity" class="mb-3" :data-testid="`selfcheck-report-${g.severity}`">
      <div class="text-subtitle-2 d-flex align-center ga-2">
        <v-icon :icon="SEV[g.severity].icon" :color="SEV[g.severity].color" size="small" />
        {{ t(`selfCheck.report.group.${g.severity}`, { n: g.items.length }) }}
      </div>
      <v-list density="compact" class="py-0">
        <v-list-item v-for="it in g.items" :key="it.findingId" data-testid="selfcheck-report-item">
          <v-list-item-title class="text-wrap">
            <template v-if="it.activityLabel">
              <a
                v-if="it.url"
                href="#"
                class="text-primary"
                data-testid="selfcheck-report-link"
                @click.prevent="openEcamp(it.url)"
              >{{ it.activityLabel }}</a>
              <span v-else>{{ it.activityLabel }}</span>
              <span>: </span>
            </template>
            <strong>{{ it.title }}</strong>
          </v-list-item-title>
          <v-list-item-subtitle class="text-wrap">{{ it.message }}</v-list-item-subtitle>
          <template #append>
            <v-btn
              icon="mdi-arrow-right"
              size="x-small"
              variant="text"
              :to="triageLocation(campIri, it.findingId)"
              :aria-label="t('selfCheck.report.openFinding')"
            />
          </template>
        </v-list-item>
      </v-list>
    </section>

    <div v-if="model.fixed.length > 0" data-testid="selfcheck-report-fixed">
      <div class="text-subtitle-2 d-flex align-center ga-2">
        <v-icon icon="mdi-check-circle-outline" color="success" size="small" />
        {{ t('selfCheck.report.fixedHeading', { n: model.fixed.length }) }}
      </div>
      <ul class="text-body-2 text-medium-emphasis pl-6">
        <li v-for="f in model.fixed" :key="f.id">{{ f.title }}</li>
      </ul>
    </div>
  </div>
</template>
