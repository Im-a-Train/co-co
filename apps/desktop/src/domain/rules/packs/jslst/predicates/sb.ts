/**
 * Module `lst`: Sicherheitsbereich rules LST-SB-01..05 (catalog v2 §5.2). Pure predicates of RuleContext.
 * All texts live in the rule YAMLs (messageVariants); areas and reasons are rendered through fragments.
 */
import type { ActivityFact, ActivityTag, MessageFragment, ModuleId, RuleContext, RuleHit, RulePredicate } from '@/domain/types'
import { campYearOf } from '../../../lib/birthYear'
import { ALL_ACTIVITY_FIELDS } from '../../../lib/keywords'
import { activityEvidence, campEvidence, formatStand, midataEvidence } from '../../../lib/util'

type Area = 'berg' | 'wasser' | 'winter'

const AREA_TAGS: ReadonlyArray<[ActivityTag, Area]> = [
  ['sb-berg', 'berg'],
  ['sb-wasser', 'wasser'],
  ['sb-winter', 'winter'],
]
const AREA_VARIANT: Record<Area, string> = { berg: 'areaBerg', wasser: 'areaWasser', winter: 'areaWinter' }
const AREA_MODULE: Record<Area, ModuleId> = { berg: 'lst-berg', wasser: 'lst-wasser', winter: 'lst-winter' }
const AREA_QUAL: Record<Area, 'sbBerg' | 'sbWasser' | 'sbWinter'> = { berg: 'sbBerg', wasser: 'sbWasser', winter: 'sbWinter' }

const areaFragments = (areas: Area[]): MessageFragment[] => areas.map((a) => ({ variant: AREA_VARIANT[a] }))

/** Areas of the `sb-*` tags of an activity (empty = not tagged). */
function sbAreasOf(ctx: RuleContext, a: ActivityFact): Area[] {
  const tags = ctx.campConfig.tagsOf(a.iri)
  return AREA_TAGS.filter(([t]) => tags.includes(t)).map(([, area]) => area)
}

function sbActivities(ctx: RuleContext): { a: ActivityFact; areas: Area[] }[] {
  return ctx.facts.activities.map((a) => ({ a, areas: sbAreasOf(ctx, a) })).filter((x) => x.areas.length > 0)
}

/** §2.2: at least one camp day lies in a month of `lst.winterMonths`. */
function campInWinter(ctx: RuleContext): boolean {
  const months = ctx.params.get<number[]>('lst.winterMonths')
  return ctx.facts.days.some((d) => months.includes(Number(d.date.slice(5, 7))))
}

/** Camp counts as Sicherheitsbereich Winter: no winter-safe access and the camp overlaps the winter months. */
function campWinterCase(ctx: RuleContext): boolean {
  return ctx.campConfig.camp.winterSafeAccess === false && campInWinter(ctx)
}

const campHit = (ctx: RuleContext, extra: Partial<RuleHit>): RuleHit => ({
  targets: [ctx.facts.camp.iri],
  variant: 'camp',
  fragments: { area: areaFragments(['winter']) },
  severity: 'should', // winter determination is a co-co proxy (§0.3)
  evidence: [campEvidence(ctx.facts)],
  ...extra,
})

// ---------------------------------------------------------------------------------------------
// LST-SB-01
// ---------------------------------------------------------------------------------------------

