/**
 * CampFacts loader + category guessing.
 *
 * Pure module (no Vue / Tauri / Dexie): the HTTP GET is injected so it runs in vitest against the
 * JSON dump fixtures. Persistence of mappings / coach inputs lives in ./store.ts.
 *
 * Endpoints (all need filters, see docs/contracts/ecamp-api.md):
 *   GET {campIri}
 *   GET /api/periods?camp={campIri}
 *   GET /api/days?period.camp={campIri}
 *   GET /api/day_responsibles?day.period={periodIri}           (per period)
 *   GET /api/schedule_entries?period={periodIri}               (per period)
 *   GET /api/activities?camp={campIri}
 *   GET /api/activity_responsibles?activity.camp={campIri}
 *   GET /api/camp_collaborations?camp={campIri}                (+ profiles for names, best effort)
 *   GET /api/categories?camp={campIri}
 *   GET /api/activity_progress_labels?camp={campIri}
 *   GET /api/content_nodes?camp={campIri}
 *   GET /api/comments?camp={campIri}                           (best effort)
 */
import { asResource, embeddedList, embeddedOne, linkHref, selfHref, str, type HalResource } from '@/lib/hal'
import { idFromIri } from '../iri'
import type {
  ActivityContent,
  ActivityFact,
  ActivityResponsibleFact,
  ApiGet,
  CampFacts,
  CampInfo,
  CampListEntry,
  CategoryClass,
  CategoryFact,
  CategoryGuess,
  CategoryMapping,
  CollaboratorFact,
  CollaboratorRole,
  CollaboratorStatus,
  CommentFact,
  DayFact,
  DayResponsibleFact,
  Iri,
  LoadProgress,
  PeriodFact,
  ProgressLabelFact,
  ScheduleEntryFact,
} from '../types'

export interface LoadCampFactsOptions {
  /** IRI of the logged-in user (marks CollaboratorFact.isCurrentUser, stored in CampFacts.userIri). */
  userIri?: Iri | null
  instanceBaseUrl?: string | null
}

// ---------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : m
      } catch {
        return m
      }
    }
    return NAMED_ENTITIES[e] ?? NAMED_ENTITIES[e.toLowerCase()] ?? m
  })
}

/** HTML -> plain text helper used for content nodes (also usable by other modules). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return ''
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr|blockquote|ul|ol)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
  const stripped = withBreaks.replace(/<[^>]*>/g, '')
  return decodeEntities(stripped)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ---------------------------------------------------------------------------------------------
// HAL helpers
// ---------------------------------------------------------------------------------------------

/** Fetches a collection and follows `_links.next` (HAL pagination) until exhausted. */
async function fetchAll(apiGet: ApiGet, path: string): Promise<HalResource[]> {
  const out: HalResource[] = []
  const seen = new Set<string>()
  let next: string | null = path
  while (next && !seen.has(next)) {
    seen.add(next)
    const page: HalResource | null = asResource(await apiGet<unknown>(next))
    out.push(...embeddedList(page, 'items'))
    next = linkHref(page, 'next')
    if (next === selfHref(page)) next = null
  }
  return out
}

const enc = encodeURIComponent

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Non-empty string, or a finite number turned into a string; else null. */
function idLike(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10)
}

function minutesBetween(start: string, end: string): number {
  const ms = Date.parse(end) - Date.parse(start)
  return Number.isFinite(ms) ? Math.round(ms / 60000) : 0
}

function toRole(v: unknown): CollaboratorRole {
  return v === 'manager' || v === 'member' ? v : 'guest'
}

function toStatus(v: unknown): CollaboratorStatus {
  return v === 'invited' || v === 'inactive' ? v : 'established'
}

// ---------------------------------------------------------------------------------------------
// Normalisers
// ---------------------------------------------------------------------------------------------

function toPeriod(r: HalResource): PeriodFact | null {
  const iri = selfHref(r)
  const start = str(r, 'start')
  const end = str(r, 'end')
  if (!iri || !start || !end) return null
  return { iri, description: str(r, 'description'), start: dateOnly(start), end: dateOnly(end) }
}

