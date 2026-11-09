/**
 * Dev-only browser mock of the Tauri IPC layer (UI QA without the native shell).
 * Loaded from main.ts only when `import.meta.env.DEV` and `?mock=1`; tree-shaken from production builds.
 */
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { emit } from '@tauri-apps/api/event'
import { mcpToolByName } from '@/domain/mcp/catalog'
import type { McpLogEntry, McpStatus, McpToolOutcome, McpToolRegistration } from '@/domain/mcp/types'
import { createDevCampApi, DEV_CAMP_IRI } from '@/__tests__/fixtures/devCampApi'
import { createPromoCampApi } from './promoCamp'

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
    leaders: Object.keys(roles).map((nickname) => {
      const qualifications = quals(nickname)
      const held = MOCK_HELD[nickname] ?? []
      return {
        nickname,
        ...roles[nickname],
        qualifications,
        roleLabels: nickname === 'Otter' ? [roles[nickname].roleLabel, 'Küche'] : [roles[nickname].roleLabel],
        expiredQualifications: [...new Set(held.filter((h) => h.expired).flatMap((h) => keysOf(h.label)))].filter((k) => !qualifications[k]),
        qualificationDetails: held
          .map((h) => ({ label: h.label, keys: keysOf(h.label), validAtCamp: !h.expired, finishAt: h.expired ? '2025-12-31' : null }))
          .sort((x, y) => x.label.localeCompare(y.label)),
      }
    }),
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

// ---- ADR 0012 mock: OpenAI-compatible key/models and the local MCP server --------------------------
function isLoopbackUrl(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}
function mockToken(seed: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < 43; i++) out += chars[(seed * 31 + i * 17 + (i % 7) * seed) % chars.length]
  return 'coco_' + out
}

declare global {
  interface Window {
    __cocoMockMcp?: {
      call(name: string, args: unknown): Promise<McpToolOutcome>
      results: { callId: string; name: string; outcome: McpToolOutcome }[]
      registered(): McpToolRegistration[]
    }
  }
}

function installMcpMock() {
  let running = false
  let port: number | null = null
  let tools: McpToolRegistration[] = []
  let tokenSeed = 1
  const log: McpLogEntry[] = []
  const pending = new Map<string, { name: string; kind: 'read' | 'write'; start: number; resolve: (o: McpToolOutcome) => void }>()
  let counter = 0
  const results: { callId: string; name: string; outcome: McpToolOutcome }[] = []

  const status = (): McpStatus => ({
    running,
    port: running ? port : null,
    url: running ? `http://127.0.0.1:${port}/mcp` : null,
    error: null,
    toolCount: tools.length,
    log: [...log],
  })
  const pushStatus = () => void emit('mcp://status', status())

  window.__cocoMockMcp = {
    call(name, args) {
      const callId = `mock-call-${++counter}`
      const kind = tools.find((t) => t.name === name)?.kind ?? mcpToolByName(name)?.kind ?? 'read'
      return new Promise<McpToolOutcome>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(callId)
          reject(new Error(`mock MCP call ${name} timed out`))
        }, 10_000)
        pending.set(callId, {
          name,
          kind,
          start: Date.now(),
          resolve: (o) => {
            clearTimeout(timer)
            resolve(o)
          },
        })
        void emit('mcp://tool-call', { callId, name, kind, arguments: args, deadlineMs: Date.now() + 55_000 })
      })
    },
    results,
    registered: () => tools,
  }

  return (cmd: string, a: Record<string, unknown>): { handled: boolean; value?: unknown } => {
    switch (cmd) {
      case 'mcp_status':
        return { handled: true, value: status() }
      case 'mcp_start':
        running = true
        port = Number(a.port)
        pushStatus()
        return { handled: true, value: status() }
      case 'mcp_stop':
        running = false
        port = null
        pushStatus()
        return { handled: true, value: status() }
      case 'mcp_set_tools':
        tools = (a.tools as McpToolRegistration[]) ?? []
        pushStatus()
        return { handled: true, value: null }
      case 'mcp_tool_result': {
        const p = pending.get(String(a.callId))
        if (!p) return { handled: true, value: null }
        pending.delete(String(a.callId))
        const outcome = a.outcome as McpToolOutcome
        results.push({ callId: String(a.callId), name: p.name, outcome })
        log.unshift({
          atMs: Date.now(),
          tool: p.name,
          kind: p.kind,
          ok: !outcome.isError,
          durationMs: Date.now() - p.start,
          error: outcome.isError ? outcome.text.slice(0, 80) : null,
        })
        if (log.length > 50) log.length = 50
        p.resolve(outcome)
        pushStatus()
        return { handled: true, value: null }
      }
      case 'mcp_get_token':
        return { handled: true, value: mockToken(tokenSeed) }
      case 'mcp_regenerate_token':
        tokenSeed += 1
        return { handled: true, value: mockToken(tokenSeed) }
      default:
        return { handled: false }
    }
  }
}

