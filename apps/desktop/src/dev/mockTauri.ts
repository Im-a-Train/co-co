/**
 * Dev-only browser mock of the Tauri IPC layer (UI QA without the native shell).
 * Loaded from main.ts only when `import.meta.env.DEV` and `?mock=1`; tree-shaken from production builds.
 */
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { createDevCampApi, DEV_CAMP_IRI } from '@/__tests__/fixtures/devCampApi'

const USER_IRI = '/api/users/9145944210a7'

function b64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)))
}

const GPX = `<?xml version="1.0"?><gpx version="1.1" creator="mock"><trk><name>Wanderung Bergtour</name><trkseg>
<trkpt lat="46.80" lon="8.20"><ele>1200</ele></trkpt><trkpt lat="46.82" lon="8.22"><ele>1800</ele></trkpt></trkseg></trk></gpx>`
const TXT = `Sicherheitskonzept Lager Auf in die Berge
Notfallnummern: Rega 1414, Sanitaet 144. Notfallkonzept: Treffpunkt beim Lagerhaus, Leiter Hans Muster 079 000 00 00.
Alternativprogramm bei schlechtem Wetter: Spielturnier im Haus. Wanderrouten werden vor Ort geprueft.`

const files: Record<string, { name: string; text: string }> = {
  'C:/mock/route-bergtour.gpx': { name: 'route-bergtour.gpx', text: GPX },
  'C:/mock/sicherheitskonzept.txt': { name: 'sicherheitskonzept.txt', text: TXT },
}

// ---- Comment sync mock: comments posted through the mock come back from GET /api/comments with an
// invented answer (1st posted: direct reply + later unrelated comment; 2nd posted: resolved). ----------
interface PostedComment { id: string; activityIri: string; textHtml: string; createTime: string }
const postedComments: PostedComment[] = []

function withPostedComments(res: unknown): unknown {
  const body = res as { _embedded?: { items?: unknown[] }; totalItems?: number }
  const items = (body._embedded?.items ?? (body._embedded = { items: [] }).items) as unknown[]
  const iso = (offsetSec: number, base: string) => new Date(new Date(base).getTime() + offsetSec * 1000).toISOString()
  postedComments.forEach((c, i) => {
    const iri = `/api/comments/${c.id}`
    const camp = { href: DEV_CAMP_IRI }
    items.push({
      _links: { self: { href: iri }, camp, activity: { href: c.activityIri }, parent: null, author: { href: USER_IRI }, resolvedBy: i === 1 ? { href: USER_IRI } : null },
      authorDisplayName: 'Test Coach',
      textHtml: c.textHtml,
      resolvedAt: i === 1 ? iso(3600, c.createTime) : null,
      id: c.id,
      createTime: c.createTime,
    })
    if (i === 0) {
      items.push({
        _links: { self: { href: `/api/comments/${c.id}-reply` }, camp, activity: { href: c.activityIri }, parent: { href: iri }, author: { href: '/api/camp_collaborations/mockanna' } },
        authorDisplayName: 'Anna Beispiel',
        textHtml: '<p>Danke für den Hinweis! Wir ergänzen das bis morgen.</p>',
        resolvedAt: null,
        id: `${c.id}-reply`,
        createTime: iso(1800, c.createTime),
      })
      items.push({
        _links: { self: { href: `/api/comments/${c.id}-later` }, camp, activity: { href: c.activityIri }, parent: null, author: { href: '/api/camp_collaborations/mockben' } },
        authorDisplayName: 'Ben Muster',
        textHtml: '<p>Ist erledigt, bitte nochmals anschauen.</p>',
        resolvedAt: null,
        id: `${c.id}-later`,
        createTime: iso(7200, c.createTime),
      })
    }
  })
  body.totalItems = items.length
  return body
}

function session() {
  const now = Math.floor(Date.now() / 1000)
  return {
    baseUrl: 'https://dev.ecamp3.ch',
    apiRoot: 'https://dev.ecamp3.ch/api',
    method: 'password',
    userIri: USER_IRI,
    exp: now + 3600,
    roles: ['ROLE_USER'],
    cookieNames: ['localhost_jwt_hp', 'localhost_jwt_s'],
    obtainedAt: now,
  }
}


