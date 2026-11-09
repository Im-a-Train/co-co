<script setup lang="ts">
/** App shell: app bar + navigation drawer + router view. Shared by all modules; change with care. */
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/composables/useSession'
import { useBackup } from '@/components/backup/useBackup'
import { authRedirect } from '@/lib/authRedirect'
import { isTauri } from '@/lib/tauri'
import { installMcpBridge } from '@/composables/mcpBridge'
import { useMcp } from '@/composables/useMcp'
import McpConfirmDialog from '@/components/mcp/McpConfirmDialog.vue'

const { t } = useI18n()
const inTauri = isTauri()
const { isLoggedIn, init } = useSession()
const route = useRoute()
const router = useRouter()
const drawer = ref(true)

const navItems = [
  { to: '/verbindung', icon: 'mdi-connection', titleKey: 'nav.connection', auth: false },
  { to: '/lager', icon: 'mdi-tent', titleKey: 'nav.camps', auth: true },
  { to: '/fristen', icon: 'mdi-calendar-clock', titleKey: 'nav.deadlines', auth: false },
  { to: '/regeln', icon: 'mdi-book-check-outline', titleKey: 'nav.rules', auth: false },
  { to: '/einstellungen', icon: 'mdi-cog-outline', titleKey: 'nav.settings', auth: false },
]

onMounted(() => {
  if (inTauri) {
    void init()
    // ADR 0012: MCP tool calls run in this window; the server starts only if AI + MCP are enabled.
    void installMcpBridge().then(() => useMcp().init())
  }
  void backup.refresh()
})

watch(isLoggedIn, (loggedIn) => {
  const target = authRedirect(loggedIn, {
    requiresAuth: route.matched.some((r) => r.meta.requiresAuth),
    name: route.name,
    redirect: route.query.redirect,
  })
  if (target) void router.replace(target)
})

// Global backup reminder: shown whenever a round was started/closed and no export happened since.
const backup = useBackup()
const reminderSnack = ref(false)
watch(backup.reminderDue, (due, was) => {
  if (due && !was && !route.path.startsWith('/lager/')) reminderSnack.value = true
  if (!due) reminderSnack.value = false
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
          to="/verbindung"
        >
          {{ isLoggedIn ? t('app.status.loggedIn') : t('app.status.loggedOut') }}
        </v-chip>
      </template>
    </v-app-bar>

    <v-navigation-drawer v-model="drawer" width="220">
      <v-list nav density="comfortable">
        <v-list-item
          v-for="item in navItems"
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

    <v-snackbar v-model="reminderSnack" color="warning" :timeout="10000" multi-line>
      {{ t('backup.reminder.text') }}
      <template #actions>
        <v-btn variant="text" to="/einstellungen#backup" @click="reminderSnack = false">
          {{ t('backup.reminder.settings') }}
        </v-btn>
      </template>
    </v-snackbar>
  </v-app>
</template>

<style scoped>
.cockpit {
  max-width: 1600px;
}
</style>
