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

export function installMockTauri(): void {
  ;(globalThis as unknown as { isTauri: boolean }).isTauri = true
  mockWindows('main')
  const api = createDevCampApi()
  let aiKey = false
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
