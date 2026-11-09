/**
 * Keyword sets and matcher (catalog v2 §3.5). Pure.
 *
 * Entry syntax (include and exclude):
 *  - `stem`     token contains stem (default)
 *  - `=word`    token equals word, optionally + e/en/n/s/er
 *  - `^stem`    token starts with stem
 *  - `$stem`    token ends with stem (optionally + e/en/n/s/er)
 *  - `a phrase` any entry containing a space (or wrapped in double quotes) is a phrase: substring of the
 *               normalised text with a word boundary at both ends
 *  - `{ regex }` regular expression run on the normalised text
 *
 * Normalisation: lower case, strip «baden-powell», every non-letter/non-digit becomes a space, collapse
 * whitespace, fold umlauts (ä→ae, ö→oe, ü→ue, ß→ss). Entries are folded the same way, so lists are written
 * with umlauts only and match both spellings.
 *
 * Exclusions are applied first: excluded phrase spans are removed from the text, then tokens matching an
 * exclude token entry (stem/^ = token prefix, = exact, $ suffix) are skipped in the include pass.
 */
import type { ActivityFact, ActivityTextField, KeywordEntry, KeywordMatch, KeywordMatcher, KeywordSetDef } from '../../types'

const ENDINGS = ['e', 'en', 'n', 's', 'er']

export function foldUmlauts(text: string): string {
  return text.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
}

