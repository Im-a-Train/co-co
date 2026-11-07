/**
 * ICS (RFC 5545) export of deadlines. Pure.
 * - One all-day VEVENT per deadline (DTSTART;VALUE=DATE, DTEND = next day), CRLF line endings,
 *   lines folded at 75 octets, text escaped (backslash, semicolon, comma, newline).
 * - UID stable across exports: `${campId}-${kind}[-${milestoneId}]@co-co` so calendars update instead
 *   of duplicating.
 * - SUMMARY: «<camp title>: <deadline title>», DESCRIPTION incl. source URL, URL property = source URL.
 * - Optional VALARM (DISPLAY) `alarmDaysBefore` days before (default 3; null = no alarm).
 * - Done deadlines are skipped unless includeDone.
 */
import type { Deadline } from '../types'
import { addDays } from './deadlines'

export interface IcsOptions {
  /** Title per deadline (UI passes the translated kind title; milestones use deadline.title). */
  titleOf: (d: Deadline) => string
  now: Date
  includeDone?: boolean
  alarmDaysBefore?: number | null
  calendarName?: string
}

const encoder = new TextEncoder()

/** Escapes a TEXT value (RFC 5545 3.3.11). */
export function escapeIcsText(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/** Folds a content line at 75 octets (never inside a multi-byte character); continuation lines start with a space. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line
  const parts: string[] = []
  let cur = ''
  let curBytes = 0
  let limit = 75
  for (const ch of line) {
    const n = encoder.encode(ch).length
    if (curBytes + n > limit) {
      parts.push(cur)
      cur = ''
      curBytes = 0
      limit = 74 // the leading space of a continuation line counts as one octet
    }
    cur += ch
    curBytes += n
  }
  parts.push(cur)
  return parts.join('\r\n ')
}

const compactDate = (iso: string) => iso.slice(0, 10).replace(/-/g, '')
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** Stable event UID: `${campId}-${kind}[-${milestoneId}]@co-co`. */
export function deadlineUid(d: Deadline): string {
  const campId = (d.campIri.split('/').filter(Boolean).pop() ?? d.campIri).replace(/[^A-Za-z0-9_-]/g, '')
  return `${campId}-${d.kind}${d.milestoneId ? `-${d.milestoneId}` : ''}@co-co`
}

export function toIcs(deadlines: Deadline[], opts: IcsOptions): string {
  const alarm = opts.alarmDaysBefore === undefined ? 3 : opts.alarmDaysBefore
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//co-co//Fristen//DE', 'CALSCALE:GREGORIAN']
  if (opts.calendarName) lines.push(`X-WR-CALNAME:${escapeIcsText(opts.calendarName)}`)
  for (const d of deadlines) {
    if (d.done && !opts.includeDone) continue
    const title = opts.titleOf(d)
    const summary = `${d.campTitle}: ${title}`
    const description = [title, d.source ? `Quelle: ${d.source.title} ${d.source.url}` : ''].filter(Boolean).join('\n')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${deadlineUid(d)}`,
      `DTSTAMP:${stamp(opts.now)}`,
      `DTSTART;VALUE=DATE:${compactDate(d.due)}`,
      `DTEND;VALUE=DATE:${compactDate(addDays(d.due, 1))}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
    )
    if (d.source) lines.push(`URL:${d.source.url}`)
    if (alarm !== null && alarm >= 0) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcsText(summary)}`, `TRIGGER:-P${alarm}D`, 'END:VALARM')
    }
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
