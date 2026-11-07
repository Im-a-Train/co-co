<script setup lang="ts">
/**
 * /einstellungen: composes the section components. Shared by all modules; change with care.
 * Instanzen + Diagnose -> data, KI -> ai, Backup -> rounds.
 */
import { useI18n } from 'vue-i18n'
import AiSection from '@/components/settings/AiSection.vue'
import BackupSection from '@/components/settings/BackupSection.vue'
import DiagnosticsSection from '@/components/settings/DiagnosticsSection.vue'
import InstancesSection from '@/components/settings/InstancesSection.vue'
import MidataSection from '@/components/settings/MidataSection.vue'
import NdsSection from '@/components/settings/NdsSection.vue'

const { t } = useI18n()
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
    <section id="midata" class="mb-8">
      <h2 class="text-h6 mb-2">{{ t('midata.settings.title') }}</h2>
      <MidataSection />
    </section>
    <section id="nds" class="mb-8">
      <h2 class="text-h6 mb-2">{{ t('nds.settings.title') }}</h2>
      <NdsSection />
    </section>
    <section id="backup" class="mb-8">
      <h2 class="text-h6 mb-2">{{ t('settings.sections.backup') }}</h2>
      <BackupSection />
    </section>
    <section id="diagnose" class="mb-8">
      <h2 class="text-h6 mb-2">{{ t('settings.sections.diagnostics') }}</h2>
      <DiagnosticsSection />
    </section>
  </div>
</template>