function toDay(r: HalResource): DayFact | null {
  const iri = selfHref(r)
  const start = str(r, 'start')
  const end = str(r, 'end')
  if (!iri || !start || !end) return null
  return {
    iri,
    periodIri: linkHref(r, 'period') ?? '',
    number: num(r.number) ?? 0,
    dayOffset: num(r.dayOffset) ?? 0,
    date: dateOnly(start),
    start,
    end,
  }
}

function toScheduleEntry(r: HalResource): ScheduleEntryFact | null {
  const iri = selfHref(r)
  const start = str(r, 'start')
  const end = str(r, 'end')
  const activityIri = linkHref(r, 'activity')
  if (!iri || !start || !end || !activityIri) return null
  return {
    iri,
    activityIri,
    periodIri: linkHref(r, 'period') ?? '',
    dayIri: linkHref(r, 'day'),
    start,
    end,
    durationMinutes: minutesBetween(start, end),
    dayNumber: num(r.dayNumber),
    scheduleEntryNumber: num(r.scheduleEntryNumber),
    number: str(r, 'number'),
    left: num(r.left) ?? 0,
    width: num(r.width) ?? 0,
    ysPhysicalActivityDurationMinutes: num(r.ysPhysicalActivityDurationMinutes),
  }
}

function toCategory(r: HalResource): CategoryFact | null {
  const iri = selfHref(r)
  if (!iri) return null
  return {
    iri,
    short: str(r, 'short') ?? '',
    name: str(r, 'name') ?? '',
    color: str(r, 'color') ?? '#9e9e9e',
    numberingStyle: str(r, 'numberingStyle'),
  }
}

function toProgressLabel(r: HalResource): ProgressLabelFact | null {
  const iri = selfHref(r)
  if (!iri) return null
  return { iri, title: str(r, 'title') ?? '', position: num(r.position) ?? 0 }
}

function checkedKeys(data: unknown): string[] {
  const options = asResource(asResource(data)?.options)
  if (!options) return []
  return Object.entries(options)
    .filter(([, v]) => asResource(v)?.checked === true)
    .map(([k]) => k)
}

function storyboardText(data: unknown): string {
  const sections = asResource(asResource(data)?.sections)
  if (!sections) return ''
  return Object.values(sections)
    .map((s) => asResource(s))
    .filter((s): s is HalResource => s !== null)
    .sort((a, b) => (num(a.position) ?? 0) - (num(b.position) ?? 0))
    .map((s) =>
      [str(s, 'column1'), htmlToText(str(s, 'column2Html')), str(s, 'column3')]
        .filter((p): p is string => !!p && p.length > 0)
        .join(' | '),
    )
    .filter((l) => l.length > 0)
    .join('\n')
}

function nodeDurationMinutes(data: unknown): number | null {
  const d = asResource(data)
  if (!d) return null
  for (const key of ['duration', 'minutes', 'durationMinutes', 'value']) {
    const v = num(d[key])
    if (v !== null) return v
  }
  return null
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)]
}

function emptyContent(): ActivityContent {
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
  }
}

function sortedNodes(nodes: HalResource[]): HalResource[] {
  return [...nodes].sort((a, b) => (num(a.position) ?? 0) - (num(b.position) ?? 0))
}

/** Flattens the content nodes of one activity (all nodes whose root is the activity's root). */
export function buildActivityContent(nodes: HalResource[]): ActivityContent {
  const c = emptyContent()
  const texts: Record<'story' | 'safety' | 'notes' | 'learn' | 'material', string[]> = {
    story: [],
    safety: [],
    notes: [],
    learn: [],
    material: [],
  }
  let duration: number | null = null
  const types: string[] = []
  const areas: string[] = []
  const topics: string[] = []
  const ys: string[] = []
  for (const n of sortedNodes(nodes)) {
    const type = str(n, 'contentTypeName') ?? ''
    if (type) types.push(type)
    const data = n.data
    const html = htmlToText(str(asResource(data), 'html'))
    switch (type) {
      case 'Storyboard':
        texts.story.push(storyboardText(data))
        break
      case 'SafetyConsiderations':
        texts.safety.push(html)
        break
      case 'Notes':
        texts.notes.push(html)
        break
      case 'LearningObjectives':
        texts.learn.push(html)
        break
      case 'Material':
        texts.material.push(html)
        break
      case 'LAThematicArea':
        areas.push(...checkedKeys(data))
        break
      case 'LearningTopics':
        topics.push(...checkedKeys(data))
        break
      case 'YSActivityCharacteristics':
        ys.push(...checkedKeys(data))
        break
      case 'YSPhysicalActivityDuration': {
        const d = nodeDurationMinutes(data)
        if (d !== null) duration = (duration ?? 0) + d
        break
      }
    }
  }
  const join = (l: string[]) => l.filter((t) => t.length > 0).join('\n')
  c.storyboardText = join(texts.story)
  c.safetyText = join(texts.safety)
  c.notesText = join(texts.notes)
  c.learningObjectivesText = join(texts.learn)
  c.materialText = join(texts.material)
  c.laThematicAreas = dedupe(areas)
  c.learningTopics = dedupe(topics)
  c.ysCharacteristics = dedupe(ys)
  c.ysPhysicalActivityDurationMinutes = duration
  c.contentTypes = dedupe(types)
  c.hasStoryboard = c.storyboardText.length > 0
  c.hasSafetyConsiderations = c.safetyText.length > 0
  c.contentNodeCount = nodes.length
  return c
}

