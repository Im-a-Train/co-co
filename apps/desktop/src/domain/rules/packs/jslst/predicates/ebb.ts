/** Module `lst-ebb` (LST-EBB-01…04): ergänzende Bewegungsblöcke. Pure predicates; all texts live in the rule YAMLs. */
import type { ActivityFact, MessageFragment, RuleContext, RuleHit, RulePredicate } from '@/domain/types'
import { ALL_ACTIVITY_FIELDS } from '../../../lib/keywords'
import { activityEvidence } from '../../../lib/util'

type EbbKind = 'A' | 'B'
interface EbbInfo {
  kind: EbbKind
  /** First matching keyword, or the activity title when only the coach tag identifies the EBB. */
  term: string
  tagged: boolean
}

/** EBB classification: coach tags first (`ebb-a`, `ebb-b`, `kein-ebb`), then the EBB_A / EBB_B keyword sets. */
export function ebbOf(ctx: RuleContext, a: ActivityFact): EbbInfo | null {
  const tags = ctx.campConfig.tagsOf(a.iri)
  if (tags.includes('kein-ebb')) return null
  const termOf = (set: string) => ctx.keywords.matchActivity(set, a, ['title', 'location', 'storyboard', 'notes'])[0]?.term
  if (tags.includes('ebb-a')) return { kind: 'A', term: termOf('EBB_A') ?? a.title, tagged: true }
  if (tags.includes('ebb-b')) return { kind: 'B', term: termOf('EBB_B') ?? a.title, tagged: true }
  const a1 = termOf('EBB_A')
  if (a1) return { kind: 'A', term: a1, tagged: false }
  const b1 = termOf('EBB_B')
  if (b1) return { kind: 'B', term: b1, tagged: false }
  return null
}

const frag = (variants: string[]): MessageFragment[] => variants.map((variant) => ({ variant }))

// LST-EBB-01 ---------------------------------------------------------------------------------

const EBB_MARK = /(^|[^\p{L}])ebb([^\p{L}]|$)/iu

/** A provider is named if the title (without the «ebb» mark and the matched EBB terms) has a quoted name or a capitalised word. */
function namesProvider(ctx: RuleContext, title: string): boolean {
  if (ctx.keywords.match('EBB_B_PROVIDER', title).length > 0) return true
  const terms = ctx.keywords.match('EBB_B', title).map((m) => m.term.toLowerCase())
  const words = title.split(/[^\p{L}\p{N}‹›«»"„“']+/u).filter((w) => w.length > 0)
  const rest = words.filter((w) => !/^ebb$/i.test(w) && !terms.some((t) => w.toLowerCase().includes(t)))
  return rest.some((w) => /^\p{Lu}[\p{L}\p{N}-]{2,}$/u.test(w))
}

export const lstEbb01: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const ebb = ebbOf(ctx, a)
    if (!ebb) continue
    if (!EBB_MARK.test(a.title)) {
      hits.push({ targets: [a.iri], params: { activity: a.title, kind: ebb.kind, term: ebb.term }, evidence: [activityEvidence(a)] })
      continue
    }
    const complete = ebb.kind === 'A' ? ctx.keywords.match('EBB_A', a.title).length > 0 : namesProvider(ctx, a.title)
    if (complete) continue
    hits.push({
      targets: [a.iri],
      variant: 'incomplete',
      params: { activity: a.title },
      fragments: { missing: frag([ebb.kind === 'A' ? 'missing_sport' : 'missing_provider']) },
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

// LST-EBB-02 ---------------------------------------------------------------------------------

const B_GROUPS: { set: string; variant: string }[] = [
  { set: 'EBB_INSTR', variant: 'g_instr' },
  { set: 'EBB_BEGLEIT', variant: 'g_begleit' },
  { set: 'EBB_ANBIETER', variant: 'g_anbieter' },
  { set: 'EBB_FAEHIGKEIT', variant: 'g_faehigkeit' },
  { set: 'EBB_WOHL', variant: 'g_wohl' },
]

export const lstEbb02: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const ebb = ebbOf(ctx, a)
    if (!ebb) continue
    const safety = a.content.safetyText
    const base = { targets: [a.iri], params: { activity: a.title }, evidence: [activityEvidence(a)] }
    if (safety.trim() === '') {
      hits.push(base)
      continue
    }
    if (ebb.kind !== 'B') continue
    const missing = B_GROUPS.filter((g) => ctx.keywords.match(g.set, safety).length === 0)
    if (missing.length > 0) hits.push({ ...base, variant: 'groups', fragments: { detail: frag(missing.map((m) => m.variant)) } })
  }
  return hits
}

// LST-EBB-03 ---------------------------------------------------------------------------------

export const lstEbb03: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const ebb = ebbOf(ctx, a)
    if (ebb?.kind !== 'A') continue
    const sport = ctx.keywords.matchActivity('EBB_A', a, ALL_ACTIVITY_FIELDS)[0]?.term ?? ebb.term
    hits.push({ targets: [a.iri], params: { activity: a.title, sport }, evidence: [activityEvidence(a)] })
  }
  return hits
}

// LST-EBB-04 ---------------------------------------------------------------------------------

export const lstEbb04: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const tags = ctx.campConfig.tagsOf(a.iri)
    if (!tags.includes('ebb-a') && !tags.includes('ebb-b')) continue
    if (a.responsibleIris.length > 0) continue
    hits.push({ targets: [a.iri], params: { activity: a.title }, evidence: [activityEvidence(a)] })
  }
  return hits
}

export const predicates: Record<string, RulePredicate> = {
  'LST-EBB-01': lstEbb01,
  'LST-EBB-02': lstEbb02,
  'LST-EBB-03': lstEbb03,
  'LST-EBB-04': lstEbb04,
}
