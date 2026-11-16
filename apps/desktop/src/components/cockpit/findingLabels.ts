/** Small label helpers for finding rows (target subtitle, group title). Pure; `t` is vue-i18n's translate. */
import { formatDateShort } from '@/domain/cockpit'
import { formatDateList } from '@/domain/selfCheck'
import type { FindingTarget } from '@/domain/triage'
import type { IsoDate } from '@/domain/types'

type Translate = (key: string, named?: Record<string, unknown>) => string

const WEEKDAY = new Intl.DateTimeFormat('de-CH', { weekday: 'short', timeZone: 'UTC' })

/** `2031-01-29` -> `Mi 29.01.` (camp-local calendar date, never converted). */
export function weekdayDate(date: IsoDate): string {
  const wd = WEEKDAY.format(new Date(`${date}T00:00:00Z`)).replace(/\.$/, '')
  return `${wd} ${formatDateShort(date)}`
}

/** Row subtitle: «Mi 29.01.», «1.1 Skifahren auf dem Berg», «Lager». */
export function targetLabel(t: Translate, target: FindingTarget): string {
  switch (target.kind) {
    case 'day':
      return weekdayDate(target.date)
    case 'activity':
      return target.number
        ? t('findings.triage.target.activity', { number: target.number, title: target.title })
        : t('findings.triage.target.activityNoNumber', { title: target.title })
    case 'document':
      return t('findings.triage.target.document')
    default:
      return t('findings.triage.target.camp')
  }
}

/** `24.–30.01.2031` -> `24.–30.01.` when every date is in one year (the year is clutter in a row title). */
export function compactDateList(dates: readonly IsoDate[]): string {
  const list = formatDateList(dates)
  const years = new Set(dates.map((d) => d.slice(0, 4)))
  return years.size === 1 ? list.replace(/\.\d{4}$/, '.') : list
}

/** «Fixpunkte (Mahlzeiten) fehlen · 7 Tage (24.–30.01.)». A date range never breaks after its dash (word joiner). */
export function groupLabel(t: Translate, title: string, count: number, dates: readonly IsoDate[]): string {
  const list = compactDateList(dates).replace(/–/g, '–\u2060')
  return list
    ? t('findings.group.label', { title, count, dates: list })
    : t('findings.group.labelNoDates', { title, count })
}
