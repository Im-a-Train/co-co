/** Synthetic CampFacts fixture factory and RuleContext helpers (makeCtx, msg) for rule tests. */
import {
  DEFAULT_APP_SETTINGS,
  type ActivityContent,
  type ActivityFact,
  type CampFacts,
  type CategoryClass,
  type CategoryMapping,
  type CoachInputs,
  type DocumentRecord,
  type MidataAggregate,
  type NdsAggregate,
  type CampRuleConfig,
  type ParamValue,
  type RuleContext,
  type RuleContextInput,
  type RuleHit,
  type RuleMeta,
  type ScheduleEntryFact,
} from '@/domain/types'
import { renderMessage } from '../engine'
import { defaultCampRuleConfig } from '../lib/campRuleConfig'
import { completeContext, contextDate, paramDefsOf } from '../lib/context'
import { createParamReader } from '../lib/params'
import { loadBundledPacks } from '../packs'
import { hitRuleIds } from './predicates'

export const CAMP = '/api/camps/c1'
export const PERIOD = '/api/periods/p1'
export const CAT_LS = '/api/categories/ls'
export const CAT_LA = '/api/categories/la'
export const CAT_LP = '/api/categories/lp'
export const CAT_ES = '/api/categories/es'
export const CAT_NONE = '/api/categories/none'

export function emptyContent(over: Partial<ActivityContent> = {}): ActivityContent {
  return {
    storyboardText: '',
    safetyText: '',
    notesText: '',
    learningObjectivesText: '',
    materialText: '',
    laThematicAreas: [],
    learningTopics: [],
    ysCharacteristics: [],
    ysPhysicalActivityDurationMinutes: null,
    contentTypes: [],
    hasStoryboard: false,
    hasSafetyConsiderations: false,
    contentNodeCount: 0,
    ...over,
  }
}

