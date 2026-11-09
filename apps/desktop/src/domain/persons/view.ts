/** Table view model of the Personen tab (pure): flattening, effective NDS state, filters, counts. */
import { ageAt, isJsAge } from './age'
import { isNdsRelevant } from './diff'
import { normalizeName } from './match'
import type { MidataPersonRow, NdsPersonRow, PersonDiffRow, PersonKind, PersonMatchState } from './types'

/** NDS state as shown: `notRelevant` for kinds NDS does not hold, `notCompared` until both sides are loaded. */
export type ViewState = PersonMatchState | 'notRelevant' | 'notCompared'

/** NDS role codes (`targetAudienceGroup` / `involvementType`) known to the role mapping (German labels via `roleLabels.ts`, `persons.role.*`). */
export const NDS_ROLE_CODES = ['CHILD', 'ADOLESCENT', 'MAIN_SUPERVISOR', 'SUPERVISOR', 'INSTRUCTOR', 'ASSISTANT_INSTRUCTOR', 'JS_COACH'] as const

/** i18n key suffix for a known NDS role code, or null (caller shows the raw code). */
export function ndsRoleKey(code: string): string | null {
  return (NDS_ROLE_CODES as readonly string[]).includes(code) ? code : null
}

export interface PersonViewRow {
  key: string
  nickname: string | null
  firstName: string
  lastName: string
  kind: PersonKind
  roles: string[]
  /** True when `roles` are raw NDS codes (NDS-only rows) that the UI maps via `ndsRoleKey`. */
  rolesFromNds: boolean
  birthDate: string | null
  age: number | null
  jsAge: boolean
  qualifications: MidataPersonRow['qualifications']
  state: ViewState
  ndsNumber: string | null
  differences: string[]
  suggestions: NdsPersonRow[]
  /** Rega registration of an NDS participant: true = transmitted, false = not, null = unknown / not applicable. */
  rega: boolean | null
  /** Sort / search helper (normalised). */
  search: string
}

export function toViewRows(diff: PersonDiffRow[], campStart: string | null, compared: boolean): PersonViewRow[] {
  return diff.map((d) => {
    const src: MidataPersonRow | NdsPersonRow = (d.midata ?? d.nds)!
    const kind: PersonKind = d.midata ? d.midata.kind : (d.nds?.kind ?? 'other')
    const age = ageAt(src.birthDate, campStart)
    const roles = d.midata ? d.midata.roleLabels : d.nds?.roleLabel ? [d.nds.roleLabel] : []
    let state: ViewState = d.state
    if (!compared) state = 'notCompared'
    else if (d.state === 'missing_in_nds' && !isNdsRelevant(kind)) state = 'notRelevant'
    const nickname = d.midata?.nickname ?? null
    return {
      key: d.key,
      nickname,
      firstName: src.firstName,
      lastName: src.lastName,
      kind,
      roles,
      rolesFromNds: !d.midata && roles.length > 0,
      birthDate: src.birthDate,
      age,
      jsAge: isJsAge(age),
      qualifications: d.midata?.qualifications ?? {},
      state,
      ndsNumber: d.nds?.personNumber ?? null,
      differences: d.differences,
      suggestions: d.suggestions,
      rega: d.nds?.kind === 'participant' ? (d.nds.regaTransmitted ?? null) : null,
      search: normalizeName(`${nickname ?? ''} ${src.firstName} ${src.lastName} ${d.nds?.personNumber ?? ''}`),
    }
  })
}

export interface PersonFilters {
  text: string
  kinds: PersonKind[]
  states: ViewState[]
  jsAge: 'all' | 'yes' | 'no'
  /** 'missing' = only NDS participants not yet transmitted to the Rega. */
  rega?: 'all' | 'missing'
}

export const NO_FILTERS: PersonFilters = { text: '', kinds: [], states: [], jsAge: 'all', rega: 'all' }

export function filterRows(rows: PersonViewRow[], f: PersonFilters): PersonViewRow[] {
  const q = normalizeName(f.text)
  return rows.filter(
    (r) =>
      (!q || r.search.includes(q)) &&
      (!f.kinds?.length || f.kinds.includes(r.kind)) &&
      (!f.states?.length || f.states.includes(r.state)) &&
      (f.jsAge === 'all' || (f.jsAge === 'yes') === r.jsAge) &&
      (f.rega !== 'missing' || r.rega === false),
  )
}

export function countBy<T extends string>(values: T[]): Partial<Record<T, number>> {
  const out: Partial<Record<T, number>> = {}
  for (const v of values) out[v] = (out[v] ?? 0) + 1
  return out
}

export interface PersonsSummary {
  /** Both sides were loaded, so NDS states are meaningful. */
  compared: boolean
  /** Rows per view state (only states that occur). */
  counts: Record<string, number>
  /** field_diff + missing_in_nds + only_in_nds + ambiguous. */
  differences: number
  /** At least one NDS participant carries a Rega state. */
  regaKnown: boolean
  /** NDS participants known to be not transmitted to the Rega. */
  regaMissing: number
}

export function summarizePersons(rows: PersonViewRow[]): PersonsSummary {
  const counts: Record<string, number> = countBy(rows.map((r) => r.state))
  const n = (k: string): number => counts[k] ?? 0
  return {
    compared: rows.length > 0 && n('notCompared') < rows.length,
    counts,
    differences: n('field_diff') + n('missing_in_nds') + n('only_in_nds') + n('ambiguous'),
    regaKnown: rows.some((r) => r.rega !== null),
    regaMissing: rows.filter((r) => r.rega === false).length,
  }
}