/** Normalised, umlaut-folded text: tokens separated by single spaces. */
export function normalizeText(text: string): string {
  return foldUmlauts(
    text
      .toLowerCase()
      .replace(/baden[\s-]*powell/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

type TokenKind = 'stem' | 'exact' | 'prefix' | 'suffix'

interface CompiledToken {
  kind: TokenKind
  value: string
  term: string
}
interface CompiledPhrase {
  re: RegExp
  term: string
}
interface CompiledRegex {
  re: RegExp
}

export interface CompiledSet {
  id: string
  tokens: CompiledToken[]
  phrases: CompiledPhrase[]
  regexes: CompiledRegex[]
  excludeTokens: CompiledToken[]
  excludePhrases: CompiledPhrase[]
  excludeRegexes: CompiledRegex[]
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function phraseRe(normalised: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(normalised)}(?![\\p{L}\\p{N}])`, 'gu')
}

/** Throws on an invalid entry (empty, bad regex). */
function compileEntry(
  entry: KeywordEntry,
  setId: string,
): { token?: CompiledToken; phrase?: CompiledPhrase; regex?: CompiledRegex } {
  if (typeof entry === 'object' && entry !== null && 'regex' in entry) {
    try {
      return { regex: { re: new RegExp(entry.regex, 'g') } }
    } catch (e) {
      throw new Error(`Stichwortliste ${setId}: ungültige Regex «${entry.regex}» (${e instanceof Error ? e.message : e})`)
    }
  }
  if (typeof entry !== 'string' || !entry.trim()) throw new Error(`Stichwortliste ${setId}: leerer Eintrag`)
  let raw = entry.trim()
  if (raw.startsWith('!')) raw = raw.slice(1).trim()
  const quoted = raw.length > 1 && raw.startsWith('"') && raw.endsWith('"')
  if (quoted) raw = raw.slice(1, -1)
  if (quoted || /\s/.test(raw)) {
    const n = normalizeText(raw)
    if (!n) throw new Error(`Stichwortliste ${setId}: leere Phrase «${entry}»`)
    return { phrase: { re: phraseRe(n), term: raw } }
  }
  const marker = raw[0]
  const kind: TokenKind = marker === '=' ? 'exact' : marker === '^' ? 'prefix' : marker === '$' ? 'suffix' : 'stem'
  const word = kind === 'stem' ? raw : raw.slice(1)
  const value = normalizeText(word)
  if (!value) throw new Error(`Stichwortliste ${setId}: leerer Eintrag «${entry}»`)
  // A token entry whose normalisation contains a space (e.g. «3×3») is matched as a phrase.
  if (value.includes(' ')) return { phrase: { re: phraseRe(value), term: word } }
  return { token: { kind, value, term: word } }
}

function tokenMatches(token: string, t: CompiledToken): boolean {
  switch (t.kind) {
    case 'exact':
      return token === t.value || ENDINGS.some((e) => token === t.value + e)
    case 'prefix':
      return token.startsWith(t.value)
    case 'suffix':
      return token.endsWith(t.value) || ENDINGS.some((e) => token.endsWith(t.value + e))
    default:
      return token.includes(t.value)
  }
}

/** Exclusion of a token: stem/prefix entries exclude tokens starting with them (as before). */
function tokenExcluded(token: string, t: CompiledToken): boolean {
  switch (t.kind) {
    case 'exact':
      return token === t.value || ENDINGS.some((e) => token === t.value + e)
    case 'suffix':
      return token.endsWith(t.value)
    default:
      return token.startsWith(t.value)
  }
}

/** Resolves `extends` (recursively, cycle-safe) and compiles a set. */
export function compileKeywordSets(defs: readonly KeywordSetDef[]): Map<string, CompiledSet> {
  const byId = new Map<string, KeywordSetDef>()
  for (const d of defs) {
    if (byId.has(d.id)) throw new Error(`Doppelte Stichwortliste: ${d.id}`)
    byId.set(d.id, d)
  }
  const flat = (id: string, stack: string[]): { include: KeywordEntry[]; exclude: KeywordEntry[] } => {
    const d = byId.get(id)
    if (!d) throw new Error(`Stichwortliste ${stack[stack.length - 1] ?? '?'}: extends «${id}» existiert nicht`)
    if (stack.includes(id)) throw new Error(`Stichwortliste ${id}: zyklisches extends (${[...stack, id].join(' → ')})`)
    const include = [...d.include]
    const exclude = [...(d.exclude ?? [])]
    for (const parent of d.extends ?? []) {
      const p = flat(parent, [...stack, id])
      include.push(...p.include)
      exclude.push(...p.exclude)
    }
    return { include, exclude }
  }
  const out = new Map<string, CompiledSet>()
  for (const d of defs) {
    const { include, exclude } = flat(d.id, [])
    const set: CompiledSet = { id: d.id, tokens: [], phrases: [], regexes: [], excludeTokens: [], excludePhrases: [], excludeRegexes: [] }
    for (const e of include) {
      const c = compileEntry(e, d.id)
      if (c.token) set.tokens.push(c.token)
      if (c.phrase) set.phrases.push(c.phrase)
      if (c.regex) set.regexes.push(c.regex)
    }
    for (const e of exclude) {
      const c = compileEntry(e, d.id)
      if (c.token) set.excludeTokens.push(c.token)
      if (c.phrase) set.excludePhrases.push(c.phrase)
      if (c.regex) set.excludeRegexes.push(c.regex)
    }
    out.set(d.id, set)
  }
  return out
}

/** Matched terms (deduplicated, in entry order of first hit) of one compiled set in `text`. */
export function matchCompiled(set: CompiledSet, text: string): string[] {
  let n = normalizeText(text)
  if (!n) return []
  // Remove excluded phrase / regex spans first.
  for (const p of [...set.excludePhrases, ...set.excludeRegexes]) n = n.replace(new RegExp(p.re.source, p.re.flags), ' ')
  const found = new Set<string>()
  for (const p of set.phrases) if (new RegExp(p.re.source, p.re.flags).test(n)) found.add(p.term)
  for (const r of set.regexes) {
    const m = new RegExp(r.re.source, r.re.flags).exec(n)
    if (m) found.add(m[0].trim())
  }
  if (set.tokens.length) {
    for (const token of n.split(' ')) {
      if (!token) continue
      if (set.excludeTokens.some((x) => tokenExcluded(token, x))) continue
      for (const t of set.tokens) if (tokenMatches(token, t)) found.add(t.term)
    }
  }
  return [...found]
}

export const DEFAULT_ACTIVITY_FIELDS: readonly ActivityTextField[] = ['title', 'location', 'storyboard', 'notes']
export const ALL_ACTIVITY_FIELDS: readonly ActivityTextField[] = ['title', 'location', 'storyboard', 'safety', 'notes']

export function activityField(a: ActivityFact, field: ActivityTextField): string {
  switch (field) {
    case 'title':
      return a.title
    case 'location':
      return a.location ?? ''
    case 'storyboard':
      return a.content.storyboardText
    case 'safety':
      return a.content.safetyText
    case 'notes':
      return a.content.notesText
  }
}

/** Keyword matcher over compiled sets; results of matchActivity are memoised per matcher instance. */
export function createKeywordMatcher(sets: Map<string, CompiledSet>): KeywordMatcher {
  const memo = new Map<string, KeywordMatch[]>()
  const get = (id: string): CompiledSet => {
    const s = sets.get(id)
    if (!s) throw new Error(`Unbekannte Stichwortliste: ${id}`)
    return s
  }
  return {
    has: (id) => sets.has(id),
    match(setId, text) {
      return matchCompiled(get(setId), text).map((term) => ({ term, field: 'text' as const }))
    },
    matchActivity(setId, activity, fields = DEFAULT_ACTIVITY_FIELDS) {
      const key = `${setId}\u0000${activity.iri}\u0000${fields.join(',')}`
      const cached = memo.get(key)
      if (cached) return cached
      const set = get(setId)
      const out: KeywordMatch[] = []
      const seen = new Set<string>()
      for (const field of fields) {
        for (const term of matchCompiled(set, activityField(activity, field))) {
          if (seen.has(term)) continue
          seen.add(term)
          out.push({ term, field })
        }
      }
      memo.set(key, out)
      return out
    },
  }
}

/** Convenience: terms of a set in a text with a one-off compiled set definition (tests, UI helpers). */
export function matchTerms(def: KeywordSetDef, text: string): string[] {
  const sets = compileKeywordSets([def])
  return matchCompiled(sets.get(def.id)!, text)
}