export const MAPPING: CategoryMapping = {
  campIri: CAMP,
  entries: { [CAT_LS]: 'LS', [CAT_LA]: 'LA', [CAT_LP]: 'LP', [CAT_ES]: 'ES', [CAT_NONE]: 'NONE' },
  confirmed: true,
  confirmedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

export function mappingOf(entries: Record<string, CategoryClass>): CategoryMapping {
  return { ...MAPPING, entries }
}

export function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function addDay(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** `${date}T${hh:mm}:00+00:00` (eCamp wall-clock serialisation). */
export function at(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00+00:00`
}

/** Fluent builder for CampFacts. Times are given as 'HH:MM' strings on a 1-based day number. */
export class FactsBuilder {
  facts: CampFacts
  private nextId = 1

  constructor(opts: { start?: string; days?: number; coachName?: string | null; title?: string } = {}) {
    const start = opts.start ?? '2031-07-12'
    const dayCount = opts.days ?? 5
    const end = addDay(start, dayCount - 1)
    this.facts = {
      schemaVersion: 1,
      loadedAt: '2026-01-01T00:00:00.000Z',
      instanceBaseUrl: 'https://example.test',
      userIri: '/api/users/u1',
      camp: {
        iri: CAMP,
        id: 'c1',
        title: opts.title ?? 'Testlager',
        shortTitle: null,
        motto: null,
        kind: null,
        organizer: null,
        coachName: opts.coachName === undefined ? 'Max Muster' : opts.coachName,
        courseKind: null,
        courseNumber: null,
        trainingAdvisorName: null,
        address: { name: null, street: null, zipcode: null, city: null },
        isPrototype: false,
        start: dayCount > 0 ? start : null,
        end: dayCount > 0 ? end : null,
      },
      periods: dayCount > 0 ? [{ iri: PERIOD, description: null, start, end }] : [],
      days: [],
      scheduleEntries: [],
      activities: [],
      categories: [],
      collaborators: [],
      dayResponsibles: [],
      activityResponsibles: [],
      progressLabels: [],
      comments: [],
    }
    for (let i = 0; i < dayCount; i++) {
      const date = addDay(start, i)
      this.facts.days.push({
        iri: `/api/days/d${i + 1}`,
        periodIri: PERIOD,
        number: i + 1,
        dayOffset: i,
        date,
        start: at(date, '00:00'),
        end: at(addDay(date, 1), '00:00'),
      })
    }
  }

  dayIri(n: number): string {
    return `/api/days/d${n}`
  }

  dateOf(n: number): string {
    return this.facts.days[n - 1].date
  }

  activity(
    title: string,
    category: string | null,
    opts: { responsible?: boolean; content?: Partial<ActivityContent>; location?: string | null; progress?: string | null } = {},
  ): ActivityFact {
    const iri = `/api/activities/a${this.nextId++}`
    const a: ActivityFact = {
      iri,
      title,
      location: opts.location ?? null,
      categoryIri: category,
      progressLabelIri: opts.progress ?? null,
      rootContentNodeIri: null,
      responsibleIris: opts.responsible === false ? [] : ['/api/camp_collaborations/cc1'],
      scheduleEntryIris: [],
      content: emptyContent({ hasStoryboard: true, storyboardText: 'Einstimmen mit Spiel, dann Hauptteil', ...opts.content }),
    }
    this.facts.activities.push(a)
    return a
  }

  /** Adds a schedule entry; end may be on the next day with `endDay`. */
  entry(a: ActivityFact, day: number, from: string, to: string, opts: { endDay?: number; ys?: number | null } = {}): ScheduleEntryFact {
    const date = this.dateOf(day)
    const start = at(date, from)
    const end = at(this.facts.days[(opts.endDay ?? day) - 1]?.date ?? addDay(date, (opts.endDay ?? day) - day), to)
    const duration = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
    const e: ScheduleEntryFact = {
      iri: `/api/schedule_entries/e${this.nextId++}`,
      activityIri: a.iri,
      periodIri: PERIOD,
      dayIri: this.dayIri(day),
      start,
      end,
      durationMinutes: duration,
      dayNumber: day,
      scheduleEntryNumber: 1,
      number: `${day}.1`,
      left: 0,
      width: 0,
      ysPhysicalActivityDurationMinutes: opts.ys ?? null,
    }
    this.facts.scheduleEntries.push(e)
    a.scheduleEntryIris.push(e.iri)
    return e
  }

  dayResponsible(day: number): this {
    this.facts.dayResponsibles.push({
      iri: `/api/day_responsibles/r${this.nextId++}`,
      dayIri: this.dayIri(day),
      collaborationIri: '/api/camp_collaborations/cc1',
    })
    return this
  }

  /** Two LS/LA units of 2 h on each of the given days (valid J+S day), 09:00-11:00 and 14:00-16:00. */
  validDay(day: number, cat = CAT_LS): this {
    this.entry(this.activity(`Vormittag ${day}`, cat), day, '09:00', '11:00')
    this.entry(this.activity(`Nachmittag ${day}`, cat), day, '14:00', '16:00')
    return this
  }
}

export function makeCoachInputs(over: Partial<CoachInputs> = {}): CoachInputs {
  return {
    campIri: CAMP,
    isJsCamp: true,
    participantsCount: null,
    participantsJsAgeCount: null,
    minAge: null,
    maxAge: null,
    stufe: null,
    leadersCount: null,
    slrgCount: null,
    lagerleiterAttested: null,
    ndsRegistered: false,
    ndsRegisteredOn: null,
    ndsClosed: false,
    ndsClosedOn: null,
    leihmaterialOrdered: false,
    landeskartenOrdered: false,
    lagerbewilligungDone: false,
    notes: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

export function makeMidata(over: Partial<MidataAggregate> = {}): MidataAggregate {
  return {
    zone: 'red-derived',
    baseUrl: 'https://db.example.test',
    eventId: '4711',
    eventName: 'Testlager',
    eventDates: [{ startAt: '2031-07-12', finishAt: '2031-07-16' }],
    location: null,
    maximumParticipants: null,
    participantsCount: 20,
    participantsJsAgeCount: 18,
    participantsWithoutBirthday: 0,
    minAge: 8,
    maxAge: 12,
    ageBands: [],
    leadersCount: 4,
    leaders: [],
    coachMatch: null,
    fetchedAt: '2031-01-01T10:00:00.000Z',
    ...over,
  }
}

export function makeDoc(over: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'doc1',
    campIri: CAMP,
    path: 'C:/docs/x.pdf',
    name: 'x.pdf',
    kind: 'pdf',
    size: 1,
    modifiedMs: 0,
    importedAt: '2026-01-01T00:00:00.000Z',
    source: 'picker',
    folder: null,
    contentHash: 'abc',
    text: '',
    extractError: null,
    activityIris: [],
    linkSuggestions: [],
    docCheck: null,
    gpx: null,
    zone: 'yellow',
    aiAllowed: false,
    aiSummary: null,
    ...over,
  }
}

export interface CtxOverrides extends Partial<Omit<RuleContextInput, 'campConfig'>> {
  /** Per-camp rule config: fields merged over the default record (modules, activityTags, camp, angebot, params …). */
  campConfig?: Partial<CampRuleConfig> | null
  /** Param values forced for this test (bypass `overridable`; reported by isOverridden). */
  paramValues?: Record<string, ParamValue>
}

/**
 * Complete RuleContext for predicate tests: bundled packs' params + keyword sets, resolved campConfig
 * (module states), lazy ctx.js. Defaults: J+S mapping MAPPING, now 2031-01-01, default settings.
 */
export function makeCtx(facts: CampFacts, over: CtxOverrides = {}): RuleContext {
  const { campConfig, paramValues, ...rest } = over
  const input: RuleContextInput = {
    facts,
    mapping: MAPPING,
    coachInputs: null,
    documents: [],
    settings: DEFAULT_APP_SETTINGS,
    now: new Date('2031-01-01T12:00:00Z'),
    userDisplayName: null,
    overrides: [],
    ...rest,
    campConfig: campConfig ? { ...defaultCampRuleConfig(facts.camp.iri), ...campConfig } : null,
  }
  const packs = loadBundledPacks()
  if (paramValues && !input.params) {
    const base = createParamReader({
      defs: paramDefsOf(packs),
      date: contextDate(input),
      adminParams: input.settings.ruleParams ?? null,
      campParams: (campConfig?.params ?? null) as Record<string, ParamValue> | null,
    })
    input.params = {
      get: <T,>(key: string) => (key in paramValues ? (paramValues[key] as T) : base.get<T>(key)),
      isOverridden: (key) => (key in paramValues ? { value: paramValues[key], default: base.get(key) } : base.isOverridden(key)),
      def: (key) => base.def(key),
    }
  }
  return completeContext(packs, input)
}

/** Rule metadata of a bundled rule (throws if unknown). */
export function ruleMeta(id: string): RuleMeta {
  const meta = loadBundledPacks()
    .flatMap((p) => p.rules)
    .find((r) => r.meta.id === id)?.meta
  if (!meta) throw new Error(`Regel ${id} nicht gefunden`)
  return meta
}

/**
 * Rendered message of a predicate hit (variants, fragments, placeholders), as the engine would produce it.
 * `msg(hit)` works for hits returned by `allPredicates` (./predicates.ts); otherwise pass the rule id.
 */
export function msg(hitOrRuleId: RuleHit | string | undefined, maybeHit?: RuleHit): string {
  const hit = typeof hitOrRuleId === 'string' ? maybeHit : hitOrRuleId
  if (!hit) throw new Error('kein Treffer')
  const ruleId = typeof hitOrRuleId === 'string' ? hitOrRuleId : hitRuleIds.get(hit)
  if (!ruleId) throw new Error('Regel-ID unbekannt: msg(ruleId, hit) verwenden')
  return renderMessage(ruleMeta(ruleId), hit)
}

const NO_COUNTS = { children: null, adolescents: null, totalParticipants: null, totalInstructors: null, jsInstructors: null, campDays: null, totalActivities: null }

export function makeNds(over: Partial<NdsAggregate> = {}): NdsAggregate {
  return {
    offerBusinessId: 'offer-1',
    campBusinessId: 'camp-1',
    offerNumber: '1234567',
    start: '2031-07-12',
    end: '2031-07-16',
    offerState: null,
    offerItemState: null,
    approvedOn: null,
    statistics: { planned: { ...NO_COUNTS }, actual: { ...NO_COUNTS }, coachAuthorizedForContribution: null },
    supervisorCounts: {},
    participantCount: 0,
    participantCountsByAudience: {},
    activities: { total: 0, byState: {}, byType: {}, lastActivityDate: null, attendanceOpenCount: 0 },
    campAgendaUploaded: null,
    rentalOrders: [],
    fetchedAt: '2031-01-01T10:00:00.000Z',
    ...over,
  }
}
