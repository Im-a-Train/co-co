<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSession } from '@/composables/useSession'
import { useSignOut } from '@/composables/useSignOut'
import { formatDuration, normalizeEpochMs } from '@/lib/refresh'

defineProps<{ compact?: boolean }>()

const { t, d } = useI18n()
const { session, user, userError, userLoading, busy, now, nextRefreshAt, secondsLeft, expired, refresh, loadUser } = useSession()
const signOut = useSignOut()

const expiresAt = computed(() => (session.value?.exp != null ? new Date(session.value.exp * 1000) : null))
const obtainedAt = computed(() => (session.value ? new Date(normalizeEpochMs(session.value.obtainedAt)) : null))
const nextRefreshIn = computed(() =>
  nextRefreshAt.value != null ? Math.max(0, Math.round((nextRefreshAt.value - now.value) / 1000)) : null,
)

const instanceHost = computed(() => {
  if (!session.value) return ''
  try {
    return new URL(session.value.baseUrl).host
  } catch {
    return session.value.baseUrl
  }
})

async function doLogout(): Promise<void> {
  await signOut()
}
</script>

<template>
  <v-card data-testid="session-card">
    <v-card-item prepend-icon="mdi-shield-key-outline">
      <v-card-title>{{ compact ? t('session.account.title') : t('session.title') }}</v-card-title>
      <v-card-subtitle v-if="!compact">{{ session ? session.baseUrl : t('session.none') }}</v-card-subtitle>
      <template #append>
        <v-chip v-if="session" size="small" :color="expired ? 'error' : 'success'" variant="tonal">
          {{ expired ? t('session.expired') : t('session.active') }}
        </v-chip>
      </template>
    </v-card-item>

    <v-card-text v-if="!session">
      <v-empty-state
        icon="mdi-account-lock-outline"
        :title="t('session.emptyTitle')"
        :text="t('session.emptyText')"
        size="64"
      />
    </v-card-text>

    <v-card-text v-else-if="compact">
      <v-list density="compact" class="py-0 bg-transparent" data-testid="session-account">
        <v-list-item prepend-icon="mdi-account-circle-outline" :subtitle="t('session.account.name')">
          <!-- #title slot (not a default-slot title) keeps «value above label» like the other rows -->
          <template #title>
            <v-progress-circular v-if="userLoading" indeterminate size="16" width="2" class="me-2" />
            <template v-if="user">
              {{ [user.firstname, user.surname].filter(Boolean).join(' ') || user.displayName || t('common.unknown') }}
            </template>
            <template v-else-if="!userLoading">{{ session.userIri ?? t('common.unknown') }}</template>
          </template>
          <div v-if="userError" class="text-caption text-error">
            {{ t('session.userFailed') }}: {{ userError }}
            <v-btn size="x-small" variant="text" @click="loadUser">{{ t('common.retry') }}</v-btn>
          </div>
        </v-list-item>
        <v-list-item v-if="user?.email" prepend-icon="mdi-email-outline" :title="user.email" :subtitle="t('session.account.email')" />
        <v-list-item prepend-icon="mdi-server-network" :title="instanceHost" :subtitle="t('session.account.instance')" />
      </v-list>
    </v-card-text>

    <v-card-text v-else>
      <v-list density="compact" class="py-0 bg-transparent">
        <v-list-item prepend-icon="mdi-key-chain-variant" :title="t(`session.method.${session.method}`)" :subtitle="t('session.methodLabel')" />
        <v-list-item prepend-icon="mdi-account-circle-outline" :subtitle="t('session.user')">
          <v-list-item-title>
            <v-progress-circular v-if="userLoading" indeterminate size="16" width="2" class="me-2" />
            <template v-if="user">
              {{ user.displayName ?? t('common.unknown') }}
              <span v-if="user.firstname || user.surname" class="text-medium-emphasis">
                ({{ [user.firstname, user.surname].filter(Boolean).join(' ') }})
              </span>
            </template>
            <template v-else-if="!userLoading">{{ session.userIri ?? t('common.unknown') }}</template>
          </v-list-item-title>
          <div v-if="user?.email" class="text-caption">{{ user.email }}</div>
          <div v-if="userError" class="text-caption text-error">
            {{ t('session.userFailed') }}: {{ userError }}
            <v-btn size="x-small" variant="text" @click="loadUser">{{ t('common.retry') }}</v-btn>
          </div>
        </v-list-item>
        <v-list-item prepend-icon="mdi-timer-sand" :subtitle="t('session.expiresIn')">
          <v-list-item-title :class="{ 'text-error': expired }">
            <span class="mono">{{ formatDuration(secondsLeft) }}</span>
            <span v-if="expiresAt" class="text-medium-emphasis text-body-2">
              · {{ d(expiresAt, 'time') }}
            </span>
          </v-list-item-title>
        </v-list-item>
        <v-list-item prepend-icon="mdi-autorenew" :subtitle="t('session.nextRefresh')">
          <v-list-item-title class="mono">
            {{ nextRefreshIn != null ? formatDuration(nextRefreshIn) : '–' }}
          </v-list-item-title>
        </v-list-item>
        <v-list-item prepend-icon="mdi-cookie-outline" :subtitle="t('session.cookieNames')">
          <div class="pt-1">
            <v-chip v-for="name in session.cookieNames" :key="name" size="x-small" class="me-1 mb-1 mono">{{ name }}</v-chip>
            <span v-if="!session.cookieNames.length">{{ t('common.none') }}</span>
          </div>
        </v-list-item>
        <v-list-item v-if="session.roles.length" prepend-icon="mdi-badge-account-outline" :subtitle="t('session.roles')">
          <v-list-item-title>{{ session.roles.join(', ') }}</v-list-item-title>
        </v-list-item>
        <v-list-item v-if="obtainedAt" prepend-icon="mdi-clock-check-outline" :subtitle="t('session.obtainedAt')">
          <v-list-item-title>{{ d(obtainedAt, 'dateTime') }}</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-card-text>

    <v-card-actions v-if="session" class="px-4 pb-4">
      <v-btn
        v-if="!compact"
        color="primary"
        variant="tonal"
        prepend-icon="mdi-refresh"
        :loading="busy === 'refresh'"
        :disabled="busy !== null"
        @click="refresh(false)"
      >
        {{ t('session.refresh') }}
      </v-btn>
      <v-spacer v-if="!compact" />
      <v-btn
        v-if="compact"
        variant="tonal"
        prepend-icon="mdi-logout"
        data-testid="session-logout"
        :loading="busy === 'logout'"
        :disabled="busy !== null"
        @click="doLogout"
      >
        {{ t('session.logout') }}
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<style scoped>
.mono {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
}
</style>