/** Calendar days (yyyy-mm-dd) an activity's schedule entries touch; an entry ending exactly at 00:00 does not touch that day. */
function entryDates(ctx: RuleContext, a: ActivityFact): Set<string> {
  const dates = new Set<string>()
  for (const e of ctx.facts.scheduleEntries) {
    if (e.activityIri !== a.iri) continue
    const first = e.start.slice(0, 10)
    let last = e.end.slice(0, 10)
    if (e.end.slice(11, 16) === '00:00' && last > first) last = new Date(Date.parse(`${last}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
    for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += 86400000) dates.add(new Date(t).toISOString().slice(0, 10))
  }
  return dates
}

export const lstSb01: RulePredicate = (ctx) => {
  const kw = (set: string, a: ActivityFact) => ctx.keywords.matchActivity(set, a, ALL_ACTIVITY_FIELDS).length > 0
  const winterMonths = ctx.params.get<number[]>('lst.winterMonths')
  const treeline = ctx.params.get<number>('lst.treelineM')
  const snowshoeMin = ctx.params.get<number>('lst.snowshoeSbMinutes')
  const hits: RuleHit[] = []
  for (const a of ctx.facts.activities) {
    const tags = ctx.campConfig.tagsOf(a.iri)
    if (tags.includes('kein-sb') || AREA_TAGS.some(([t]) => tags.includes(t))) continue
    const dates = entryDates(ctx, a)
    const multiDay = dates.size >= 2
    const inWinter = [...dates].some((d) => winterMonths.includes(Number(d.slice(5, 7))))
    const gpx = ctx.documents.filter((d) => d.activityIris.includes(a.iri) && d.gpx).map((d) => d.gpx!)
    const highest = Math.max(-Infinity, ...gpx.map((g) => g.highestPointM ?? -Infinity))
    const minutes = Math.max(0, ...gpx.map((g) => g.estimatedMinutes))
    const hard = kw('ANSPRUCHSVOLL', a)
    const biwak = kw('BIWAK', a)

    const found: { area: Area; reason: string }[] = []
    if (kw('T3', a) && hard) found.push({ area: 'berg', reason: 'reasonBergT3' })
    else if (biwak && multiDay && (highest > treeline || kw('TREELINE', a))) found.push({ area: 'berg', reason: 'reasonBergBiwak' })

    if (kw('RIVER', a) && (kw('BOAT', a) || kw('FLOSS', a)) && !tags.includes('ebb-b')) found.push({ area: 'wasser', reason: 'reasonWasserRiver' })
    else if (kw('BACHTREKKING', a) && hard) found.push({ area: 'wasser', reason: 'reasonWasserBach' })
    else if (kw('SB_WASSER_EXTRA', a)) found.push({ area: 'wasser', reason: 'reasonWasserExtra' })

    if (inWinter) {
      if (kw('SNOWSHOE', a) && (minutes > snowshoeMin || multiDay || hard)) found.push({ area: 'winter', reason: 'reasonWinterSnowshoe' })
      else if ((biwak || kw('IGLU', a)) && ctx.campConfig.camp.campForm !== 'haus') found.push({ area: 'winter', reason: 'reasonWinterBiwak' })
    }
    if (found.length === 0) continue

    const areas = [...new Set(found.map((f) => f.area))]
    const anyOn = areas.some((area) => ctx.campConfig.moduleStates[AREA_MODULE[area]]?.state === 'on')
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      fragments: { area: areaFragments(areas), reason: found.map((f) => ({ variant: f.reason })) },
      ...(anyOn ? {} : { severity: 'hint' as const }),
      inputs: { areas: areas.join(','), multiDay, inWinterMonth: inWinter },
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

// ---------------------------------------------------------------------------------------------
// LST-SB-02: Expertenbewilligung
// ---------------------------------------------------------------------------------------------

function approved(ctx: RuleContext, key: string): boolean {
  const ap = ctx.campConfig.sbApprovals[key]
  return !!ap && (!!ap.approvedOn || ap.kind === 'bergfuehrer')
}

export const lstSb02: RulePredicate = (ctx) => {
  const hits: RuleHit[] = []
  for (const { a, areas } of sbActivities(ctx)) {
    if (approved(ctx, a.iri)) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      fragments: { area: areaFragments(areas) },
      inputs: { areas: areas.join(',') },
      evidence: [activityEvidence(a)],
    })
  }
  if (campWinterCase(ctx) && !approved(ctx, 'camp')) hits.push(campHit(ctx, { inputs: { winterSafeAccess: false } }))
  return hits
}

// ---------------------------------------------------------------------------------------------
// LST-SB-03: Zusatzanerkennung im Team (MiData)
// ---------------------------------------------------------------------------------------------

export const lstSb03: RulePredicate = (ctx) => {
  const acts = sbActivities(ctx)
  const winterCamp = campWinterCase(ctx)
  if (acts.length === 0 && !winterCamp) return []
  const md = ctx.midata
  if (!md || md.qualificationsReadable === false || !md.qualificationKinds) {
    return [{ targets: [ctx.facts.camp.iri], variant: 'unknown', severity: 'hint', evidence: [campEvidence(ctx.facts)] }]
  }
  const stand = formatStand(md.fetchedAt)
  const valid = (area: Area): number =>
    md.qualificationKinds!.filter((k) => k.keys.includes(AREA_QUAL[area])).reduce((s, k) => s + k.validLeaders, 0)
  const hits: RuleHit[] = []
  for (const { a, areas } of acts) {
    const missing = areas.filter((area) => valid(area) === 0)
    if (missing.length === 0) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      fragments: { area: areaFragments(missing) },
      inputs: { areas: missing.join(','), validLeaders: 0 },
      redKeys: ['validLeaders'],
      evidence: [activityEvidence(a), midataEvidence(stand)],
    })
  }
  if (winterCamp && valid('winter') === 0) {
    hits.push(campHit(ctx, { inputs: { validLeaders: 0 }, redKeys: ['validLeaders'], evidence: [campEvidence(ctx.facts), midataEvidence(stand)] }))
  }
  return hits
}

// ---------------------------------------------------------------------------------------------
// LST-SB-04: nur Jugendliche (Jahrgang)
// ---------------------------------------------------------------------------------------------

export const lstSb04: RulePredicate = (ctx) => {
  const byYear = ctx.midata?.participantsByBirthYear
  if (!byYear) return []
  const acts = sbActivities(ctx)
  const winterCamp = campWinterCase(ctx)
  if (acts.length === 0 && !winterCamp) return []
  const minAge = ctx.params.get<number>('lst.sbMinAgeByYear')
  const campYear = campYearOf(ctx.facts.camp.start, ctx.now)
  const n = Object.entries(byYear).reduce((s, [y, c]) => (campYear - Number(y) < minAge ? s + c : s), 0)
  if (n <= 0) return []
  const fromYear = campYear - (minAge - 1)
  const stand = formatStand(ctx.midata!.fetchedAt)
  const common = { n, fromYear }
  const red = { redKeys: ['n'] }
  const hits: RuleHit[] = acts.map(({ a, areas }) => ({
    targets: [a.iri],
    params: { activity: a.title, ...common },
    fragments: { area: areaFragments(areas) },
    inputs: { n, fromYear },
    evidence: [activityEvidence(a), midataEvidence(stand)],
    ...red,
  }))
  if (winterCamp) hits.push(campHit(ctx, { params: common, inputs: { n, fromYear }, evidence: [campEvidence(ctx.facts), midataEvidence(stand)], severity: undefined, ...red }))
  return hits
}

// ---------------------------------------------------------------------------------------------
// LST-SB-05: detaillierte Planung
// ---------------------------------------------------------------------------------------------

export const lstSb05: RulePredicate = (ctx) => {
  const min = ctx.params.get<number>('lst.sbSafetyMinChars')
  const hits: RuleHit[] = []
  for (const { a, areas } of sbActivities(ctx)) {
    const chars = a.content.safetyText.trim().length
    if (chars >= min) continue
    if (ctx.documents.some((d) => d.activityIris.includes(a.iri))) continue
    hits.push({
      targets: [a.iri],
      params: { activity: a.title },
      fragments: { area: areaFragments(areas) },
      inputs: { safetyChars: chars, minChars: min },
      evidence: [activityEvidence(a)],
    })
  }
  return hits
}

export const predicates: Record<string, RulePredicate> = {
  'LST-SB-01': lstSb01,
  'LST-SB-02': lstSb02,
  'LST-SB-03': lstSb03,
  'LST-SB-04': lstSb04,
  'LST-SB-05': lstSb05,
}
