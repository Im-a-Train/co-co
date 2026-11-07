import { describe, expect, it } from 'vitest'
import { toIcs } from '../ics'
import type { Deadline } from '../../types'

const base: Deadline = {
  campIri: '/api/camps/c1',
  campTitle: 'Sola',
  kind: 'lagerbewilligung',
  due: '2026-12-31',
  done: false,
  ruleId: null,
  source: { title: 'Coach', url: 'https://example.ch/x' },
}
const now = new Date('2026-06-01T10:20:30.456Z')
const opts = { titleOf: (d: Deadline) => d.title ?? 'Frist', now }
const unfold = (s: string) => s.replace(/\r\n /g, '')

describe('toIcs', () => {
  it('uses CRLF everywhere and wraps in VCALENDAR', () => {
    const ics = toIcs([base], opts)
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    expect(ics).toContain('DTSTAMP:20260601T102030Z')
  })
  it('all-day event ends the next day (also across year end)', () => {
    const ics = toIcs([base], opts)
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231')
    expect(ics).toContain('DTEND;VALUE=DATE:20270101')
  })
  it('folds at 75 octets counting umlaut bytes and unfolds losslessly', () => {
    const title = 'Überprüfung für Lagerleiter äöü '.repeat(6).trim()
    const ics = toIcs([{ ...base, title }], opts)
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(ics).toMatch(/\r\n [^\r]/)
    expect(unfold(ics)).toContain(`SUMMARY:Sola: ${title}`)
  })
  it('escapes backslash, semicolon, comma and newline', () => {
    const ics = unfold(toIcs([{ ...base, title: 'a;b,c\\d\ne' }], opts))
    expect(ics).toContain('SUMMARY:Sola: a\\;b\\,c\\\\d\\ne')
  })
  it('has stable UIDs, distinct per milestone', () => {
    const m = { ...base, kind: 'pbs-milestone' as const, milestoneId: 'grobprogramm-coach' }
    const a = toIcs([base, m], opts)
    const b = toIcs([base, m], { ...opts, now: new Date('2027-01-01T00:00:00Z') })
    const uids = (s: string) => s.match(/^UID:.*$/gm)
    expect(uids(a)).toEqual(['UID:c1-lagerbewilligung@co-co', 'UID:c1-pbs-milestone-grobprogramm-coach@co-co'])
    expect(uids(b)).toEqual(uids(a))
  })
  it('VALARM default 3 days, configurable, off with null', () => {
    expect(toIcs([base], opts)).toContain('TRIGGER:-P3D')
    expect(toIcs([base], { ...opts, alarmDaysBefore: 7 })).toContain('TRIGGER:-P7D')
    expect(toIcs([base], { ...opts, alarmDaysBefore: null })).not.toContain('VALARM')
  })
  it('skips done deadlines unless includeDone', () => {
    const done = { ...base, done: true }
    expect(toIcs([done], opts)).not.toContain('BEGIN:VEVENT')
    expect(toIcs([done], { ...opts, includeDone: true })).toContain('BEGIN:VEVENT')
  })
  it('puts the source URL into URL and DESCRIPTION', () => {
    const ics = unfold(toIcs([base], opts))
    expect(ics).toContain('URL:https://example.ch/x')
    expect(ics).toContain('Quelle: Coach https://example.ch/x')
  })
})
