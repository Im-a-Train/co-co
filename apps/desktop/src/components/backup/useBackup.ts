/**
 * Backup state shared by Settings > Backup and the export reminder on the rounds page.
 * Module-level refs so every consumer sees the same state.
 */
import { computed, ref } from 'vue'
import {
  BackupError,
  exportAll,
  exportFileName,
  importAll,
  parseExport,
  summarizeExport,
  type ImportMode,
  type ImportReport,
} from '@/domain/backup'
import { exportReminderDue } from '@/domain/rounds'
import { listAllRounds, markAllRoundsExported } from '@/domain/rounds/store'
import { getAppSettings, updateAppSettings } from '@/domain/storage/settings'
import type { CocoExport } from '@/domain/types'
import { commands } from '@/lib/tauri'

export interface PendingImport {
  fileName: string
  data: CocoExport
  counts: Record<string, number>
  unknownTables: string[]
}

const lastExportAt = ref<string | null>(null)
const remindAfterRound = ref(true)
const reminderDue = ref(false)
const busy = ref(false)
/** Error code (`backup.errors.<code>`) or raw message of the last failure. */
const errorCode = ref<string | null>(null)
const errorDetail = ref<string | null>(null)
const pending = ref<PendingImport | null>(null)
const report = ref<ImportReport | null>(null)

function fail(e: unknown): void {
  if (e instanceof BackupError) {
    errorCode.value = e.code
    errorDetail.value = e.detail ?? null
  } else {
    errorCode.value = 'generic'
    errorDetail.value = e instanceof Error ? e.message : String(e)
  }
}

/** Re-reads settings + rounds. Call after closing/starting a round (useRounds does). */
export async function refreshBackupState(): Promise<void> {
  try {
    const s = await getAppSettings()
    lastExportAt.value = s.backup.lastExportAt
    remindAfterRound.value = s.backup.remindAfterRound
    reminderDue.value = exportReminderDue(s.backup, await listAllRounds())
  } catch {
    // no IndexedDB (e.g. plain browser preview): keep defaults
  }
}

async function exportBackup(): Promise<string | null> {
  busy.value = true
  errorCode.value = null
  try {
    const now = new Date()
    const doc = await exportAll(undefined, now)
    const at = now.toISOString()
    // Mark the export inside the file itself so a restore does not remind again immediately.
    const t = doc.tables as Record<string, Record<string, unknown>[]>
    t.rounds = (t.rounds ?? []).map((r) => ({ ...r, exportedAt: r.exportedAt ?? at }))
    t.settings = (t.settings ?? []).map((r) => {
      if (r.key !== 'app') return r
      const v = (r.value ?? {}) as { backup?: Record<string, unknown> }
      return { ...r, value: { ...v, backup: { ...v.backup, lastExportAt: at } } }
    })
    const path = await commands.saveTextFile(exportFileName(now), JSON.stringify(doc, null, 2))
    if (path === null) return null
    await updateAppSettings({ backup: { lastExportAt: at } })
    await markAllRoundsExported(at)
    await refreshBackupState()
    return path
  } catch (e) {
    fail(e)
    return null
  } finally {
    busy.value = false
  }
}

/** Opens a file dialog, validates the file and stores it as `pending` for the in-page confirmation. */
async function chooseImportFile(): Promise<void> {
  busy.value = true
  errorCode.value = null
  report.value = null
  try {
    const file = await commands.openTextFile()
    if (!file) return
    const data = parseExport(file.content)
    pending.value = { fileName: file.name, data, ...summarizeExport(data) }
  } catch (e) {
    pending.value = null
    fail(e)
  } finally {
    busy.value = false
  }
}

async function confirmImport(mode: ImportMode): Promise<boolean> {
  if (!pending.value) return false
  busy.value = true
  errorCode.value = null
  try {
    report.value = await importAll(pending.value.data, mode)
    pending.value = null
    await refreshBackupState()
    return true
  } catch (e) {
    fail(e)
    return false
  } finally {
    busy.value = false
  }
}

function cancelImport(): void {
  pending.value = null
}

async function setRemindAfterRound(value: boolean): Promise<void> {
  await updateAppSettings({ backup: { remindAfterRound: value } })
  await refreshBackupState()
}

export function useBackup() {
  return {
    lastExportAt: computed(() => lastExportAt.value),
    remindAfterRound: computed(() => remindAfterRound.value),
    /** True after a round was started/closed and no backup was exported since. */
    reminderDue: computed(() => reminderDue.value),
    busy: computed(() => busy.value),
    errorCode: computed(() => errorCode.value),
    errorDetail: computed(() => errorDetail.value),
    pending: computed(() => pending.value),
    report: computed(() => report.value),
    refresh: refreshBackupState,
    exportBackup,
    chooseImportFile,
    confirmImport,
    cancelImport,
    setRemindAfterRound,
  }
}
