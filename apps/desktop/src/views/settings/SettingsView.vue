<script setup lang="ts">
/**
 * /einstellungen: composes the section components. Shared by all modules; change with care.
 * Instanzen + Diagnose -> data, KI -> ai, Backup -> rounds.
 */
import { nextTick, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import AiSection from '@/components/settings/AiSection.vue'
import BackupSection from '@/components/settings/BackupSection.vue'
import DataZonesSection from '@/components/settings/DataZonesSection.vue'
import DiagnosticsSection from '@/components/settings/DiagnosticsSection.vue'
import InstancesSection from '@/components/settings/InstancesSection.vue'

const { t } = useI18n()
const route = useRoute()

/** Scrolls to the section named by the URL hash (the router has no scrollBehavior). */
function scrollToHash(): void {
  const id = route.hash.replace(/^#/, '')
  if (!id) return
  void nextTick(() => setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 150))
}
onMounted(scrollToHash)
watch(() => route.hash, scrollToHash)
</script>

<template>
  <div>
    <h1 class="text-h5 mb-4">{{ t('settings.title') }}</h1>
    <section id="instanzen" class="mb-8">
      <h2 class="text-h6 mb-2">{{ t('settings.sections.instances') }}</h2>
      <InstancesSection />
    </section>
    <section id="ki" class="mb-8">
      <h2 class="text-h6 mb-2">{{ t('settings.sections.ai') }}</h2>
      <AiSection />
    </section>
    <section id="backup" class="mb-8">
      <h2 class="text-h6 mb-2">{{ t('settings.sections.backup') }}</h2>
      <BackupSection />
    </section>
    <section id="datenschutz" class="mb-8">
      <h2 class="text-h6 mb-2">{{ t('settings.sections.dataZones') }}</h2>
      <DataZonesSection />
    </section>
    <section id="diagnose" class="mb-8">
      <h2 class="text-h6 mb-2">{{ t('settings.sections.diagnostics') }}</h2>
      <DiagnosticsSection />
    </section>
  </div>
</template>
