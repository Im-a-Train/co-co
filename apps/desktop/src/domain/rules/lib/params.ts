/**
 * Pack params (catalog v2 §3.4). Pure.
 *
 * Each key has value rows by camp start date. Rows must cover the time line from the first row without
 * gaps or overlaps; the last row is open-ended. Resolution order for a camp:
 *   1. campConfig.params[key]      (only if overridable: coach)
 *   2. settings.ruleParams[key]    (if overridable: admin or coach)
 *   3. the row whose validity contains the camp start date.
 */
import type { IsoDate, ParamDef, ParamOverridable, ParamReader, ParamRow, ParamValue, SourceRef } from '../../types'
import { addDays } from './deadlines'
import { parseSourceRefs } from './sources'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const OVERRIDABLE: ParamOverridable[] = ['none', 'admin', 'coach']
const KEY_RE = /^[a-z]+\.[A-Za-z0-9]+$/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function dateString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

/** YAML dates inside values become ISO strings (values are plain JSON). */
function plainValue(v: unknown): ParamValue {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (Array.isArray(v)) return v.map(plainValue)
  if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plainValue(x)]))
  if (v === undefined) return null
  return v as ParamValue
}

/** Parses one params.yaml document (a list). Throws with all errors joined. */
export function parseParamDefs(raw: unknown, where: string): ParamDef[] {
  if (!Array.isArray(raw)) throw new Error(`${where}: Liste von Parametern erwartet`)
  const errors: string[] = []
  const defs: ParamDef[] = []
  for (const r of raw) {
    if (!isRecord(r)) {
      errors.push(`${where}: Eintrag ist kein Objekt`)
      continue
    }
    const key = String(r.key ?? '')
    const err = (m: string) => errors.push(`${where} ${key || '?'}: ${m}`)
    if (!KEY_RE.test(key)) err('key ungültig (erwartet z. B. js.minDayMinutes)')
    if (typeof r.label !== 'string' || !r.label.trim()) err('label fehlt')
    const overridable = (r.overridable ?? 'none') as ParamOverridable
    if (!OVERRIDABLE.includes(overridable)) err('overridable ungültig (none | admin | coach)')
    if (!Array.isArray(r.values) || r.values.length === 0) {
      err('values fehlt')
      continue
    }
    const values: ParamRow[] = []
    for (const row of r.values) {
      if (!isRecord(row) || !('value' in row)) {
        err('Zeile ohne value')
        continue
      }
      const validFrom = dateString(row.validFrom)
      const validTo = dateString(row.validTo)
      if (!validFrom || !DATE_RE.test(validFrom)) err('Zeile ohne gültiges validFrom')
      if (validTo !== undefined && !DATE_RE.test(validTo)) err('validTo ist kein Datum')
      values.push({ value: plainValue(row.value), validFrom: validFrom ?? '', ...(validTo ? { validTo } : {}) })
    }
    errors.push(...validateRows(values).map((m) => `${where} ${key}: ${m}`))
    let sources: SourceRef[] = []
    try {
      sources = parseSourceRefs(r.sources, `${where} ${key}`)
    } catch (e) {
      err(e instanceof Error ? e.message : String(e))
    }
    defs.push({
      key,
      label: String(r.label ?? ''),
      ...(typeof r.description === 'string' ? { description: r.description } : {}),
      unit: String(r.unit ?? ''),
      values,
      sources,
      overridable,
    })
  }
  if (errors.length) throw new Error(errors.join('; '))
  return defs
}

/** Rows sorted, contiguous (next.validFrom = prev.validTo + 1), last row open-ended. */
export function validateRows(rows: ParamRow[]): string[] {
  const errors: string[] = []
  const sorted = [...rows].sort((a, b) => (a.validFrom < b.validFrom ? -1 : 1))
  sorted.forEach((row, i) => {
    const last = i === sorted.length - 1
    if (last && row.validTo) errors.push(`letzte Zeile darf kein validTo haben (offen)`)
    if (!last) {
      if (!row.validTo) errors.push(`Zeile ab ${row.validFrom} braucht validTo`)
      else if (addDays(row.validTo, 1) !== sorted[i + 1].validFrom) {
        errors.push(`Lücke oder Überlappung zwischen ${row.validTo} und ${sorted[i + 1].validFrom}`)
      }
    }
    if (row.validTo && row.validTo < row.validFrom) errors.push(`validTo ${row.validTo} vor validFrom ${row.validFrom}`)
  })
  return errors
}

/** Row value for a date; undefined when no row covers it. */
export function rowValue(def: ParamDef, date: IsoDate): { value: ParamValue } | undefined {
  const d = date.slice(0, 10)
  const row = def.values.find((r) => r.validFrom <= d && (!r.validTo || d <= r.validTo))
  return row ? { value: row.value } : undefined
}

export interface ParamReaderInput {
  defs: readonly ParamDef[]
  /** Camp start (fallback: evaluation day). */
  date: IsoDate
  /** settings.ruleParams */
  adminParams?: Record<string, ParamValue> | null
  /** campConfig.params */
  campParams?: Record<string, ParamValue> | null
}

const same = (a: ParamValue, b: ParamValue) => JSON.stringify(a) === JSON.stringify(b)

export function createParamReader({ defs, date, adminParams, campParams }: ParamReaderInput): ParamReader {
  const byKey = new Map<string, ParamDef>()
  for (const d of defs) {
    if (byKey.has(d.key)) throw new Error(`Doppelter Parameter: ${d.key}`)
    byKey.set(d.key, d)
  }
  const resolve = (key: string): { value: ParamValue; default: ParamValue; overridden: boolean } => {
    const def = byKey.get(key)
    if (!def) throw new Error(`Unbekannter Parameter: ${key}`)
    const row = rowValue(def, date)
    if (!row) throw new Error(`Parameter ${key}: kein Wert für ${date}`)
    if (def.overridable === 'coach' && campParams && key in campParams) {
      return { value: campParams[key], default: row.value, overridden: !same(campParams[key], row.value) }
    }
    if (def.overridable !== 'none' && adminParams && key in adminParams) {
      return { value: adminParams[key], default: row.value, overridden: !same(adminParams[key], row.value) }
    }
    return { value: row.value, default: row.value, overridden: false }
  }
  return {
    get<T = ParamValue>(key: string): T {
      return resolve(key).value as T
    },
    isOverridden(key) {
      const r = resolve(key)
      return r.overridden ? { value: r.value, default: r.default } : null
    },
    def: (key) => byKey.get(key),
  }
}

/** Minutes since midnight of an «HH:MM» param value («24:00» = 1440). */
export function hhmmToMinutes(v: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim())
  if (!m) throw new Error(`Ungültige Uhrzeit «${v}»`)
  return Number(m[1]) * 60 + Number(m[2])
}
