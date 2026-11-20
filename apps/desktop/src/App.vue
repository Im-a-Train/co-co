<script setup lang="ts">
/** App shell: app bar + navigation drawer + router view. Shared by all modules; change with care. */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/composables/useSession'
import { useSignOut } from '@/composables/useSignOut'
import { authRedirect } from '@/lib/authRedirect'
import { isTauri } from '@/lib/tauri'
import { installMcpBridge } from '@/composables/mcpBridge'
import { useMcp } from '@/composables/useMcp'
import McpConfirmDialog from '@/components/mcp/McpConfirmDialog.vue'
import UpdateDialog from '@/components/update/UpdateDialog.vue'
import { useAppUpdate } from '@/composables/useAppUpdate'
import { initResources } from '@/composables/useResources'
import { initRuleEdits } from '@/composables/useRuleEdits'

const { t } = useI18n()
const inTauri = isTauri()
const { isLoggedIn, init, session, user, expired } = useSession()
const signOut = useSignOut()
const route = useRoute()
const router = useRouter()
const drawer = ref(true)

const navItems = [
  { to: '/lager', icon: 'mdi-tent', titleKey: 'nav.camps' },
  { to: '/fristen', icon: 'mdi-calendar-clock', titleKey: 'nav.deadlines' },
  { to: '/regeln', icon: 'mdi-book-check-outline', titleKey: 'nav.rules' },
  { to: '/hilfsmittel', icon: 'mdi-bookshelf', titleKey: 'nav.resources' },
  { to: '/einstellungen', icon: 'mdi-cog-outline', titleKey: 'nav.settings' },
]

const accountName = computed(() => user.value?.displayName ?? t('app.account.fallbackName'))
const isTestInstance = computed(() => {
  const base = session.value?.baseUrl
  if (!base) return false
  try {
    return new URL(base).host !== 'app.ecamp3.ch'
  } catch {
    return false
  }
})

// ADR 0013: Hilfsmittel overlay + rule edits load once the data store is ready (idempotent).
initResources()
initRuleEdits()

onMounted(() => {
  if (inTauri) {
    void init()
    // ADR 0012: MCP tool calls run in this window; the server starts only if AI + MCP are enabled.
    void installMcpBridge().then(() => useMcp().init())
    // ADR 0017: update check, non-blocking, once the data store is unlocked (settings live there).
    useAppUpdate().startAuto()
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
    <v-app-bar color="primary" density="compact" flat>
      <template #prepend>
        <v-app-bar-nav-icon v-if="isLoggedIn" :aria-label="t('nav.toggle')" @click="drawer = !drawer" />
        <v-icon icon="mdi-tent" class="ms-1" />
      </template>
      <v-app-bar-title>
        <span class="font-weight-bold">{{ t('app.name') }}</span>
        <span class="text-medium-emphasis"> · {{ t('app.subtitle') }}</span>
      </v-app-bar-title>
      <template #append>
        <v-menu v-if="isLoggedIn" location="bottom end">
          <template #activator="{ props: menuProps }">
            <v-chip
              v-bind="menuProps"
              class="me-3"
              variant="flat"
              :color="expired ? 'error' : 'success'"
              :prepend-icon="expired ? 'mdi-alert-circle-outline' : 'mdi-account-check'"
              append-icon="mdi-menu-down"
              size="small"
              data-testid="account-chip"
            >
              {{ expired ? t('app.account.expired') : accountName }}
              <v-chip v-if="isTestInstance" size="x-small" variant="flat" color="warning" class="ms-2">
                {{ t('app.account.testInstance') }}
              </v-chip>
            </v-chip>
          </template>
          <v-list density="compact">
            <v-list-item
              to="/einstellungen#instanzen"
              prepend-icon="mdi-cog-outline"
              :title="t('app.account.settings')"
            />
            <v-list-item
              prepend-icon="mdi-logout"
              :title="t('app.account.signOut')"
              data-testid="account-signout"
              @click="signOut"
            />
          </v-list>
        </v-menu>
        <v-chip
          v-else
          class="me-3"
          variant="flat"
          color="surface"
          prepend-icon="mdi-account-off-outline"
          size="small"
          to="/verbindung"
        >
          {{ t('app.status.loggedOut') }}
        </v-chip>
      </template>
    </v-app-bar>

    <v-navigation-drawer v-if="isLoggedIn" v-model="drawer" width="220">
      <v-list nav density="comfortable">
        <v-list-item
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          :prepend-icon="item.icon"
          :title="t(item.titleKey)"
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
    <UpdateDialog />

  </v-app>
</template>

<style scoped>
.cockpit {
  max-width: 1600px;
}
</style>

<style>
/* Buttons and tabs are sentence case (VBtn/VTab default class text-none): drop the upper-case letter-spacing too. */
.v-btn.text-none {
  letter-spacing: normal;
}
</style>