function emailLocal(email: string | null): string | null {
  if (!email) return null
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : null
}

// ---------------------------------------------------------------------------------------------
// loadCampFacts
// ---------------------------------------------------------------------------------------------

/** Loads and normalises the full camp graph. Rejects on HTTP errors of required endpoints. */
export async function loadCampFacts(
  apiGet: ApiGet,
  campIri: Iri,
  onProgress?: (p: LoadProgress) => void,
  options: LoadCampFactsOptions = {},
): Promise<CampFacts> {
  const TOTAL = 12
  let done = 0
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const r = await fn()
    done += 1
    onProgress?.({ step: name, done, total: TOTAL })
    return r
  }
  const optional = async <T>(name: string, fallback: T, fn: () => Promise<T>): Promise<T> =>
    step(name, async () => {
      try {
        return await fn()
      } catch {
        return fallback
      }
    })

  const q = enc(campIri)
  onProgress?.({ step: 'start', done: 0, total: TOTAL })

  const campRes = await step('camp', async () => asResource(await apiGet<unknown>(campIri)))
  if (!campRes) throw new Error('Lager konnte nicht geladen werden')

  const [periodRes, dayRes, activityRes, categoryRes, collabRes, labelRes] = await Promise.all([
    step('periods', () => fetchAll(apiGet, `/api/periods?camp=${q}`)),
    step('days', () => fetchAll(apiGet, `/api/days?period.camp=${q}`)),
    step('activities', () => fetchAll(apiGet, `/api/activities?camp=${q}`)),
    step('categories', () => fetchAll(apiGet, `/api/categories?camp=${q}`)),
    step('collaborators', () => fetchAll(apiGet, `/api/camp_collaborations?camp=${q}`)),
    step('progressLabels', () => fetchAll(apiGet, `/api/activity_progress_labels?camp=${q}`)),
  ])

  const periods = periodRes.map(toPeriod).filter((p): p is PeriodFact => p !== null)
  periods.sort((a, b) => a.start.localeCompare(b.start))

  // Period-scoped endpoints.
  const [seRes, drRes, arRes, nodeRes, commentRes, profileRes] = await Promise.all([
    step('scheduleEntries', async () =>
      (await Promise.all(periods.map((p) => fetchAll(apiGet, `/api/schedule_entries?period=${enc(p.iri)}`)))).flat(),
    ),
    step('dayResponsibles', async () =>
      (await Promise.all(periods.map((p) => fetchAll(apiGet, `/api/day_responsibles?day.period=${enc(p.iri)}`)))).flat(),
    ),
    step('activityResponsibles', () => fetchAll(apiGet, `/api/activity_responsibles?activity.camp=${q}`)),
    step('contentNodes', () => fetchAll(apiGet, `/api/content_nodes?camp=${q}`)),
    optional('comments', [] as HalResource[], () => fetchAll(apiGet, `/api/comments?camp=${q}`)),
    optional('profiles', [] as HalResource[], () =>
      fetchAll(apiGet, `/api/profiles?user.collaborations.camp=${q}`),
    ),
  ])

  const days = uniqueBy(dayRes.map(toDay).filter((d): d is DayFact => d !== null), (d) => d.iri).sort((a, b) =>
    a.start.localeCompare(b.start),
  )
  const scheduleEntries = uniqueBy(
    seRes.map(toScheduleEntry).filter((s): s is ScheduleEntryFact => s !== null),
    (s) => s.iri,
  ).sort((a, b) => a.start.localeCompare(b.start))
  const categories = categoryRes.map(toCategory).filter((c): c is CategoryFact => c !== null)
  const progressLabels = labelRes
    .map(toProgressLabel)
    .filter((l): l is ProgressLabelFact => l !== null)
    .sort((a, b) => a.position - b.position)

  // Collaborators with names.
  const profiles = new Map<string, HalResource>()
  for (const p of profileRes) {
    const href = selfHref(p)
    if (href) profiles.set(href, p)
  }
  const collaborators: CollaboratorFact[] = []
  for (const c of collabRes) {
    const iri = selfHref(c)
    if (!iri) continue
    const user = embeddedOne(c, 'user')
    const userIri = linkHref(c, 'user')
    const profileHref = linkHref(user, 'profile')
    const profile =
      (profileHref ? profiles.get(profileHref) : undefined) ??
      embeddedOne(user, 'profile') ??
      embeddedOne(c, 'profile')
    const nickname = str(profile, 'nickname')
    const firstname = str(profile, 'firstname')
    const surname = str(profile, 'surname')
    const fullName = [firstname, surname].filter(Boolean).join(' ') || null
    const abbreviation = str(c, 'abbreviation') ?? str(user, 'abbreviation')
    collaborators.push({
      iri,
      userIri,
      role: toRole(c.role),
      status: toStatus(c.status),
      displayName:
        nickname ?? fullName ?? str(user, 'displayName') ?? emailLocal(str(c, 'inviteEmail')) ?? '?',
      nickname,
      firstname,
      surname,
      abbreviation,
      isCurrentUser: !!options.userIri && userIri === options.userIri,
    })
  }

  // Content nodes grouped by root.
  const nodesByRoot = new Map<string, HalResource[]>()
  for (const n of nodeRes) {
    const root = linkHref(n, 'root') ?? selfHref(n)
    if (!root) continue
    const list = nodesByRoot.get(root)
    if (list) list.push(n)
    else nodesByRoot.set(root, [n])
  }

  const activityResponsibles: ActivityResponsibleFact[] = []
  for (const r of arRes) {
    const iri = selfHref(r)
    const activityIri = linkHref(r, 'activity')
    const collaborationIri = linkHref(r, 'campCollaboration')
    if (iri && activityIri && collaborationIri) activityResponsibles.push({ iri, activityIri, collaborationIri })
  }
  const dayResponsibles: DayResponsibleFact[] = uniqueBy(
    drRes.flatMap((r) => {
      const iri = selfHref(r)
      const dayIri = linkHref(r, 'day')
      const collaborationIri = linkHref(r, 'campCollaboration')
      return iri && dayIri && collaborationIri ? [{ iri, dayIri, collaborationIri }] : []
    }),
    (d) => d.iri,
  )

  const activities: ActivityFact[] = []
  for (const a of activityRes) {
    const iri = selfHref(a)
    if (!iri) continue
    const root = linkHref(a, 'rootContentNode')
    activities.push({
      iri,
      title: str(a, 'title') ?? '',
      location: str(a, 'location'),
      categoryIri: linkHref(a, 'category'),
      progressLabelIri: linkHref(a, 'progressLabel'),
      rootContentNodeIri: root,
      responsibleIris: activityResponsibles.filter((r) => r.activityIri === iri).map((r) => r.collaborationIri),
      scheduleEntryIris: scheduleEntries.filter((s) => s.activityIri === iri).map((s) => s.iri),
      content: buildActivityContent(root ? (nodesByRoot.get(root) ?? []) : []),
    })
  }

  const collabName = new Map(collaborators.map((c) => [c.iri, c.displayName]))
  const comments: CommentFact[] = []
  for (const c of commentRes) {
    const iri = selfHref(c)
    if (!iri) continue
    const authorIri = linkHref(c, 'author')
    comments.push({
      iri,
      activityIri: linkHref(c, 'activity'),
      parentIri: linkHref(c, 'parent'),
      textHtml: str(c, 'textHtml') ?? '',
      authorIri,
      authorDisplayName: str(c, 'authorDisplayName') ?? (authorIri ? (collabName.get(authorIri) ?? null) : null),
      createTime: str(c, 'createTime'),
      resolvedAt: str(c, 'resolvedAt'),
    })
  }
  comments.sort((a, b) => (a.createTime ?? '').localeCompare(b.createTime ?? ''))

  const camp: CampInfo = {
    iri: selfHref(campRes) ?? campIri,
    id: idFromIri(campIri),
    title: str(campRes, 'title') ?? '',
    shortTitle: str(campRes, 'shortTitle'),
    motto: str(campRes, 'motto'),
    kind: str(campRes, 'kind'),
    organizer: str(campRes, 'organizer'),
    coachName: str(campRes, 'coachName'),
    courseKind: str(campRes, 'courseKind'),
    courseNumber: str(campRes, 'courseNumber'),
    trainingAdvisorName: str(campRes, 'trainingAdvisorName'),
    address: {
      name: str(campRes, 'addressName'),
      street: str(campRes, 'addressStreet'),
      zipcode: str(campRes, 'addressZipcode'),
      city: str(campRes, 'addressCity'),
    },
    isPrototype: campRes.isPrototype === true,
    hitobitoEventId: idLike(campRes.hitobitoEventId),
    hitobitoProvider: idLike(campRes.hitobitoProvider),
    start: periods.length ? periods[0].start : null,
    end: periods.length ? periods.map((p) => p.end).sort().at(-1)! : null,
  }

  return {
    schemaVersion: 1,
    loadedAt: new Date().toISOString(),
    instanceBaseUrl: options.instanceBaseUrl ?? null,
    userIri: options.userIri ?? null,
    camp,
    periods,
    days,
    scheduleEntries,
    activities,
    categories,
    collaborators,
    dayResponsibles,
    activityResponsibles,
    progressLabels,
    comments,
  }
}