// ---- MiData (M7) mock: invented aggregate, no real persons -------------------------------------
const Q = (lagerleiter: boolean, leiterLsT: boolean, wasser: boolean, berg: boolean, winter: boolean, slrg: boolean) => ({
  lagerleiter,
  leiterLsT,
  wasser,
  berg,
  winter,
  slrg,
})
/** Invented MiData camps of three organisations: exact match, partial overlap, no overlap. */
function midataEvents(campStart: string, campEnd: string) {
  const shift = (iso: string, days: number): string => {
    const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }
  const len = Math.round((Date.parse(campEnd.slice(0, 10)) - Date.parse(campStart.slice(0, 10))) / 86_400_000) + 1
  return [
    { id: '4101', name: 'Sommerlager Musterstufe', startAt: campStart.slice(0, 10), finishAt: campEnd.slice(0, 10), location: 'Musterhausen', groupNames: ['Abteilung Musterhausen'], overlapDays: len },
    { id: '4102', name: 'Pfingstlager Beispielabteilung', startAt: shift(campEnd, -1), finishAt: shift(campEnd, 6), location: 'Beispieldorf', groupNames: ['Abteilung Beispieldorf', 'Region Beispiel'], overlapDays: 2 },
    { id: '4103', name: 'Herbstlager Testwald', startAt: shift(campEnd, 8), finishAt: shift(campEnd, 12), location: 'Testwald', groupNames: ['Pfadi Testwald'], overlapDays: 0 },
  ]
}

/** Built-in label mapping of the mock (the real one lives in Rust). */
const MOCK_BUILTIN: Record<string, string[]> = {
  Lagerleiter: ['lagerleiter'],
  'J+S Leiter LS/T': ['leiterLsT'],
  Wassersicherheit: ['wasser'],
  'SLRG Brevet': ['slrg'],
  Bergsicherheit: ['berg'],
  Winterlager: ['winter'],
  'J+S-Coach': [],
}
/** Invented qualifications per leader: label + whether it is expired. */
const MOCK_HELD: Record<string, { label: string; expired?: boolean }[]> = {
  Falk: [{ label: 'Lagerleiter' }, { label: 'J+S Leiter LS/T' }, { label: 'SLRG Brevet' }],
  Otter: [{ label: 'J+S Leiter LS/T' }, { label: 'Wassersicherheit' }, { label: 'SLRG Brevet' }],
  Mungo: [{ label: 'J+S Leiter LS/T' }, { label: 'Bergsicherheit' }, { label: 'Winterlager' }],
  Kiwi: [{ label: 'Wassersicherheit', expired: true }],
  Pixel: [{ label: 'J+S-Coach' }],
}

function midataAggregate(
  eventId: string,
  campStart: string,
  campEnd: string,
  coachPersonId: string | null,
  qualMapping: Record<string, string[]> | null,
) {
  const keysOf = (label: string): string[] =>
    qualMapping && Object.prototype.hasOwnProperty.call(qualMapping, label) ? qualMapping[label] : (MOCK_BUILTIN[label] ?? [])
  const quals = (nick: string) => {
    const out = Q(false, false, false, false, false, false) as Record<string, boolean>
    for (const h of MOCK_HELD[nick] ?? []) if (!h.expired) for (const k of keysOf(h.label)) out[k] = true
    return out
  }
  const roles: Record<string, { roleLabel: string; mainLeader?: boolean }> = {
    Falk: { roleLabel: 'Lagerleiter', mainLeader: true },
    Otter: { roleLabel: 'Leiter' },
    Mungo: { roleLabel: 'Leiter' },
    Kiwi: { roleLabel: 'Leiterin' },
    Pixel: { roleLabel: 'Hilfsleitung' },
  }
  const kinds = Object.keys(MOCK_BUILTIN).map((label) => {
    const held = Object.values(MOCK_HELD).flat().filter((h) => h.label === label)
    return {
      label,
      keys: keysOf(label),
      validLeaders: held.filter((h) => !h.expired).length,
      expiredLeaders: held.filter((h) => h.expired).length,
    }
  })
  return {
    zone: 'red-derived' as const,
    baseUrl: 'https://db.scout.ch',
    eventId,
    eventName: 'Sommerlager Musterstufe',
    eventDates: [{ startAt: campStart, finishAt: campEnd }],
    location: 'Musterhausen',
    maximumParticipants: 30,
    participantsCount: 24,
    participantsJsAgeCount: 23,
    participantsWithoutBirthday: 1,
    minAge: 9,
    maxAge: 14,
    ageBands: [
      { from: 9, to: 10, count: 8 },
      { from: 11, to: 12, count: 10 },
      { from: 13, to: 14, count: 6 },
    ],
    leadersCount: 5,
    leaders: Object.keys(roles).map((nickname) => ({ nickname, ...roles[nickname], qualifications: quals(nickname) })),
    coachMatch: coachPersonId ? coachPersonId === '4711' : null,
    coachNickname: 'Falk',
    qualificationsReadable: true,
    qualificationKinds: kinds,
    fetchedAt: new Date().toISOString(),
  }
}

