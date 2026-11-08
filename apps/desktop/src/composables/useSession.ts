import { computed, ref, shallowRef } from 'vue'
import { asResource, embeddedOne, linkHref, str, type HalResource } from '@/lib/hal'
import { computeRefreshDelayMs, remainingSeconds } from '@/lib/refresh'
import { commands, errorMessage, onSession, type SessionInfo } from '@/lib/tauri'
import { useDataStore } from './useDataStore'
import { useInstances } from './useInstances'
import { useSpikeProtocol } from './useSpikeProtocol'

export interface UserDisplay {
  displayName: string | null
  nickname: string | null
  firstname: string | null
  surname: string | null
  email: string | null
}

const session = shallowRef<SessionInfo | null>(null)
const user = ref<UserDisplay | null>(null)
const userError = ref<string | null>(null)
const userLoading = ref(false)
const busy = ref<null | 'login' | 'password' | 'refresh' | 'logout'>(null)
const lastError = ref<string | null>(null)
const now = ref(Date.now())
const nextRefreshAt = ref<number | null>(null)

let refreshTimer: ReturnType<typeof setTimeout> | null = null
let ticker: ReturnType<typeof setInterval> | null = null
let initialized: Promise<void> | null = null

const isLoggedIn = computed(() => session.value !== null)
const secondsLeft = computed(() => remainingSeconds(session.value?.exp, now.value))
const expired = computed(() => session.value?.exp != null && secondsLeft.value <= 0)

function clearRefreshTimer(): void {
  if (refreshTimer != null) clearTimeout(refreshTimer)
  refreshTimer = null
  nextRefreshAt.value = null
}

function scheduleRefresh(): void {
  clearRefreshTimer()
  const s = session.value
  if (!s || s.exp == null) return
  const delay = computeRefreshDelayMs(s.exp, Date.now())
  nextRefreshAt.value = Date.now() + delay
  refreshTimer = setTimeout(() => {
    void refresh(true)
  }, delay)
}

async function loadUser(): Promise<void> {
  const s = session.value
  user.value = null
  userError.value = null
  if (!s?.userIri) return
  userLoading.value = true
  try {
    const u = asResource(await commands.apiGet<HalResource>(s.userIri))
    let profile = embeddedOne(u, 'profile')
    if (!profile) {
      const href = linkHref(u, 'profile')
      if (href) profile = asResource(await commands.apiGet<HalResource>(href))
    }
    const nickname = str(profile, 'nickname')
    const firstname = str(profile, 'firstname')
    const surname = str(profile, 'surname')
    const fullName = [firstname, surname].filter(Boolean).join(' ') || null
    user.value = {
      displayName: str(u, 'displayName') ?? nickname ?? fullName,
      nickname,
      firstname,
      surname,
      email: str(profile, 'email'),
    }
    // No IRI in the protocol: it ends up in a public report.
    useSpikeProtocol().markResult('apiCallOk', 'ok', 'GET /api/users/[id]')
    useSpikeProtocol().addLog('ui', 'api-get-user', true, profile ? 'GET user + profile' : 'GET user')
  } catch (err) {
    userError.value = errorMessage(err)
    useSpikeProtocol().markResult('apiCallOk', 'failed', userError.value)
    useSpikeProtocol().addLog('ui', 'api-get-user', false, userError.value)
  } finally {
    userLoading.value = false
  }
}

function setSession(next: SessionInfo | null): void {
  const prevUser = session.value?.userIri
  const wasLoggedIn = session.value !== null
  session.value = next
  if (!next) {
    clearRefreshTimer()
    user.value = null
    if (wasLoggedIn) void useDataStore().lock()
    return
  }
  if (!wasLoggedIn) void useDataStore().unlock()
  scheduleRefresh()
  if (next.userIri !== prevUser || !user.value) void loadUser()
  // The login flow discovers the instance on the Rust side only; make sure the UI knows it too
  // (eCamp version, comments flag) even if the user never pressed "Prüfen".
  const instances = useInstances()
  if (!instances.infos[next.baseUrl]) void instances.discover(next.baseUrl)
}

