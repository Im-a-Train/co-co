/**
 * In-app updates (ADR 0018). State of the update check, the update dialog and the installation.
 * Network access is Rust-only (`app_update_*` commands). The automatic check runs right at start-up, BEFORE
 * the data store is unlocked (that needs an eCamp login, and a release that breaks the login must still be able
 * to offer its fix). It therefore reads a boot copy of its settings (autoCheck, lastCheckAt, skippedVersion) from
 * localStorage (`UPDATE_PREFS_KEY`, non-secret); every change is written to that copy AND to the encrypted
 * settings, which stay authoritative once unlocked. At most once per 24 h, never blocks the UI. Manual checks
 * always run and show their result (also errors).
 */
import { ref } from 'vue'
import { parseUpdatePrefs, shouldAutoCheck, shouldPromptAuto, type AppUpdateInfo } from '@/domain/update/policy'
import type { UpdateSettings } from '@/domain/types'
import { getAppSettings, updateAppSettings } from '@/domain/storage/settings'
import { commands, errorMessage, isTauri, onAppUpdateProgress } from '@/lib/tauri'

/** Boot copy of the update settings (non-secret; allowlisted in encryptionGuard). */
const UPDATE_PREFS_KEY = 'co-co.update.v1'

function readPrefs(): UpdateSettings {
  try {
    return parseUpdatePrefs(localStorage.getItem(UPDATE_PREFS_KEY))
  } catch {
    return parseUpdatePrefs(null)
  }
}

/** Writes the boot copy, then the encrypted settings (ignored while the store is locked). */
async function savePrefs(patch: Partial<UpdateSettings>): Promise<void> {
  try {
    localStorage.setItem(UPDATE_PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch }))
  } catch {
    // storage blocked: the encrypted settings below still hold the value
  }
  try {
    await updateAppSettings({ update: patch })
  } catch {
    // store locked: the boot copy is enough until the next change
  }
}

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
  await savePrefs({ lastCheckAt: new Date().toISOString() })
}

/** Settings page (store unlocked): the encrypted settings are authoritative; refresh the boot copy from them. */
async function loadSettings(): Promise<void> {
  try {
    const s = (await getAppSettings()).update
    autoCheck.value = s.autoCheck
    localStorage.setItem(UPDATE_PREFS_KEY, JSON.stringify(s))
  } catch {
    autoCheck.value = readPrefs().autoCheck
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
    const settings = readPrefs()
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

/** Call once at app start (main window). Runs the automatic check immediately, independent of the login. */
function startAuto(): void {
  if (autoStarted || !isTauri()) return
  autoStarted = true
  void autoCheckOnce()
}

async function setAutoCheck(on: boolean): Promise<void> {
  autoCheck.value = on
  await savePrefs({ autoCheck: on })
}

function later(): void {
  dialogOpen.value = false
}

async function skipVersion(): Promise<void> {
  const v = info.value?.version
  dialogOpen.value = false
  if (v) await savePrefs({ skippedVersion: v })
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
