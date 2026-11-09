<script setup lang="ts">
/**
 * Small connection status chips (eCamp / MiData / NDS) for the camp header.
 * Reads cached state only; init() of MiData/NDS is the same local settings + status read the settings sections run.
 */
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useMidata } from '@/composables/useMidata'
import { useNds } from '@/composables/useNds'
import { useSession } from '@/composables/useSession'

const { t } = useI18n()
const router = useRouter()
const { isLoggedIn, expired } = useSession()
const midata = useMidata()
const nds = useNds()

onMounted(() => {
  void midata.init()
  void nds.init()
})

interface Chip {
  key: string
  label: string
  tooltip: string
  color: string
  icon: string
  hash: string
}

const OK = 'mdi-check-circle-outline'
const OFF = 'mdi-link-off'

const chips = computed<Chip[]>(() => {
  const ecamp: Chip = {
    key: 'ecamp',
    label: t('connectionStatus.ecamp'),
    hash: 'instanzen',
    ...(!isLoggedIn.value
      ? { tooltip: t('connectionStatus.ecampOff'), color: 'grey', icon: OFF }
      : expired.value
        ? { tooltip: t('connectionStatus.ecampExpired'), color: 'error', icon: 'mdi-alert-circle-outline' }
        : { tooltip: t('connectionStatus.ecampOk'), color: 'success', icon: OK }),
  }
  const md: Chip = {
    key: 'midata',
    label: t('connectionStatus.midata'),
    hash: 'midata',
    ...(midata.connected.value
      ? { tooltip: t('connectionStatus.midataOk'), color: 'success', icon: OK }
      : { tooltip: t('connectionStatus.midataOff'), color: 'grey', icon: OFF }),
  }
  const n: Chip = {
    key: 'nds',
    label: t('connectionStatus.nds'),
    hash: 'nds',
    ...(!nds.enabled.value
      ? { tooltip: t('connectionStatus.ndsDisabled'), color: 'grey', icon: 'mdi-power-plug-off-outline' }
      : nds.connected.value
        ? { tooltip: t('connectionStatus.ndsOk'), color: 'success', icon: OK }
        : { tooltip: t('connectionStatus.ndsOff'), color: 'warning', icon: OFF }),
  }
  if (!nds.enabled.value) n.label = `${n.label} · ${t('connectionStatus.off')}`
  return [ecamp, md, n]
})

function open(hash: string): void {
  void router.push({ path: '/einstellungen', hash: `#${hash}` })
}
</script>

<template>
  <div class="d-flex align-center ga-1" data-testid="connection-chips">
    <v-chip
      v-for="c in chips"
      :key="c.key"
      size="small"
      variant="tonal"
      :color="c.color"
      :prepend-icon="c.icon"
      :data-testid="`conn-chip-${c.key}`"
      :aria-label="c.tooltip"
      @click="open(c.hash)"
    >
      {{ c.label }}
      <v-tooltip activator="parent" location="bottom">{{ c.tooltip }}. {{ t('connectionStatus.open') }}</v-tooltip>
    </v-chip>
  </div>
</template>
