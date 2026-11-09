/**
 * App settings persistence (db.settings key 'app'). Shared by all modules.
 * Sections: `ai` (AI settings incl. provider, ADR 0012), `gpx` (documents), `backup` (rounds/backup), `rulePacks` (rules),
 * `midata` (M7 connection), `nds` (M8 connection), `mcp` (local MCP server, ADR 0012).
 * Each feature only writes its own section via updateAppSettings({ <section>: ... }).
 * Nested objects (`ai.openai`, `mcp.tools`) are merged with their defaults on read; a patch replaces them as a whole
 * (pass `{ ...current.ai.openai, baseUrl }` / `{ ...current.mcp.tools, [name]: on }`).
 */
import { DEFAULT_APP_SETTINGS, type AppSettings, type ParamValue } from '../types'
import { getDb } from './db'

const KEY = 'app'

export function mergeSettings(stored: AppSettingsPatch | null | undefined): AppSettings {
  const s = stored ?? {}
  return {
    ai: {
      ...DEFAULT_APP_SETTINGS.ai,
      ...s.ai,
      openai: { ...DEFAULT_APP_SETTINGS.ai.openai, ...s.ai?.openai },
    },
    gpx: { ...DEFAULT_APP_SETTINGS.gpx, ...s.gpx },
    backup: { ...DEFAULT_APP_SETTINGS.backup, ...s.backup },
    rulePacks: s.rulePacks ?? [...DEFAULT_APP_SETTINGS.rulePacks],
    ...(s.ruleParams && Object.keys(s.ruleParams).length ? { ruleParams: { ...s.ruleParams } as Record<string, ParamValue> } : {}),
    midata: { ...DEFAULT_APP_SETTINGS.midata, ...s.midata },
    nds: { ...DEFAULT_APP_SETTINGS.nds, ...s.nds },
    mcp: {
      ...DEFAULT_APP_SETTINGS.mcp,
      ...s.mcp,
      tools: { ...DEFAULT_APP_SETTINGS.mcp.tools, ...s.mcp?.tools },
    },
  }
}

export async function getAppSettings(): Promise<AppSettings> {
  const rec = await getDb().settings.get(KEY)
  return mergeSettings(rec?.value as AppSettingsPatch | undefined)
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
      ruleParams: patch.ruleParams ?? current.ruleParams,
      midata: { ...current.midata, ...patch.midata },
      nds: { ...current.nds, ...patch.nds },
      mcp: { ...current.mcp, ...patch.mcp },
    })
    await db.settings.put({ key: KEY, value: next })
    return next
  })
}