// Past camps for the "ended / older" filters: one ended ~1 month ago, one ended >3 months ago.
function withPastCamps(res: unknown): unknown {
  const list = res as { _embedded: { items: Record<string, unknown>[] }; totalItems?: number }
  const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
  const past = (id: string, title: string, startOff: number, endOff: number) => ({
    id,
    title,
    shortTitle: null,
    motto: null,
    isPrototype: false,
    _links: { self: { href: `/api/camps/${id}` } },
    _embedded: {
      periods: [{ id: `${id}p`, start: `${day(startOff)}T00:00:00+00:00`, end: `${day(endOff)}T00:00:00+00:00`, description: 'Lager', _links: { self: { href: `/api/periods/${id}p` } } }],
    },
  })
  const items = [...list._embedded.items, past('mockended01', 'Pfingstlager (abgeschlossen)', -38, -32), past('mockold0001', 'Sommerlager (älter)', -140, -130)]
  return { ...list, _embedded: { ...list._embedded, items }, totalItems: items.length }
}

export function installMockTauri(): void {
  ;(globalThis as unknown as { isTauri: boolean }).isTauri = true
  mockWindows('main')
  // `?scenario=promo` swaps the eCamp data for the invented summer camp used for the promo video.
  const params = new URLSearchParams(window.location.search)
  const api = params.get('scenario') === 'promo' ? createPromoCampApi() : createDevCampApi()
  let aiKey = false
  let dataKeyCreated = false
  // URL options for the storage harness: ?loggedout=1 starts without a session, ?keylost=1 hands out a different data key.
  let loggedIn = params.get('loggedout') !== '1'
  const keyLost = params.get('keylost') === '1'
  let openaiKeyOrigin: string | null = null
  const mcpMock = installMcpMock()
  let midataConnected = true
  let midataMethod: 'session' | 'token' = 'session'
  let ndsConnected = true
  mockIPC(
    async (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>
      if (cmd.startsWith('mcp_')) {
        const r = mcpMock(cmd, a)
        if (r.handled) return r.value
      }
      switch (cmd) {
        case 'session_status':
          return loggedIn ? session() : null
        case 'password_login':
          loggedIn = true
          return session()
        case 'refresh_session':
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
          loggedIn = false
          return null
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
          if (clean.startsWith('/api/camps?')) return withPastCamps(await api.apiGet(path))
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
        case 'midata_find_self':
          return { personId: '4711', nickname: 'Falk', count: 1 }
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
        case 'persons_load_midata':
          return mockMidataPersons(String(a.eventId))
        case 'persons_load_nds':
          return mockNdsPersons(String(a.ndsCampId))
        case 'persons_clear':
          return null
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
        case 'unlock_data_store': {
          // Fixed test key (32 bytes of 0x01..0x20), created:true only on the first call.
          const created = !dataKeyCreated
          dataKeyCreated = true
          return { key: keyLost ? 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=' : 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=', created }
        }
        case 'lock_data_store':
          return null
        case 'ai_openai_set_key':
          openaiKeyOrigin = originOf(String(a.baseUrl))
          return null
        case 'ai_openai_has_key':
          return openaiKeyOrigin !== null && openaiKeyOrigin === originOf(String(a.baseUrl))
        case 'ai_openai_clear_key':
          openaiKeyOrigin = null
          return null
        case 'ai_openai_models': {
          const url = String(a.baseUrl)
          if (isLoopbackUrl(url)) return ['llama3.1:8b', 'mistral:7b', 'qwen2.5:7b']
          if (!url.startsWith('https://')) throw 'Die Adresse muss https verwenden (http nur für localhost).'
          return ['gpt-4o-mini', 'gpt-4o']
        }
        default:
          if (cmd.startsWith('plugin:')) return null
          throw `Mock: Befehl nicht implementiert: ${cmd}`
      }
    },
    { shouldMockEvents: true },
  )
}