function handleSessionEvent(next: SessionInfo): void {
  const spike = useSpikeProtocol()
  const names = next.cookieNames
  const hasHp = names.some((n) => n.endsWith('jwt_hp'))
  const hasS = names.some((n) => n.endsWith('jwt_s'))
  spike.addLog('ui', 'session-received', true, `${next.method}: ${names.join(', ')}`)
  spike.markResult('cookiesFound', hasHp && hasS ? 'ok' : 'failed', names.join(', ') || null)
  busy.value = null
  setSession(next)
}

function init(): Promise<void> {
  initialized ??= (async () => {
    ticker ??= setInterval(() => {
      now.value = Date.now()
    }, 1000)
    await useSpikeProtocol().startListening()
    await onSession(handleSessionEvent)
    try {
      const existing = await commands.sessionStatus()
      if (existing) setSession(existing)
    } catch {
      /* not in Tauri or backend not ready: stay logged out */
    }
  })()
  return initialized
}

async function openLoginWindow(baseUrl: string): Promise<void> {
  const spike = useSpikeProtocol()
  lastError.value = null
  busy.value = 'login'
  try {
    await commands.openLoginWindow(baseUrl)
    spike.addLog('ui', 'open-login-window', true, `${baseUrl}/login`)
    spike.markResult('loginWindowOpened', 'ok', `${baseUrl}/login`)
  } catch (err) {
    lastError.value = errorMessage(err)
    spike.addLog('ui', 'open-login-window', false, lastError.value)
    spike.markResult('loginWindowOpened', 'failed', lastError.value)
  } finally {
    // The session arrives asynchronously via 'auth://session'.
    if (busy.value === 'login') busy.value = null
  }
}

async function passwordLogin(baseUrl: string, identifier: string, password: string): Promise<boolean> {
  const spike = useSpikeProtocol()
  lastError.value = null
  busy.value = 'password'
  try {
    const s = await commands.passwordLogin(baseUrl, identifier, password)
    spike.addLog('ui', 'password-login', true, s.cookieNames.join(', '))
    spike.markResult('cookiesFound', 'ok', s.cookieNames.join(', '))
    setSession(s)
    return true
  } catch (err) {
    lastError.value = errorMessage(err)
    spike.addLog('ui', 'password-login', false, lastError.value)
    return false
  } finally {
    busy.value = null
  }
}

async function refresh(automatic = false): Promise<boolean> {
  const spike = useSpikeProtocol()
  const step = automatic ? 'auto-refresh' : 'manual-refresh'
  if (!session.value) return false
  lastError.value = null
  busy.value = 'refresh'
  try {
    const s = await commands.refreshSession()
    spike.addLog('ui', step, true, s.exp ? `exp ${new Date(s.exp * 1000).toISOString()}` : null)
    spike.markResult('refreshOk', 'ok', step)
    setSession(s)
    return true
  } catch (err) {
    lastError.value = errorMessage(err)
    spike.addLog('ui', step, false, lastError.value)
    spike.markResult('refreshOk', 'failed', lastError.value)
    // Retry later while the token is still valid; scheduleRefresh clamps to >= 2 min.
    if (session.value && !expired.value) scheduleRefresh()
    return false
  } finally {
    busy.value = null
  }
}

async function logout(): Promise<void> {
  const spike = useSpikeProtocol()
  busy.value = 'logout'
  try {
    await commands.logout()
    spike.addLog('ui', 'logout', true)
  } catch (err) {
    lastError.value = errorMessage(err)
    spike.addLog('ui', 'logout', false, lastError.value)
  } finally {
    setSession(null)
    busy.value = null
  }
}

export function useSession() {
  return {
    session,
    user,
    userError,
    userLoading,
    busy,
    lastError,
    now,
    nextRefreshAt,
    isLoggedIn,
    secondsLeft,
    expired,
    init,
    loadUser,
    openLoginWindow,
    passwordLogin,
    refresh,
    logout,
  }
}
