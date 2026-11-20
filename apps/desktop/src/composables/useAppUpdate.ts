/**
 * In-app updates (ADR 0017). State of the update check, the update dialog and the installation.
 * Network access is Rust-only (`app_update_*` commands). The automatic check waits for the unlocked data
 * store because its settings (autoCheck, lastCheckAt, skippedVersion) live there; it runs at most once per 24 h
 * and never blocks the UI. Manual checks always run and show their result (also errors).
 */
import { ref, watch } from 'vue'
import { shouldAutoCheck, shouldPromptAuto, type AppUpdateInfo } from '@/domain/update/policy'
import { getAppSettings, updateAppSettings } from '@/domain/storage/settings'
import { commands, errorMessage, isTauri, onAppUpdateProgress } from '@/lib/tauri'
import { useDataStore } from './useDataStore'

const info = ref<AppUpdateInfo | null>(null)
const dialogOpen = ref(false)
const checking = ref(false)
const installing = ref(false)
/** Result text of the last manual check (shown in Settings > Updates). */
const manualResult = ref<{ kind: 'upToDate' | 'available' | 'error'; text?: string } | null>(null)
const installError = ref<string | null>(null)
const progress = ref<{ downloaded: number; total: number | null } | null>(null)
const autoCheck = ref(true)
let autoStarted = false

async function stamp(): Promise<void> {
  try {
    await updateAppSettings({ update: { lastCheckAt: new Date().toISOString() } })
  } catch {
    // Store locked or unavailable: the check result is still valid, we only lose the 24 h throttle.
  }
}

async function loadSettings(): Promise<void> {
  try {
    autoCheck.value = (await getAppSettings()).update.autoCheck
  } catch {
    // keep default
  }
}

/** Manual check: always runs, reports every outcome, opens the dialog when an update exists. */
async function checkNow(): Promise<void> {
  if (checking.value || !isTauri()) return
  checking.value = true
  manualResult.value = null
  try {
    const r = await commands.appUpdateCheck()
    info.value = r
    await stamp()
    if (r.available) {
      manualResult.value = { kind: 'available' }
      installError.value = null
      dialogOpen.value = true
    } else {
      manualResult.value = { kind: 'upToDate' }
    }
  } catch (e) {
    manualResult.value = { kind: 'error', text: errorMessage(e) }
  } finally {
    checking.value = false
  }
}

async function autoCheckOnce(): Promise<void> {
  try {
    const settings = (await getAppSettings()).update
    autoCheck.value = settings.autoCheck
    const allowed = await commands.appUpdateAutoCheckAllowed()
    if (!shouldAutoCheck(settings, allowed, new Date())) return
    const r = await commands.appUpdateCheck()
    await stamp()
    info.value = r
    if (shouldPromptAuto(r, settings.skippedVersion)) {
      installError.value = null
      dialogOpen.value = true
    }
  } catch {
    // Offline / GitHub down: silently ignore, the next start tries again.
  }
}

/** Call once at app start (main window). Runs the automatic check as soon as the data store is ready. */
function startAuto(): void {
  if (autoStarted || !isTauri()) return
  autoStarted = true
  const store = useDataStore()
  const go = (): void => void autoCheckOnce()
  if (store.state.value === 'ready') {
    go()
    return
  }
  const stop = watch(
    store.state,
    (s) => {
      if (s === 'ready') {
        stop()
        go()
      }
    },
    { flush: 'post' },
  )
}

async function setAutoCheck(on: boolean): Promise<void> {
  autoCheck.value = on
  await updateAppSettings({ update: { autoCheck: on } })
}

function later(): void {
  dialogOpen.value = false
}

async function skipVersion(): Promise<void> {
  const v = info.value?.version
  dialogOpen.value = false
  if (v) await updateAppSettings({ update: { skippedVersion: v } })
}

async function install(): Promise<void> {
  if (installing.value) return
  installing.value = true
  installError.value = null
  progress.value = { downloaded: 0, total: null }
  let unlisten: (() => void) | null = null
  try {
    unlisten = await onAppUpdateProgress((p) => {
      progress.value = p
    })
    await commands.appUpdateInstall()
    // On success the app restarts; nothing else to do.
  } catch (e) {
    installError.value = errorMessage(e)
    installing.value = false
  } finally {
    unlisten?.()
  }
}

async function openRelease(): Promise<void> {
  try {
    await commands.appUpdateOpenRelease(info.value?.version ?? null)
  } catch (e) {
    installError.value = errorMessage(e)
  }
}

export function useAppUpdate() {
  return {
    info,
    dialogOpen,
    checking,
    installing,
    progress,
    manualResult,
    installError,
    autoCheck,
    loadSettings,
    checkNow,
    startAuto,
    setAutoCheck,
    later,
    skipVersion,
    install,
    openRelease,
  }
}