// ---- «Personen» tab mocks (ADR 0009). SYNTHETIC people only (invented names, no real data).
function mockMidataPersons(eventId: string) {
  const none = { lagerleiter: 'none', leiterLsT: 'none', wasser: 'none', berg: 'none', winter: 'none', slrg: 'none' }
  const row = (
    id: string,
    firstName: string,
    lastName: string,
    nickname: string | null,
    birthDate: string | null,
    gender: string | null,
    kind: string,
    roleLabels: string[],
    qualifications: Record<string, string> = {},
  ) => ({ __red: true as const, id, firstName, lastName, nickname, birthDate, gender, kind, roleLabels, qualifications })
  return {
    __red: true as const,
    eventId,
    qualificationsReadable: true,
    fetchedAt: new Date().toISOString(),
    persons: [
      row('9001', 'Anna', 'Muster', 'Wiesel', '2012-05-04', 'w', 'participant', ['Teilnehmer/in']),
      row('9002', 'Ben', 'Beispiel', null, '2011-09-09', 'm', 'participant', ['Teilnehmer/in']),
      row('9003', 'Jörg', 'Müller', 'Jöri', '2010-11-30', 'm', 'participant', ['Teilnehmer/in']),
      row('9004', 'Clara', 'Fehlt', null, '2013-02-14', 'w', 'participant', ['Teilnehmer/in']),
      row('9005', 'Lena', 'Zwilling', null, '2012-03-03', 'w', 'participant', ['Teilnehmer/in']),
      row('9006', 'Dora', 'Leiter', 'Falke', '1996-04-01', 'w', 'leader', ['Hauptleitung'], {
        ...none,
        lagerleiter: 'valid',
        leiterLsT: 'valid',
      }),
      row('9007', 'Emil', 'Experte', 'Emu', '1999-08-12', 'm', 'leader', ['Leitung'], {
        ...none,
        lagerleiter: 'invalid',
        leiterLsT: 'valid',
        wasser: 'valid',
      }),
      row('9008', 'Fritz', 'Küchlin', null, '1985-06-06', 'm', 'kitchen', ['Küche']),
      row('guest:77', 'Gustav', 'Gast', null, null, null, 'guest', ['Gast']),
    ],
  }
}

function mockNdsPersons(ndsCampId: string) {
  const row = (
    id: string,
    personNumber: string | null,
    firstName: string,
    lastName: string,
    birthDate: string | null,
    kind: 'participant' | 'leader',
    roleLabel: string | null,
  ) => ({ __red: true as const, id, personNumber, firstName, lastName, birthDate, kind, roleLabel })
  return {
    __red: true as const,
    ndsCampId,
    fetchedAt: new Date().toISOString(),
    persons: [
      row('5001', '100001', 'Anna', 'Muster', '2012-05-04', 'participant', 'CHILD'),
      row('5002', '100002', 'Ben', 'Beispiel', '2011-09-19', 'participant', 'CHILD'),
      row('5003', '100003', 'Joerg', 'Mueller', '2010-11-30', 'participant', 'ADOLESCENT'),
      row('5004', '100004', 'Lena', 'Zwilling', '2012-01-01', 'participant', 'CHILD'),
      row('5005', '100005', 'Lena', 'Zwilling', '2012-02-02', 'participant', 'CHILD'),
      row('5006', '100006', 'Olga', 'Nurnds', '2012-12-12', 'participant', 'CHILD'),
      row('5101', '100101', 'Dora', 'Leiter', '1996-04-01', 'leader', 'MAIN_SUPERVISOR'),
      row('5102', '100102', 'Emil', 'Experte', '1999-08-12', 'leader', 'SUPERVISOR'),
    ],
  }
}
