<script setup lang="ts">
/** App shell: app bar + navigation drawer + router view. Shared by all modules; change with care. */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/composables/useSession'
import { authRedirect } from '@/lib/authRedirect'
import { isTauri } from '@/lib/tauri'
import { installMcpBridge } from '@/composables/mcpBridge'
import { useMcp } from '@/composables/useMcp'
import McpConfirmDialog from '@/components/mcp/McpConfirmDialog.vue'
import { initResources } from '@/composables/useResources'
import { initRuleEdits } from '@/composables/useRuleEdits'

const { t } = useI18n()
const inTauri = isTauri()
const { isLoggedIn, init } = useSession()
const route = useRoute()
const router = useRouter()
const drawer = ref(true)

const navItems = [
  { to: '/verbindung', icon: 'mdi-connection', titleKey: 'nav.connection', auth: false, hideWhenLoggedIn: true },
  { to: '/lager', icon: 'mdi-tent', titleKey: 'nav.camps', auth: true },
  { to: '/fristen', icon: 'mdi-calendar-clock', titleKey: 'nav.deadlines', auth: true },
  { to: '/regeln', icon: 'mdi-book-check-outline', titleKey: 'nav.rules', auth: true },
  { to: '/hilfsmittel', icon: 'mdi-bookshelf', titleKey: 'nav.resources', auth: true },
  { to: '/einstellungen', icon: 'mdi-cog-outline', titleKey: 'nav.settings', auth: true },
]

const visibleNavItems = computed(() => navItems.filter((i) => !(i.hideWhenLoggedIn && isLoggedIn.value)))

// ADR 0013: Hilfsmittel overlay + rule edits load once the data store is ready (idempotent).
initResources()
initRuleEdits()

onMounted(() => {
  if (inTauri) {
    void init()
    // ADR 0012: MCP tool calls run in this window; the server starts only if AI + MCP are enabled.
    void installMcpBridge().then(() => useMcp().init())
  }
})

watch(isLoggedIn, (loggedIn) => {
  const target = authRedirect(loggedIn, {
    requiresAuth: route.matched.some((r) => r.meta.requiresAuth),
    name: route.name,
    redirect: route.query.redirect,
  })
  if (target) void router.replace(target)
})
</script>

<template>
  <v-app>
    <v-app-bar color="primary" density="comfortable" flat>
      <template #prepend>
        <v-app-bar-nav-icon :aria-label="t('nav.toggle')" @click="drawer = !drawer" />
        <v-icon icon="mdi-tent" class="ms-1" />
      </template>
      <v-app-bar-title>
        <span class="font-weight-bold">{{ t('app.name') }}</span>
        <span class="text-medium-emphasis"> · {{ t('app.subtitle') }}</span>
      </v-app-bar-title>
      <template #append>
        <v-chip
          class="me-3"
          variant="flat"
          :color="isLoggedIn ? 'success' : 'surface'"
          :prepend-icon="isLoggedIn ? 'mdi-account-check' : 'mdi-account-off-outline'"
          size="small"
          :to="isLoggedIn ? '/einstellungen#instanzen' : '/verbindung'"
        >
          {{ isLoggedIn ? t('app.status.loggedIn') : t('app.status.loggedOut') }}
        </v-chip>
      </template>
    </v-app-bar>

    <v-navigation-drawer v-model="drawer" width="220">
      <v-list nav density="comfortable">
        <v-list-item
          v-for="item in visibleNavItems"
          :key="item.to"
          :to="item.to"
          :prepend-icon="item.icon"
          :title="t(item.titleKey)"
          :disabled="item.auth && !isLoggedIn"
        />
      </v-list>
    </v-navigation-drawer>

    <v-main>
      <v-container fluid class="cockpit">
        <v-alert
          v-if="!inTauri"
          type="warning"
          variant="tonal"
          icon="mdi-monitor-off"
          class="mb-4"
          :title="t('notTauri.title')"
          :text="t('notTauri.text')"
        />
        <router-view />
      </v-container>
    </v-main>

    <McpConfirmDialog />

  </v-app>
</template>

<style scoped>
.cockpit {
  max-width: 1600px;
}
</style>