// ---- NDS (M8) mock: invented aggregate, no real persons ----------------------------------------
function ndsAggregate(offerBusinessId: string, campBusinessId: string) {
  const counts = (n: number) => ({
    children: n - 6,
    adolescents: 6,
    totalParticipants: n,
    totalInstructors: 5,
    jsInstructors: 4,
    campDays: 7,
    totalActivities: 14,
  })
  return {
    offerBusinessId,
    campBusinessId,
    offerNumber: '999001',
    start: '2026-07-12',
    end: '2026-07-18',
    offerState: 'WAITING_FOR_ASSESSMENT',
    offerItemState: 'WAITING_FOR_ASSESSMENT',
    approvedOn: '2026-05-03',
    statistics: { planned: counts(26), actual: counts(24), coachAuthorizedForContribution: true },
    supervisorCounts: { HEAD_OF_CAMP: 1, JS_INSTRUCTOR: 4 },
    participantCount: 24,
    participantCountsByAudience: { CHILD: 18, ADOLESCENT: 6 },
    activities: {
      total: 14,
      byState: { ATTENDANCE_CHECKED: 12, ATTENDANCE_OPEN: 2 },
      byType: { FIRST_CAMP_DAY: 1, CAMP_DAY_WITH_YOUTH_SPORT_ACTIVITIES: 5, LAST_CAMP_DAY: 1 },
      lastActivityDate: '2026-07-18',
      attendanceOpenCount: 2,
    },
    campAgendaUploaded: true,
    rentalOrders: [{ orderState: 'FINISHED', dispatchmentDate: '2026-07-08', returnDate: '2026-07-20' }],
    fetchedAt: new Date().toISOString(),
  }
}