function uniqueBy<T>(list: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>()
  return list.filter((t) => {
    const k = key(t)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ---------------------------------------------------------------------------------------------
// Meine Lager
// ---------------------------------------------------------------------------------------------

/** "Meine Lager": camps the user collaborates on (`/api/camps?campCollaborator={userIri}`) incl. dates + own role. */
export async function loadCampList(apiGet: ApiGet, userIri: Iri): Promise<CampListEntry[]> {
  const camps = await fetchAll(apiGet, `/api/camps?campCollaborator=${enc(userIri)}`)
  const entries = await Promise.all(
    camps.map(async (c): Promise<CampListEntry | null> => {
      const iri = selfHref(c)
      if (!iri) return null
      let periodRes = embeddedList(c, 'periods')
      const [role, fetched] = await Promise.all([
        fetchAll(apiGet, `/api/camp_collaborations?camp=${enc(iri)}`)
          .then((list) => {
            const mine = list.find((x) => linkHref(x, 'user') === userIri)
            return mine ? toRole(mine.role) : null
          })
          .catch(() => null),
        periodRes.length
          ? Promise.resolve(null)
          : fetchAll(apiGet, `/api/periods?camp=${enc(iri)}`).catch(() => [] as HalResource[]),
      ])
      if (fetched) periodRes = fetched
      const periods = periodRes.map(toPeriod).filter((p): p is PeriodFact => p !== null)
      return {
        iri,
        id: idFromIri(iri),
        title: str(c, 'title') ?? '',
        shortTitle: str(c, 'shortTitle'),
        motto: str(c, 'motto'),
        start: periods.length ? periods.map((p) => p.start).sort()[0] : null,
        end: periods.length ? periods.map((p) => p.end).sort().at(-1)! : null,
        role,
        isPrototype: c.isPrototype === true,
      }
    }),
  )
  return entries
    .filter((e): e is CampListEntry => e !== null)
    .sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''))
}

// ---------------------------------------------------------------------------------------------
// Category guessing
// ---------------------------------------------------------------------------------------------

interface Rule {
  re: RegExp
  cls: CategoryClass
  confidence: 'high' | 'low'
  reason: string
}

/** Ordered: first match wins. Matched against lower-cased "short name". */
const NAME_RULES: Rule[] = [
  { re: /lagersport/, cls: 'LS', confidence: 'high', reason: 'name:lagersport' },
  { re: /lageraktivit/, cls: 'LA', confidence: 'high', reason: 'name:lageraktivität' },
  { re: /lagerprogramm/, cls: 'LP', confidence: 'high', reason: 'name:lagerprogramm' },
  {
    re: /(^|[^a-zäöü])(essen|mahlzeit|mittagessen|abendessen|nachtessen|frühstück|fruehstueck|zmorge|znacht|znüni|znueni|zvieri|zmittag|verpflegung|kochen|küche|kueche)/,
    cls: 'ES',
    confidence: 'high',
    reason: 'name:essen',
  },
  {
    re: /(ski|snowboard|sport|wander|hike|trekking|schwimm|biken|velo|klettern|kanu|lauf|rennen|fussball|fussbal|turnen|eishockey|schlittschuh|langlauf|schneeschuh|rudern|paddeln|segeln)/,
    cls: 'LS',
    confidence: 'low',
    reason: 'name:sport',
  },
  {
    re: /(freizeit|pause|frei|ruhe|schlaf|nachtruhe|anreise|abreise|reise|transport|ämtli|aemtli|lagerplatz|aufstehen|morgenturnen|sozialzeit)/,
    cls: 'NONE',
    confidence: 'low',
    reason: 'name:frei',
  },
  {
    re: /(spiel|bastel|workshop|werk|theater|basteln|singen|lagerfeuer|geländespiel|gelaendespiel|pionier|programm|aktivit)/,
    cls: 'LA',
    confidence: 'low',
    reason: 'name:aktivität',
  },
]

/**
 * Auto-guess the J+S class per category from short/name (LS/LA/LP/ES keywords) and, as a tie-breaker,
 * the YSActivityCharacteristics of the activities in that category. Returns one guess per category.
 *
 * Reasoning (documented in `reason`):
 *  - short is exactly LS/LA/LP/ES (any case)        -> high, 'short:XX'
 *  - name keywords (see NAME_RULES)                  -> 'name:...' (high for the J+S terms, low for sports/free-time hints)
 *  - no keyword but activities carry YS characteristics or a physical-activity duration -> LS, low, 'ys-characteristics'
 *  - otherwise                                       -> LP, low, 'default' (does not count as a J+S unit, coach confirms)
 */
export function guessCategories(categories: CategoryFact[], activities: ActivityFact[]): CategoryGuess[] {
  return categories.map((cat) => {
    const short = cat.short.trim().toUpperCase()
    if (short === 'LS' || short === 'LA' || short === 'LP' || short === 'ES') {
      return { categoryIri: cat.iri, guess: short, confidence: 'high', reason: `short:${short}` }
    }
    const text = `${cat.short} ${cat.name}`.toLowerCase()
    for (const rule of NAME_RULES) {
      if (rule.re.test(text)) {
        return { categoryIri: cat.iri, guess: rule.cls, confidence: rule.confidence, reason: rule.reason }
      }
    }
    const inCat = activities.filter((a) => a.categoryIri === cat.iri)
    if (inCat.some((a) => a.content.ysCharacteristics.length > 0 || (a.content.ysPhysicalActivityDurationMinutes ?? 0) > 0)) {
      return { categoryIri: cat.iri, guess: 'LS', confidence: 'low', reason: 'ys-characteristics' }
    }
    return { categoryIri: cat.iri, guess: 'LP', confidence: 'low', reason: 'default' }
  })
}

/** Builds an unconfirmed mapping from guesses. */
export function mappingFromGuesses(campIri: Iri, guesses: CategoryGuess[], now: Date = new Date()): CategoryMapping {
  const entries: Record<Iri, CategoryClass> = {}
  for (const g of guesses) entries[g.categoryIri] = g.guess
  return { campIri, entries, confirmed: false, confirmedAt: null, updatedAt: now.toISOString() }
}

/** Class of a category under a mapping ('NONE' for unknown / null category). */
export function classOf(mapping: CategoryMapping | null, categoryIri: Iri | null): CategoryClass {
  if (!mapping || !categoryIri) return 'NONE'
  return mapping.entries[categoryIri] ?? 'NONE'
}
