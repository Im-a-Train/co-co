<script setup lang="ts">
/**
 * /einstellungen: composes the section components, ordered by how often a coach needs them:
 * Konto, Datensicherung, MiData und NDS, KI, Datenschutz, Fehlersuche (UX review FIRST-10).
 * A sticky anchor list shows at >= 1280 px.
 */
import { nextTick, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import AiSection from '@/components/settings/AiSection.vue'
import BackupSection from '@/components/settings/BackupSection.vue'
import DataZonesSection from '@/components/settings/DataZonesSection.vue'
import DiagnosticsSection from '@/components/settings/DiagnosticsSection.vue'
import InstancesSection from '@/components/settings/InstancesSection.vue'
import MidataSection from '@/components/settings/MidataSection.vue'
import NdsSection from '@/components/settings/NdsSection.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const anchors = [
  { id: 'instanzen', label: 'settings.sections.instances' },
  { id: 'backup', label: 'settings.sections.backup' },
  { id: 'midata', label: 'settings.connections.midata' },
  { id: 'nds', label: 'settings.connections.nds' },
  { id: 'ki', label: 'settings.sections.ai' },
  { id: 'datenschutz', label: 'settings.sections.dataZonesShort' },
  { id: 'diagnose', label: 'settings.sections.diagnostics' },
]

/** Scrolls to the section named by the URL hash (the router has no scrollBehavior). */
function scrollToHash(): void {
  const id = route.hash.replace(/^#/, '')
  if (!id) return
  void nextTick(() => setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 150))
}
/**
 * Anchor list: a new hash scrolls via the watcher. Scrolling here as well would start a second scroll
 * while the first still runs, and Chromium then lands off target.
 */
function goTo(id: string): void {
  if (route.hash === `#${id}`) document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  else void router.replace({ hash: `#${id}` })
}
onMounted(scrollToHash)
watch(() => route.hash, scrollToHash)
</script>

<template>
  <div>
    <h1 class="text-h5 mb-4">{{ t('settings.title') }}</h1>
    <div class="d-flex ga-8 align-start">
      <div class="settings-main flex-grow-1">
        <section id="instanzen" class="mb-8">
          <h2 class="text-h6 mb-2">{{ t('settings.sections.instances') }}</h2>
          <InstancesSection />
        </section>
        <section id="backup" class="mb-8">
          <h2 class="text-h6 mb-2">{{ t('settings.sections.backup') }}</h2>
          <BackupSection />
        </section>
        <section id="midata" class="mb-8">
          <h2 class="text-h6 mb-2">{{ t('settings.sections.midataNds') }}</h2>
          <h3 class="text-subtitle-1 font-weight-bold mb-2">{{ t('settings.connections.midata') }}</h3>
          <MidataSection />
          <div id="nds" class="mt-4">
            <h3 class="text-subtitle-1 font-weight-bold mb-2">{{ t('settings.connections.nds') }}</h3>
            <NdsSection />
          </div>
        </section>
        <section id="ki" class="mb-8">
          <h2 class="text-h6 mb-2">{{ t('settings.sections.ai') }}</h2>
          <AiSection />
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
      <nav class="settings-anchors d-none d-lg-block" :aria-label="t('settings.sections.navLabel')" data-testid="settings-anchors">
        <v-list nav density="compact" class="py-0">
          <v-list-item
            v-for="a in anchors"
            :key="a.id"
            :title="t(a.label)"
            :active="route.hash === `#${a.id}`"
            :data-testid="`settings-anchor-${a.id}`"
            @click="goTo(a.id)"
          />
        </v-list>
      </nav>
    </div>
  </div>
</template>

<style scoped>
.settings-main {
  min-width: 0;
}
/* Keep the section heading below the fixed app bar when jumping to an anchor. */
.settings-main section,
.settings-main #nds {
  scroll-margin-top: 64px;
}
.settings-anchors {
  position: sticky;
  top: 80px;
  width: 200px;
  flex: 0 0 200px;
}
</style>
