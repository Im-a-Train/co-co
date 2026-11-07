/**
 * Markdown report of the M0 login spike. The user pastes it into the GitHub
 * issue / ADR. It must never contain cookie values or tokens.
 */
import type { LoginMethod } from './tauri'

export type ResultKey = 'loginWindowOpened' | 'cookiesFound' | 'apiCallOk' | 'refreshOk' | 'campsLoaded'
export const RESULT_KEYS: readonly ResultKey[] = ['loginWindowOpened', 'cookiesFound', 'apiCallOk', 'refreshOk', 'campsLoaded']

export type ResultStatus = 'pending' | 'ok' | 'failed'

export interface SpikeResult {
  status: ResultStatus
  /** epoch ms of the last status change */
  at: number | null
  detail: string | null
}

export type SpikeResults = Record<ResultKey, SpikeResult>

export interface SpikeLogEntry {
  at: number
  source: 'rust' | 'ui'
  step: string
  ok: boolean
  detail: string | null
}

export interface ReportInput {
  generatedAt: number
  appVersion: string
  userAgent: string
  instance: { baseUrl: string; apiRoot: string | null; version: string | null } | null
  method: LoginMethod | null
  cookieNames: string[]
  roles: string[]
  tokenExp: number | null
  campsCount: number | null
  results: SpikeResults
  logs: SpikeLogEntry[]
}

export type Translate = (key: string, params?: Record<string, unknown>) => string

export function emptyResults(): SpikeResults {
  const r = {} as SpikeResults
  for (const k of RESULT_KEYS) r[k] = { status: 'pending', at: null, detail: null }
  return r
}

/** Best-effort OS description from a user agent string. */
export function describeOs(userAgent: string): string | null {
  const ua = userAgent || ''
  const win = /Windows NT (\d+\.\d+)/.exec(ua)
  if (win) return win[1] === '10.0' ? 'Windows 10/11' : `Windows NT ${win[1]}`
  const mac = /Mac OS X (\d+[._]\d+(?:[._]\d+)?)/.exec(ua)
  if (mac) return `macOS ${mac[1].replace(/_/g, '.')}`
  if (/Macintosh/.test(ua)) return 'macOS'
  if (/Android/.test(ua)) return 'Android'
  if (/iPhone|iPad/.test(ua)) return 'iOS'
  if (/Linux/.test(ua)) return 'Linux'
  return null
}

/**
 * Defense in depth: redacts anything that looks like a JWT / long opaque
 * token or a `name=value` cookie pair before it lands in the report.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*){0,2}/g, '[redacted]')
    .replace(/((?:jwt_hp|jwt_s|refresh_token)\s*[=:]\s*)[^\s;,"']+/gi, '$1[redacted]')
    .replace(/\b[A-Fa-f0-9]{40,}\b/g, '[redacted]')
}

/** An eCamp entity id segment: contains a digit, or is a long hex string. */
function looksLikeId(segment: string): boolean {
  return /\d/.test(segment) || /^[0-9a-f]{8,}$/i.test(segment)
}

/**
 * Replaces entity ids in eCamp IRIs (`/api/users/1a2b3c4d5e6f` ->
 * `/api/users/[id]`). IRIs are stable personal identifiers and the report
 * is meant for a public GitHub issue. Endpoint paths such as
 * `/api/token/refresh` or `/api/auth/pbsmidata` are kept.
 */
export function redactIdentifiers(text: string): string {
  return text.replace(/(\/api\/[A-Za-z][A-Za-z_-]*)\/([A-Za-z0-9_-]+)/g, (match, prefix: string, segment: string) =>
    looksLikeId(segment) ? `${prefix}/[id]` : match,
  )
}

/** Everything that goes into the report from free-form details. */
function sanitize(text: string): string {
  return redactIdentifiers(redactSecrets(text))
}

function iso(ms: number | null): string {
  return ms == null ? '–' : new Date(ms).toISOString()
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

export function buildSpikeReport(input: ReportInput, t: Translate): string {
  const icon = (s: ResultStatus) => (s === 'ok' ? '✅' : s === 'failed' ? '❌' : '⏳')
  const lines: string[] = []
  lines.push(`## ${t('report.title')}`)
  lines.push('')
  lines.push(`- **${t('report.generatedAt')}:** ${iso(input.generatedAt)}`)
  lines.push(`- **${t('report.appVersion')}:** ${input.appVersion}`)
  lines.push(`- **${t('report.os')}:** ${describeOs(input.userAgent) ?? t('common.unknown')}`)
  lines.push(`- **${t('report.userAgent')}:** \`${cell(input.userAgent)}\``)
  if (input.instance) {
    lines.push(`- **${t('report.instance')}:** ${input.instance.baseUrl}`)
    lines.push(`- **${t('report.apiRoot')}:** ${input.instance.apiRoot ?? '–'}`)
    lines.push(`- **${t('report.ecampVersion')}:** ${input.instance.version ?? '–'}`)
  } else {
    lines.push(`- **${t('report.instance')}:** –`)
  }
  lines.push(`- **${t('report.method')}:** ${input.method ? t(`session.method.${input.method}`) : '–'}`)
  lines.push(
    `- **${t('report.cookieNames')}:** ${input.cookieNames.length ? input.cookieNames.map((n) => `\`${n}\``).join(', ') : '–'}`,
  )
  lines.push(`- **${t('report.roles')}:** ${input.roles.length ? input.roles.join(', ') : '–'}`)
  lines.push(`- **${t('report.tokenExp')}:** ${input.tokenExp == null ? '–' : iso(input.tokenExp * 1000)}`)
  lines.push(`- **${t('report.campsCount')}:** ${input.campsCount ?? '–'}`)
  lines.push('')
  lines.push(`### ${t('report.results')}`)
  lines.push('')
  lines.push(`| ${t('report.check')} | ${t('report.status')} | ${t('report.time')} | ${t('report.detail')} |`)
  lines.push('| --- | --- | --- | --- |')
  for (const key of RESULT_KEYS) {
    const r = input.results[key]
    const detail = r.detail ? cell(sanitize(r.detail)) : ''
    lines.push(`| ${t(`results.${key}`)} | ${icon(r.status)} ${t(`results.status.${r.status}`)} | ${iso(r.at)} | ${detail} |`)
  }
  lines.push('')
  lines.push(`### ${t('report.log')}`)
  lines.push('')
  if (input.logs.length === 0) {
    lines.push(`_${t('report.noLog')}_`)
  } else {
    lines.push('```text')
    for (const l of input.logs) {
      const detail = l.detail ? ` – ${sanitize(l.detail).replace(/\r?\n/g, ' ')}` : ''
      lines.push(`${iso(l.at)} [${l.source}] ${l.ok ? 'OK  ' : 'FAIL'} ${l.step}${detail}`)
    }
    lines.push('```')
  }
  lines.push('')
  return lines.join('\n')
}
