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

function midataAggregate(eventId: string, campStart: string, campEnd: string, coachPersonId: string | null) {
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
    leaders: [
      { nickname: 'Falk', roleLabel: 'Lagerleiter', mainLeader: true, qualifications: Q(true, true, false, true, false, false) },
      { nickname: 'Otter', roleLabel: 'Leiter', qualifications: Q(false, true, true, false, false, true) },
      { nickname: 'Mungo', roleLabel: 'Leiter', qualifications: Q(false, true, false, true, true, false) },
      { nickname: 'Kiwi', roleLabel: 'Leiterin', qualifications: Q(false, false, false, false, false, false) },
      { nickname: 'Pixel', roleLabel: 'Hilfsleitung', qualifications: Q(false, false, false, false, false, false) },
    ],
    coachMatch: coachPersonId ? coachPersonId === '4711' : null,
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
          return await api.apiGet(path)
        }
        case 'api_post_comment':
          return {
            id: 'mockcomment1',
            _links: {
              self: { href: '/api/comments/mockcomment1' },
              activity: { href: a.activityIri as string },
              camp: { href: (a.campIri as string) ?? DEV_CAMP_IRI },
            },
            textHtml: a.textHtml,
          }
        case 'api_patch_comment':
          return { id: 'mockcomment1', _links: {}, ...(a.patch as object) }
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
          return midataAggregate(String(a.eventId), String(a.campStart), String(a.campEnd), (a.coachPersonId as string | null) ?? null)
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