export function installMockTauri(): void {
  ;(globalThis as unknown as { isTauri: boolean }).isTauri = true
  mockWindows('main')
  const api = createDevCampApi()
  let aiKey = false
  let midataConnected = true
  let midataMethod: 'session' | 'token' = 'session'
  let ndsConnected = true
  mockIPC(
    async (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>
      switch (cmd) {
        case 'session_status':
        case 'refresh_session':
        case 'password_login':
          return session()
        case 'discover_instance':
          return {
            baseUrl: String(a.baseUrl ?? 'https://dev.ecamp3.ch'),
            apiRoot: 'https://dev.ecamp3.ch/api',
            cookiePrefix: 'localhost_',
            featureComments: true,
            version: 'mock',
            oauthProviders: ['pbs', 'google'],
          }
        case 'logout':
        case 'open_login_window':
        case 'watch_folder':
        case 'unwatch_folder':
          return null
        case 'api_get': {
          const path = String(a.path)
          const clean = decodeURIComponent(path)
          if (clean === USER_IRI)
            return {
              id: '9145944210a7',
              displayName: 'Test Coach',
              _links: { self: { href: USER_IRI }, profile: { href: '/api/profiles/9145944210a7' } },
            }
          if (clean.startsWith('/api/profiles'))
            return { nickname: 'Coach', firstname: 'Test', surname: 'Coach', email: 'coach@example.invalid', _links: {} }
          if (clean.startsWith('/api/users')) return { _embedded: { items: [] }, totalItems: 0, _links: {} }
          if (clean.startsWith('/api/comments?')) return withPostedComments(await api.apiGet(path))
          return await api.apiGet(path)
        }
        case 'api_post_comment': {
          const n = postedComments.length + 1
          postedComments.push({ id: `mockcomment${n}`, activityIri: a.activityIri as string, textHtml: String(a.textHtml ?? ''), createTime: new Date(Date.now() - 60_000).toISOString() })
          return {
            id: `mockcomment${n}`,
            _links: {
              self: { href: `/api/comments/mockcomment${n}` },
              activity: { href: a.activityIri as string },
              camp: { href: (a.campIri as string) ?? DEV_CAMP_IRI },
            },
            textHtml: a.textHtml,
          }
        }
        case 'api_patch_comment':
          return { id: 'mockcomment1', _links: {}, ...(a.patch as object) }
        case 'open_ecamp_url':
          return null
        case 'pick_files':
          return Object.keys(files)
        case 'pick_folder':
          return null
        case 'list_folder':
          return []
        case 'read_document': {
          const f = files[String(a.path)]
          if (!f) throw 'Datei nicht erlaubt'
          return { path: String(a.path), name: f.name, size: f.text.length, modifiedMs: Date.now(), bytesBase64: b64(f.text) }
        }
        case 'save_text_file':
          return `C:/mock/${String(a.defaultName)}`
        case 'open_text_file':
          return null
        case 'midata_status':
          return {
            connected: midataConnected,
            baseUrl: midataConnected ? 'https://db.scout.ch' : null,
            method: midataConnected ? midataMethod : null,
            cookieNames: midataConnected && midataMethod === 'session' ? ['_session_id'] : [],
            personId: midataConnected ? '4711' : null,
          }
        case 'midata_open_login':
          midataConnected = true
          midataMethod = 'session'
          return null
        case 'midata_set_token':
          midataConnected = true
          midataMethod = 'token'
          return { connected: true, baseUrl: String(a.baseUrl ?? 'https://db.scout.ch'), method: 'token', cookieNames: [] }
        case 'midata_logout':
          midataConnected = false
          return null
        case 'midata_find_events':
          return midataEvents(String(a.campStart ?? a.from), String(a.campEnd ?? a.to))
        case 'midata_fetch_aggregate':
          return midataAggregate(String(a.eventId), String(a.campStart), String(a.campEnd), (a.coachPersonId as string | null) ?? null, (a.qualMapping as Record<string, string[]> | null) ?? null)
        case 'midata_probe':
          return {
            authMethod: midataMethod,
            eventStatus: 200,
            participationsStatus: 200,
            participationsReadable: true,
            peopleBirthdayReadable: true,
            qualificationsStatus: 200,
            classicJsonStatus: 200,
            pbsFieldsPresent: ['coach_id', 'expected_participants_pio'],
            classicAttributeNames: ['name', 'motto', 'location', 'maximum_participants', 'state'],
          }
        case 'nds_status':
          return { connected: ndsConnected, cookieNames: ndsConnected ? ['SESSION', 'cookiesession1', 'LANG'] : [] }
        case 'nds_open_login':
          ndsConnected = true
          return null
        case 'nds_logout':
          ndsConnected = false
          return null
        case 'nds_find_camps':
          return [
            {
              offerBusinessId: 'offer-9001',
              campBusinessId: 'camp-9001',
              offerNumber: '999001',
              offerItemNumber: '1',
              groupName: 'Musterstufe',
              start: String(a.from),
              end: String(a.to),
              offerState: 'WAITING_FOR_ASSESSMENT',
              offerItemState: 'WAITING_FOR_ASSESSMENT',
            },
            {
              offerBusinessId: 'offer-9002',
              campBusinessId: 'camp-9002',
              offerNumber: '999002',
              offerItemNumber: '2',
              groupName: 'Beispielabteilung',
              start: String(a.from),
              end: String(a.from),
              offerState: 'SOME_NEW_STATE',
              offerItemState: null,
            },
          ]
        case 'nds_fetch_aggregate':
          return ndsAggregate(String(a.offerBusinessId), String(a.campBusinessId))
        case 'nds_probe':
          return {
            connected: ndsConnected,
            endpoints: [
              { name: 'camp details', status: 200, fieldsPresent: ['offerItemState', 'approvalTimestamp', 'duration'], fieldsMissing: ['riskActivitiesPlanned'] },
              { name: 'camp statistics', status: 200, fieldsPresent: ['numberOfChildren', 'totalNumberOfParticipants'], fieldsMissing: [] },
              { name: 'activities', status: 200, fieldsPresent: ['activityType', 'activityState', 'activityDate'], fieldsMissing: [] },
            ],
          }
        case 'ai_has_key':
          return aiKey
        case 'ai_set_key':
          aiKey = true
          return null
        case 'ai_clear_key':
          aiKey = false
          return null
        default:
          if (cmd.startsWith('plugin:')) return null
          throw `Mock: Befehl nicht implementiert: ${cmd}`
      }
    },
    { shouldMockEvents: true },
  )
}
