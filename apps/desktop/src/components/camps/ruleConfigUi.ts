/** UI helpers for rule modules: renders a ModuleReason (i18n key + params) as German text. */
import type { ModuleReason } from '@/domain/types'

type T = (key: string, named?: Record<string, unknown>) => string
type Te = (key: string) => boolean

const monthName = (month: number): string | null =>
  month >= 1 && month <= 12 ? new Intl.DateTimeFormat('de-CH', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2001, month - 1, 1))) : null

/**
 * Translates well-known params (module ids, activity tags, keyword sets, camp config fields/values, month
 * numbers) so the reason templates in `rules.module.reason.*` read naturally. Unknown values stay raw.
 */
export function reasonText(t: T, te: Te, reason: ModuleReason): string {
  const p: Record<string, string | number> = { ...reason.params }
  const tr = (key: string, raw: string): string => (te(key) ? t(key) : raw)
  if (typeof p.module === 'string') p.module = tr(`rules.catalog.module.${p.module}`, p.module)
  if (typeof p.set === 'string') p.set = tr(`campConfig.keywordSet.${p.set}`, p.set)
  if (typeof p.tag === 'string') p.tag = p.tag.split(', ').map((x) => tr(`rules.activityTag.${x}`, x)).join(', ')
  if (typeof p.month === 'number') p.month = monthName(p.month) ?? p.month
  if (typeof p.field === 'string') {
    const field = p.field
    if (typeof p.value === 'string') {
      p.value =
        p.value === 'true' ? t('campConfig.tri.yes') : p.value === 'false' ? t('campConfig.tri.no') : tr(`campConfig.context.${field}.${p.value}`, p.value)
    }
    p.field = tr(`campConfig.fields.${field}`, field)
  }
  return t(reason.key, p)
}

/** Formats a param value for «Parameter angepasst» notes. */
export function paramValueText(v: unknown): string {
  if (Array.isArray(v)) return v.map(paramValueText).join(', ')
  if (v !== null && typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
