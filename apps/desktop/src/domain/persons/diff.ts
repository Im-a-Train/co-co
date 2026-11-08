/**
 * MiData <-> NDS reconciliation of people (plan 5.2, P1: read only). Pure.
 * Passes: exact key, split-name key (a key must be unique on both sides, else `ambiguous`), then
 * name-only suggestions (`ambiguous`, never auto-accepted). Row keys are `m:<id>` / `n:<id>`, never name data.
 */
import { exactKey, nameOnlyKey, normalizeDate, normalizeName, splitKey, type NameDate } from './match'
import type { MidataPersonRow, NdsPersonRow, PersonDiffRow, PersonKind, PersonMatchState } from './types'

/** Only participants and leaders are expected in NDS; guests, kitchen, coaches etc. are not reconciled. */
export function isNdsRelevant(kind: PersonKind): boolean {
  return kind === 'participant' || kind === 'leader'
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const it of items) {
    const k = key(it)
    if (!k) continue
    const l = m.get(k)
    if (l) l.push(it)
    else m.set(k, [it])
  }
  return m
}

function differences(m: MidataPersonRow, n: NdsPersonRow): string[] {
  const out: string[] = []
  if (normalizeDate(m.birthDate) !== normalizeDate(n.birthDate)) out.push('birthDate')
  if (normalizeName(m.firstName) !== normalizeName(n.firstName) || normalizeName(m.lastName) !== normalizeName(n.lastName))
    out.push('name')
  if ((m.kind === 'participant' || m.kind === 'leader') && m.kind !== n.kind) out.push('kind')
  return out
}

export function diffPersons(midata: MidataPersonRow[], nds: NdsPersonRow[]): PersonDiffRow[] {
  const rows = new Map<MidataPersonRow, PersonDiffRow>()
  const consumed = new Set<NdsPersonRow>()
  const pending = new Set<MidataPersonRow>(midata)

  const mk = (
    m: MidataPersonRow,
    n: NdsPersonRow | null,
    state: PersonMatchState,
    suggestions: NdsPersonRow[],
    diffs: string[],
  ) => rows.set(m, { __red: true, key: `m:${m.id}`, state, midata: m, nds: n, suggestions, differences: diffs })

  // Passes 1 and 2: keyed matches. A key held by several people on either side is ambiguous.
  for (const keyOf of [exactKey as (p: NameDate) => string, splitKey]) {
    const mGroups = groupBy([...pending], keyOf)
    const nGroups = groupBy(
      nds.filter((n) => !consumed.has(n)),
      keyOf,
    )
    for (const [k, ms] of mGroups) {
      const ns = nGroups.get(k)
      if (!ns) continue
      if (ms.length === 1 && ns.length === 1) {
        const m = ms[0]!
        const n = ns[0]!
        const diffs = differences(m, n)
        mk(m, n, diffs.length ? 'field_diff' : 'match', [], diffs)
        consumed.add(n)
        pending.delete(m)
      } else {
        for (const m of ms) {
          mk(m, null, 'ambiguous', ns, [])
          pending.delete(m)
        }
        for (const n of ns) consumed.add(n)
      }
    }
  }

  // Pass 3: name-only suggestions (e.g. birth date typo, swapped day/month).
  const nameGroups = groupBy(
    nds.filter((n) => !consumed.has(n)),
    nameOnlyKey,
  )
  for (const m of [...pending]) {
    const cands = nameGroups.get(nameOnlyKey(m))
    if (cands?.length) {
      mk(m, null, 'ambiguous', cands, [])
      pending.delete(m)
      cands.forEach((c) => consumed.add(c))
    }
  }

  for (const m of pending) mk(m, null, 'missing_in_nds', [], [])

  const out = midata.map((m) => rows.get(m)!)
  for (const n of nds) {
    if (!consumed.has(n))
      out.push({ __red: true, key: `n:${n.id}`, state: 'only_in_nds', midata: null, nds: n, suggestions: [], differences: [] })
  }
  return out
}
