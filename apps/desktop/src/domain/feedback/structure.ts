/**
 * Feedback structure: "Allgemein" first, then one group per camp day, each with its activities
 * (ordered by their first schedule entry). Pure.
 */
import type { CampFacts, DocumentRecord, FeedbackItem, Iri, IsoDate } from '../types'
import { orderItems } from './order'
import { tr } from './i18n'

export interface FeedbackActivityGroup {
  activityIri: Iri
  title: string
  number: string | null
  items: FeedbackItem[]
}

export interface FeedbackDayGroup {
  /** null = activities without schedule entry ("Ohne Termin"). */
  dayIri: Iri | null
  dayNumber: number | null
  date: IsoDate | null
  label: string
  activities: FeedbackActivityGroup[]
}

export interface FeedbackStructure {
  general: FeedbackItem[]
  days: FeedbackDayGroup[]
}

/** "Tag 2 · Mo 14.07." from a camp-local date (UTC getters, no timezone conversion). */
export function dayLabel(dayNumber: number | null, date: IsoDate | null): string {
  if (date === null) return tr('feedback.structure.noDate')
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return tr('feedback.structure.noDate')
  const wd = tr('feedback.structure.weekdays').split(',')[d.getUTCDay()] ?? ''
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const tail = `${wd} ${dd}.${mm}.`
  return dayNumber !== null ? tr('feedback.structure.day', { n: dayNumber, date: tail }) : tail
}

type DocLike = Pick<DocumentRecord, 'id' | 'name' | 'activityIris'>

export function groupFeedback(
  items: FeedbackItem[],
  facts: CampFacts | null,
  documents: DocLike[] = [],
): FeedbackStructure {
  const general: FeedbackItem[] = []
  const byActivity = new Map<Iri, FeedbackItem[]>()
  const docById = new Map(documents.map((d) => [d.id, d]))

  for (const item of orderItems(items)) {
    let activityIri: Iri | undefined
    if (item.scope === 'activity' && item.activityIri) activityIri = item.activityIri
    else if (item.documentId) activityIri = docById.get(item.documentId)?.activityIris[0]
    if (!activityIri) {
      general.push(item)
      continue
    }
    const list = byActivity.get(activityIri) ?? []
    list.push(item)
    byActivity.set(activityIri, list)
  }

  const days = [...(facts?.days ?? [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const dayGroups = new Map<Iri, { start: string; group: FeedbackActivityGroup }[]>()
  const loose: FeedbackActivityGroup[] = []

  for (const [activityIri, list] of byActivity) {
    const act = facts?.activities.find((a) => a.iri === activityIri)
    const entries = (facts?.scheduleEntries ?? [])
      .filter((e) => e.activityIri === activityIri)
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
    const first = entries[0]
    const group: FeedbackActivityGroup = {
      activityIri,
      title: act?.title ?? activityIri,
      number: first?.number ?? null,
      items: list,
    }
    const day = first
      ? (days.find((d) => d.iri === first.dayIri) ?? days.find((d) => d.date === first.start.slice(0, 10)))
      : undefined
    if (!first || !day) {
      loose.push(group)
      continue
    }
    const arr = dayGroups.get(day.iri) ?? []
    arr.push({ start: first.start, group })
    dayGroups.set(day.iri, arr)
  }

  const out: FeedbackDayGroup[] = []
  for (const day of days) {
    const arr = dayGroups.get(day.iri)
    if (!arr) continue
    arr.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
    out.push({
      dayIri: day.iri,
      dayNumber: day.number,
      date: day.date,
      label: dayLabel(day.number, day.date),
      activities: arr.map((x) => x.group),
    })
  }
  if (loose.length > 0) {
    out.push({ dayIri: null, dayNumber: null, date: null, label: dayLabel(null, null), activities: loose })
  }
  return { general, days: out }
}
