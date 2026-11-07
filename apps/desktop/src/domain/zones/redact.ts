/**
 * Redaction (pseudonymisation) of yellow text before AI use. Pure.
 * Replaces collaborator names/nicknames with 'Leiter A', 'Leiter B', ... (stable per camp), removes
 * e-mails, Swiss phone numbers, AHV numbers (756.xxxx.xxxx.xx) and street addresses (heuristics).
 * A mapping table (label -> display name) lets results be de-redacted for display on this device.
 */
import type { CollaboratorFact, Zoned } from '../types'

export interface Redaction {
  kind: 'name' | 'email' | 'phone' | 'ahv' | 'address'
  original: string
  replacement: string
  /** index in the ORIGINAL text */
  index: number
}

export interface RedactionResult {
  text: string
  redactions: Redaction[]
}

export interface Redactor {
  redact(text: string): RedactionResult
  /** Redacts a yellow value and marks it `redacted: true`; green passes through; red throws. */
  redactZoned(value: Zoned<string>): Zoned<string> & { redactions: Redaction[] }
  /** Replaces 'Leiter A' etc. in an AI result with the real names (for local display only). */
  deredact(text: string): string
  /** label -> display name */
  mapping(): Record<string, string>
}

const PLACEHOLDER = {
  email: '[E-Mail]',
  phone: '[Telefon]',
  ahv: '[AHV-Nr.]',
  address: '[Adresse]',
} as const

export const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu
export const AHV = /(?<!\d)756[.\s]?\d{4}[.\s]?\d{4}[.\s]?\d{2}(?!\d)/g
export const PHONE =
  /(?<![\d.])(?:(?:\+|00)?41[\s.\-/]*(?:\(0\))?[\s.\-/]*\d{2}(?:[\s.\-/]*\d){7}|0[\s.\-/]*\d{2}(?:[\s.\-/]*\d){7})(?!\d)/g
const STREET_SUFFIX = '(?:strasse|straße|str\\.|weg|gasse|platz|allee|rain|matte|halde|ring|quai|promenade|hof|steig)'
const ADDRESS = new RegExp(
  `(?<![\\p{L}])(?:[\\p{Lu}][\\p{L}.-]*\\s)?[\\p{Lu}][\\p{L}.-]*${STREET_SUFFIX}\\s+\\d{1,4}[a-z]?(?:,?\\s+\\d{4}\\s+[\\p{Lu}][\\p{L}-]+)?`,
  'gu',
)

/** 'Leiter A' ... 'Leiter Z', then 'Leiter 27', ... */
export function leaderLabel(i: number): string {
  return i < 26 ? `Leiter ${String.fromCharCode(65 + i)}` : `Leiter ${i + 1}`
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface Match extends Redaction {
  end: number
}

function collect(re: RegExp, text: string, kind: Redaction['kind'], replacement: string): Match[] {
  const out: Match[] = []
  for (const m of text.matchAll(re)) {
    const index = m.index ?? 0
    out.push({ kind, original: m[0], replacement, index, end: index + m[0].length })
  }
  return out
}

export function buildRedactor(collaborators: CollaboratorFact[]): Redactor {
  const table: Record<string, string> = {}
  const nameToLabel = new Map<string, string>()
  collaborators.forEach((c, i) => {
    const label = leaderLabel(i)
    table[label] = c.displayName
    const variants = new Set<string>()
    for (const v of [
      c.displayName,
      c.nickname,
      c.firstname,
      c.surname,
      c.firstname && c.surname ? `${c.firstname} ${c.surname}` : null,
    ]) {
      const t = v?.trim()
      if (t && t.length >= 2 && t !== '?') variants.add(t)
    }
    for (const v of variants) if (!nameToLabel.has(v.toLowerCase())) nameToLabel.set(v.toLowerCase(), label)
  })
  const names = [...nameToLabel.keys()].sort((a, b) => b.length - a.length)
  const nameRe = names.length
    ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(escapeRe).join('|')})(?:s|es|en|n)?(?![\\p{L}\\p{N}])`, 'giu')
    : null

  function labelFor(matched: string): string {
    const low = matched.toLowerCase()
    const direct = nameToLabel.get(low)
    if (direct) return direct
    for (const suf of ['es', 'en', 'n', 's']) {
      if (low.endsWith(suf)) {
        const l = nameToLabel.get(low.slice(0, -suf.length))
        if (l) return l
      }
    }
    return 'Leiter'
  }

  function redact(text: string): RedactionResult {
    const all: Match[] = [
      ...collect(EMAIL, text, 'email', PLACEHOLDER.email),
      ...collect(AHV, text, 'ahv', PLACEHOLDER.ahv),
      ...collect(PHONE, text, 'phone', PLACEHOLDER.phone),
      ...collect(ADDRESS, text, 'address', PLACEHOLDER.address),
    ]
    if (nameRe) {
      for (const m of text.matchAll(nameRe)) {
        const index = m.index ?? 0
        all.push({
          kind: 'name',
          original: m[0],
          replacement: labelFor(m[0]),
          index,
          end: index + m[0].length,
        })
      }
    }
    all.sort((a, b) => a.index - b.index || b.end - a.end)
    const kept: Match[] = []
    let last = 0
    for (const m of all) {
      if (m.index < last) continue
      kept.push(m)
      last = m.end
    }
    let out = ''
    let pos = 0
    for (const m of kept) {
      out += text.slice(pos, m.index) + m.replacement
      pos = m.end
    }
    out += text.slice(pos)
    return {
      text: out,
      redactions: kept.map(({ kind, original, replacement, index }) => ({ kind, original, replacement, index })),
    }
  }

  return {
    redact,
    redactZoned(value) {
      if (value.zone === 'red') throw new Error('Rote Daten dürfen nie an die KI gesendet werden.')
      if (value.zone === 'green') return { ...value, redactions: [] }
      const r = redact(value.value)
      return { zone: 'yellow', value: r.text, redacted: true, redactions: r.redactions }
    },
    deredact(text) {
      return text.replace(/Leiter ([A-Z]|\d+)/g, (m) => table[m] ?? m)
    },
    mapping: () => ({ ...table }),
  }
}

/** True when text still contains an e-mail, phone or AHV pattern (final guard in the AI gateway). */
export function containsPii(text: string): boolean {
  return [EMAIL, PHONE, AHV].some((re) => new RegExp(re.source, re.flags).test(text))
}
