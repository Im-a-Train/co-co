/**
 * Name / birth-date normalisation and match keys (port of the impex logic, plan section 1). Pure.
 * RED ZONE: the keys contain personal data; never log, persist or send them anywhere.
 */

const DASHES = /[‐‑‒–—−]/g

/** trim, lowercase, collapse spaces, ä→ae ö→oe ü→ue ß→ss, strip diacritics, unify dashes. */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .trim()
    .toLowerCase()
    .replace(DASHES, '-')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Splits a normalised name on space, hyphen, slash, dot, comma, apostrophe; drops empty tokens. */
export function nameTokens(raw: string | null | undefined): string[] {
  return normalizeName(raw)
    .split(/[\s\-/.,'`’]+/)
    .filter(Boolean)
}

/** `dd.mm.yyyy` / `yyyy-mm-dd` (separators `.` `-` `/`) -> `yyyymmdd`; '' when unreadable or impossible. */
export function normalizeDate(raw: string | null | undefined): string {
  if (!raw) return ''
  const s = raw.trim()
  let y: string
  let m: string
  let d: string
  const iso = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:$|[T\s])/.exec(s)
  if (iso) {
    y = iso[1]!
    m = iso[2]!
    d = iso[3]!
  } else {
    const de = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s)
    if (!de) return ''
    d = de[1]!
    m = de[2]!
    y = de[3]!
  }
  const mi = Number(m)
  const di = Number(d)
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return ''
  return `${y}${String(mi).padStart(2, '0')}${String(di).padStart(2, '0')}`
}

export interface NameDate {
  firstName: string
  lastName: string
  birthDate: string | null
}

/** Exact key `lastName|firstName|birthDate`; '' when the birth date is missing. */
export function exactKey(p: NameDate): string {
  const d = normalizeDate(p.birthDate)
  if (!d) return ''
  return `${normalizeName(p.lastName)}|${normalizeName(p.firstName)}|${d}`
}

/** Split-name key: names split into tokens and re-joined (double names, punctuation); '' without birth date. */
export function splitKey(p: NameDate): string {
  const d = normalizeDate(p.birthDate)
  if (!d) return ''
  return `${nameTokens(p.lastName).join(' ')}|${nameTokens(p.firstName).join(' ')}|${d}`
}

/** Name-only key (split tokens, no date). Suggestions only, never auto-accepted. */
export function nameOnlyKey(p: NameDate): string {
  return `${nameTokens(p.lastName).join(' ')}|${nameTokens(p.firstName).join(' ')}`
}
