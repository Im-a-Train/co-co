/** Module `lst-wasser` (Baden, Schwimmen, Boote, Flösse, Wasseraufsicht). Pure predicates; texts live in the rule YAMLs. */
import { jsOnly } from '../../../lib/gate'
import type { ActivityFact, ActivityTag, MessageFragment, MidataQualKeyV2, RuleContext, RuleHit, RulePredicate } from '@/domain/types'
import { ALL_ACTIVITY_FIELDS } from '../../../lib/keywords'
import { distinctLeadersWithKey } from '../../../lib/midataKeys'
import { activityEvidence, formatStand, midataEvidence } from '../../../lib/util'

/** Matched terms of a keyword set in the activity's text fields (title, location, storyboard, notes). */
const termsIn = (ctx: RuleContext, a: ActivityFact, set: string): string[] => ctx.keywords.matchActivity(set, a).map((m) => m.term)

/** Matched terms in all text fields including safety text and material list. */
function termsAll(ctx: RuleContext, a: ActivityFact, set: string): string[] {
  const terms = ctx.keywords.matchActivity(set, a, ALL_ACTIVITY_FIELDS).map((m) => m.term)
  for (const m of ctx.keywords.match(set, a.content.materialText)) terms.push(m.term)
  return terms
}

const ev = (a: ActivityFact, found: string[]) => [activityEvidence(a, found.slice(0, 3).join(', '))]

/** Water keyword hit that is not a supervised bath (WATER and not POOL). */
const openWater = (ctx: RuleContext, a: ActivityFact): string[] => (termsIn(ctx, a, 'POOL').length > 0 ? [] : termsIn(ctx, a, 'WATER'))

// LST-WASSER-01 ------------------------------------------------------------------------------

export const lstWasser01: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const found = termsIn(ctx, a, 'WATER')
    if (found.length === 0) continue
    const missing: MessageFragment[] = []
    if (a.responsibleIris.length === 0) missing.push({ variant: 'noResponsible' })
    if (a.content.safetyText.trim() === '') missing.push({ variant: 'noSafety' })
    if (missing.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      fragments: { missing },
      inputs: { matchedKeyword: found[0], responsiblesCount: a.responsibleIris.length, safetyTextChars: a.content.safetyText.trim().length },
      evidence: ev(a, found),
    })
  }
  return hits
}

// LST-WASSER-02 ------------------------------------------------------------------------------

export const lstWasser02: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const found = [...termsIn(ctx, a, 'CLOSED_BOAT'), ...termsIn(ctx, a, 'DIVING')]
    if (found.length === 0) continue
    const ebbA = ctx.campConfig.tagsOf(a.iri).includes('ebb-a')
    hits.push({
      targets: [a.iri],
      params: { activity: a.title, term: found[0] },
      ...(ebbA ? { variant: 'ebbA', severity: 'hint' as const } : {}),
      inputs: { matchedKeyword: found[0], taggedEbbA: ebbA },
      evidence: ev(a, found),
    })
  }
  return hits
}

// LST-WASSER-03 ------------------------------------------------------------------------------

export const lstWasser03: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const found = termsIn(ctx, a, 'FLOSS')
    if (found.length === 0 || termsAll(ctx, a, 'FLOSS_OK').length > 0) continue
    hits.push({ targets: [a.iri], params: { activity: a.title }, inputs: { matchedKeyword: found[0] }, evidence: ev(a, found) })
  }
  return hits
}

// LST-WASSER-04 ------------------------------------------------------------------------------

type Setting = 'bad' | 'pool' | 'see' | 'fluss'
const SETTING_RANK: Record<Setting, number> = { bad: 0, pool: 1, see: 2, fluss: 3 }
const REQUIRED_KEY: Record<Setting, MidataQualKeyV2> = {
  bad: 'waterBath',
  pool: 'waterPoolUnsupervised',
  see: 'waterLake',
  fluss: 'waterRiver',
}
const TAG_SETTING: Partial<Record<ActivityTag, Setting>> = {
  'wasser-bad-beaufsichtigt': 'bad',
  'wasser-pool': 'pool',
  'wasser-see': 'see',
  'wasser-fluss': 'fluss',
}

const strictest = (settings: Setting[]): Setting | null =>
  settings.length === 0 ? null : settings.reduce((best, s) => (SETTING_RANK[s] > SETTING_RANK[best] ? s : best))

