/**
 * App settings persistence (db.settings key 'app'). Shared by all modules.
 * Sections: `ai` (AI settings), `gpx` (documents), `backup` (rounds/backup), `rulePacks` (rules), `midata` (M7 connection), `nds` (M8 connection).
 * Each feature only writes its own section via updateAppSettings({ <section>: ... }).
 */
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../types'
import { getDb } from './db'

const KEY = 'app'

export function mergeSettings(stored: Partial<AppSettings> | null | undefined): AppSettings {
  const s = stored ?? {}
  return {
    ai: { ...DEFAULT_APP_SETTINGS.ai, ...s.ai },
    gpx: { ...DEFAULT_APP_SETTINGS.gpx, ...s.gpx },
    backup: { ...DEFAULT_APP_SETTINGS.backup, ...s.backup },
    rulePacks: s.rulePacks ?? [...DEFAULT_APP_SETTINGS.rulePacks],
    midata: { ...DEFAULT_APP_SETTINGS.midata, ...s.midata },
    nds: { ...DEFAULT_APP_SETTINGS.nds, ...s.nds },
  }
}

export async function getAppSettings(): Promise<AppSettings> {
  const rec = await getDb().settings.get(KEY)
  return mergeSettings(rec?.value as Partial<AppSettings> | undefined)
}

export type AppSettingsPatch = { [K in keyof AppSettings]?: AppSettings[K] extends unknown[] ? AppSettings[K] : Partial<AppSettings[K]> }

export async function updateAppSettings(patch: AppSettingsPatch): Promise<AppSettings> {
  const db = getDb()
  return db.transaction('rw', db.settings, async () => {
    const current = await getAppSettings()
    const next = mergeSettings({
      ai: { ...current.ai, ...patch.ai },
      gpx: { ...current.gpx, ...patch.gpx },
      backup: { ...current.backup, ...patch.backup },
      rulePacks: patch.rulePacks ?? current.rulePacks,
      midata: { ...current.midata, ...patch.midata },
      nds: { ...current.nds, ...patch.nds },
    })
    await db.settings.put({ key: KEY, value: next })
    return next
  })
}
