import { describe, expect, it } from 'vitest'
import { messages } from '../../locales/messages'
import {
  buildSpikeReport,
  describeOs,
  emptyResults,
  redactIdentifiers,
  redactSecrets,
  type ReportInput,
  type Translate,
} from '../report'

// Minimal translator over de.json (named params, first plural form not needed here).
const t: Translate = (key, params) => {
  let node: unknown = messages.de
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') return key
  return node.replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`))
}

const WIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0'

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  const results = emptyResults()
  results.loginWindowOpened = { status: 'ok', at: Date.UTC(2026, 10, 7, 10, 0, 0), detail: null }
  results.cookiesFound = { status: 'ok', at: Date.UTC(2026, 10, 7, 10, 1, 0), detail: 'app_ecamp3_ch_jwt_hp, app_ecamp3_ch_jwt_s' }
  results.refreshOk = { status: 'failed', at: Date.UTC(2026, 10, 7, 10, 2, 0), detail: 'HTTP 401 | denied' }
  return {
    generatedAt: Date.UTC(2026, 10, 7, 10, 5, 0),
    appVersion: '0.1.0',
    userAgent: WIN_UA,
    instance: { baseUrl: 'https://app.ecamp3.ch', apiRoot: 'https://app.ecamp3.ch/api', version: '2f065a3' },
    method: 'webview',
    cookieNames: ['app_ecamp3_ch_jwt_hp', 'app_ecamp3_ch_jwt_s', 'app_ecamp3_ch_refresh_token'],
    roles: ['ROLE_USER'],
    tokenExp: Date.UTC(2026, 10, 7, 11, 0, 0) / 1000,
    campsCount: 3,
    results,
    logs: [
      { at: Date.UTC(2026, 10, 7, 10, 0, 0), source: 'rust', step: 'login-window-opened', ok: true, detail: null },
      { at: Date.UTC(2026, 10, 7, 10, 1, 0), source: 'rust', step: 'cookies', ok: true, detail: '3 cookies' },
    ],
    ...overrides,
  }
}

describe('describeOs', () => {
  it('detects common platforms', () => {
    expect(describeOs(WIN_UA)).toBe('Windows 10/11')
    expect(describeOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')).toBe('macOS 10.15.7')
    expect(describeOs('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15')).toBe('Linux')
    expect(describeOs('')).toBeNull()
  })
})

describe('redactSecrets', () => {
  it('removes JWT-like strings and cookie values', () => {
    expect(redactSecrets('token eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjF9.abc_def end')).toBe('token [redacted] end')
    expect(redactSecrets('app_ecamp3_ch_refresh_token=0123abcdef; Path=/')).toBe('app_ecamp3_ch_refresh_token=[redacted]; Path=/')
    expect(redactSecrets('jwt_s: xyz')).toBe('jwt_s: [redacted]')
    expect(redactSecrets('a'.repeat(10) + ' ' + 'f'.repeat(64))).toBe('aaaaaaaaaa [redacted]')
  })

  it('redactIdentifiers keeps non-id path segments', () => {
    expect(redactIdentifiers('/api/camps/xyz789abc0de/periods')).toBe('/api/camps/[id]/periods')
    expect(redactIdentifiers('/api/camps')).toBe('/api/camps')
    expect(redactIdentifiers('/api/authentication_token')).toBe('/api/authentication_token')
  })

  it('keeps plain cookie names', () => {
    expect(redactSecrets('app_ecamp3_ch_jwt_hp, app_ecamp3_ch_jwt_s')).toBe('app_ecamp3_ch_jwt_hp, app_ecamp3_ch_jwt_s')
  })
})

describe('buildSpikeReport', () => {
  it('produces a German markdown report with metadata, results and log', () => {
    const md = buildSpikeReport(input(), t)
    expect(md).toContain('## co-co M0 Login-Spike – Ergebnis')
    expect(md).toContain('- **Betriebssystem:** Windows 10/11')
    expect(md).toContain('- **App-Version:** 0.1.0')
    expect(md).toContain('- **Instanz:** https://app.ecamp3.ch')
    expect(md).toContain('- **eCamp-Version:** 2f065a3')
    expect(md).toContain('- **Methode:** eCamp-Anmeldefenster')
    expect(md).toContain('`app_ecamp3_ch_refresh_token`')
    expect(md).toContain('- **Token-Ablauf:** 2026-11-07T11:00:00.000Z')
    expect(md).toContain('- **Anzahl Lager:** 3')
    expect(md).toContain('| Anmeldefenster geöffnet | ✅ erfolgreich | 2026-11-07T10:00:00.000Z |  |')
    expect(md).toContain('| Token-Erneuerung erfolgreich | ❌ fehlgeschlagen | 2026-11-07T10:02:00.000Z | HTTP 401 \\| denied |')
    expect(md).toContain('| Lager geladen | ⏳ offen | – |  |')
    expect(md).toContain('2026-11-07T10:01:00.000Z [rust] OK   cookies – 3 cookies')
  })

  it('never leaks token-like values from log details', () => {
    const md = buildSpikeReport(
      input({
        logs: [{ at: 0, source: 'rust', step: 'cookies', ok: false, detail: 'jwt_hp=eyJ0eXAiOiJKV1QifQ.eyJleHAiOjF9' }],
      }),
      t,
    )
    expect(md).not.toContain('eyJ')
    expect(md).toContain('[redacted]')
  })

  it('never contains user/camp/profile ids from IRIs', () => {
    const results = emptyResults()
    results.apiCallOk = { status: 'ok', at: 0, detail: '/api/users/1a2b3c4d5e6f' }
    const md = buildSpikeReport(
      input({
        results,
        logs: [
          { at: 0, source: 'rust', step: 'session-stored', ok: true, detail: 'Benutzer /api/users/1a2b3c4d5e6f, exp=1' },
          { at: 0, source: 'ui', step: 'api-get-activities', ok: true, detail: '/api/activities?camp=/api/camps/abcdef123456: 4' },
          { at: 0, source: 'ui', step: 'x', ok: true, detail: 'https://app.ecamp3.ch/api/profiles/deadbeefcafe' },
          { at: 0, source: 'rust', step: 'refresh-start', ok: true, detail: 'POST /api/token/refresh' },
          { at: 0, source: 'rust', step: 'navigation', ok: true, detail: 'https://app.ecamp3.ch/api/auth/pbsmidata/callback' },
        ],
      }),
      t,
    )
    for (const id of ['1a2b3c4d5e6f', 'abcdef123456', 'deadbeefcafe']) expect(md).not.toContain(id)
    expect(md).toContain('/api/users/[id]')
    expect(md).toContain('camp=/api/camps/[id]')
    expect(md).toContain('/api/profiles/[id]')
    // endpoint paths stay readable
    expect(md).toContain('POST /api/token/refresh')
    expect(md).toContain('/api/auth/pbsmidata/callback')
  })

  it('handles an empty run', () => {
    const md = buildSpikeReport(
      input({ instance: null, method: null, cookieNames: [], roles: [], tokenExp: null, campsCount: null, logs: [], userAgent: '', results: emptyResults() }),
      t,
    )
    expect(md).toContain('- **Methode:** –')
    expect(md).toContain('- **Betriebssystem:** unbekannt')
    expect(md).toContain('_Keine Ereignisse aufgezeichnet._')
  })
})