/** Setting from tags first, otherwise from keywords (strictest wins; supervised baths win over LAKE/RIVER via the keyword sets). */
function settingOf(ctx: RuleContext, a: ActivityFact): { setting: Setting; term: string } | null {
  const fromTags = strictest(ctx.campConfig.tagsOf(a.iri).flatMap((t) => TAG_SETTING[t] ?? []))
  if (fromTags) return { setting: fromTags, term: '' }
  // Only IM/AUF dem Wasser: texts that only name «am Wasser» activities (Füsse baden, Wasserrad) are skipped.
  const swim = termsIn(ctx, a, 'SWIM')
  const boat = termsIn(ctx, a, 'BOAT')
  const diving = termsIn(ctx, a, 'DIVING')
  const inWater = swim.length > 0 || boat.length > 0 || diving.length > 0
  if (!inWater && termsIn(ctx, a, 'AM_WATER').length > 0) return null
  const found: { setting: Setting; term: string }[] = []
  const river = termsIn(ctx, a, 'RIVER')
  if (river.length > 0 && swim.length > 0) found.push({ setting: 'fluss', term: river[0] })
  const lake = termsIn(ctx, a, 'LAKE')
  if (lake.length > 0 && inWater) found.push({ setting: 'see', term: lake[0] })
  const pool = termsIn(ctx, a, 'POOL')
  if (pool.length > 0) {
    const unsupervised = termsIn(ctx, a, 'UNSUPERVISED')
    found.push({ setting: unsupervised.length > 0 ? 'pool' : 'bad', term: pool[0] })
  }
  const best = strictest(found.map((f) => f.setting))
  return best ? (found.find((f) => f.setting === best) ?? null) : null
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const lstWasser04: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const tags = ctx.campConfig.tagsOf(a.iri)
    if (tags.includes('externe-wasseraufsicht')) continue
    const s = settingOf(ctx, a)
    if (!s) continue
    const key = REQUIRED_KEY[s.setting]
    const n = distinctLeadersWithKey(ctx.midata, key, ctx.settings.midata?.qualMapping ?? {})
    const fragments = { setting: [{ variant: `setting${cap(s.setting)}` }], required: [{ variant: `required${cap(s.setting)}` }] }
    const evidence = [activityEvidence(a, s.term || undefined)]
    if (n === null) {
      hits.push({
        targets: [a.iri],
        params: { activity: a.title },
        variant: 'unknown',
        severity: 'hint',
        fragments: { setting: fragments.setting },
        inputs: { setting: s.setting, requiredKey: key },
        evidence,
      })
      continue
    }
    if (n > 0) continue
    const stand = formatStand(ctx.midata?.fetchedAt ?? '')
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      fragments,
      inputs: { setting: s.setting, requiredKey: key, validLeaders: n },
      redKeys: ['validLeaders'],
      evidence: [...evidence, midataEvidence(stand)],
    })
  }
  return hits
}

// LST-WASSER-05 ------------------------------------------------------------------------------

const BACH_GROUPS: [set: string, variant: string][] = [
  ['WETTER', 'missingWetter'],
  ['AUSSTIEG', 'missingAusstieg'],
  ['RECO', 'missingReco'],
  ['KRAFTWERK', 'missingKraftwerk'],
]

export const lstWasser05: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const found = termsIn(ctx, a, 'BACHTREKKING')
    if (found.length === 0) continue
    const missing = BACH_GROUPS.filter(([set]) => termsAll(ctx, a, set).length === 0).map(([, variant]): MessageFragment => ({ variant }))
    if (missing.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      fragments: { missing },
      inputs: { matchedKeyword: found[0], missingGroups: missing.length },
      evidence: ev(a, found),
    })
  }
  return hits
}

// LST-WASSER-06 ------------------------------------------------------------------------------

export const lstWasser06: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const found = termsIn(ctx, a, 'LAKE_SWIM')
    if (found.length === 0 || termsAll(ctx, a, 'ESCORT').length > 0) continue
    hits.push({ targets: [a.iri], params: { activity: a.title }, inputs: { matchedKeyword: found[0] }, evidence: ev(a, found) })
  }
  return hits
}

// LST-WASSER-07 ------------------------------------------------------------------------------

export const lstWasser07: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const water = openWater(ctx, a)
    const jump = termsIn(ctx, a, 'JUMP')
    if (water.length === 0 || jump.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      inputs: { matchedKeyword: jump[0], waterKeyword: water[0] },
      evidence: ev(a, [...jump, ...water]),
    })
  }
  return hits
}

// LST-WASSER-08 ------------------------------------------------------------------------------

export const lstWasser08: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const place = [...termsIn(ctx, a, 'RIVER'), ...termsIn(ctx, a, 'GORGE')]
    const rope = termsIn(ctx, a, 'ROPE_IN_WATER')
    if (place.length === 0 || rope.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      inputs: { matchedKeyword: rope[0], placeKeyword: place[0] },
      evidence: ev(a, [...rope, ...place]),
    })
  }
  return hits
}

// LST-WASSER-09 ------------------------------------------------------------------------------

export const lstWasser09: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const water = openWater(ctx, a)
    if (water.length === 0 || termsAll(ctx, a, 'KIT_WAERME').length > 0) continue
    hits.push({ targets: [a.iri], params: { activity: a.title }, inputs: { matchedKeyword: water[0] }, evidence: ev(a, water) })
  }
  return hits
}

// LST-WASSER-10 ------------------------------------------------------------------------------

export const lstWasser10: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const found = [...termsIn(ctx, a, 'BOAT'), ...termsIn(ctx, a, 'FLOSS')]
    if (found.length === 0 || termsAll(ctx, a, 'VEST').length > 0) continue
    hits.push({ targets: [a.iri], params: { activity: a.title }, inputs: { matchedKeyword: found[0] }, evidence: ev(a, found) })
  }
  return hits
}

export const predicates: Record<string, RulePredicate> = {
  'LST-WASSER-01': lstWasser01,
  'LST-WASSER-02': jsOnly(lstWasser02),
  'LST-WASSER-03': lstWasser03,
  'LST-WASSER-04': jsOnly(lstWasser04),
  'LST-WASSER-05': lstWasser05,
  'LST-WASSER-06': lstWasser06,
  'LST-WASSER-07': lstWasser07,
  'LST-WASSER-08': jsOnly(lstWasser08),
  'LST-WASSER-09': lstWasser09,
  'LST-WASSER-10': lstWasser10,
}
