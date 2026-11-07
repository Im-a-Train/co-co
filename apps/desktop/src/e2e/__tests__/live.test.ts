/**
 * Opt-in live E2E against a real eCamp instance. Skipped unless ECAMP_E2E_URL is set.
 * Credentials come from env only: ECAMP_E2E_URL / ECAMP_E2E_USER / ECAMP_E2E_PASSWORD.
 * ECAMP_E2E_POST_COMMENT=1 additionally posts (and deletes/resolves) one comment on a dev activity.
 */
import { describe, expect, it } from 'vitest'
import { loadCampFacts, loadCampList } from '@/domain/campFacts'
import { evaluate, countFindings } from '@/domain/rules/engine'
import { loadBundledPacks } from '@/domain/rules/packs'
import { DEFAULT_APP_SETTINGS, type CampFacts } from '@/domain/types'
import { decodeJwtHpPayload } from '@/lib/jwt'

const BASE = (process.env.ECAMP_E2E_URL ?? '').replace(/\/$/, '')
const USER = process.env.ECAMP_E2E_USER ?? ''
const PASS = process.env.ECAMP_E2E_PASSWORD ?? ''

const jar = new Map<string, string>()
function absorb(res: Response) {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';')
    const i = pair.indexOf('=')
    const name = pair.slice(0, i).trim()
    const value = pair.slice(i + 1).trim()
    if (/Max-Age=0|expires=Thu, 01 Jan 1970/i.test(line) || value === '') jar.delete(name)
    else jar.set(name, value)
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')

async function req(method: string, path: string, body?: unknown, contentType = 'application/json') {
  const res = await fetch(BASE + path, {
    method,
    redirect: 'manual',
    headers: {
      Accept: 'application/hal+json',
      'User-Agent': 'co-co-e2e/0.1 (Coach Cockpit live test)',
      ...(jar.size ? { Cookie: cookieHeader() } : {}),
      ...(body !== undefined ? { 'Content-Type': contentType } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  absorb(res)
  return res
}

async function login(): Promise<string> {
  const res = await req('POST', '/api/authentication_token', { identifier: USER, password: PASS })
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`)
  const hp = [...jar].find(([k]) => k.endsWith('jwt_hp'))
  const payload = hp ? decodeJwtHpPayload(hp[1]) : null
  if (!payload?.user) throw new Error('no user in jwt_hp')
  return payload.user.startsWith('/api/') ? payload.user : `/api/users/${payload.user}`
}

const apiGet = async (path: string) => {
  const res = await req('GET', path)
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${path}`), { status: res.status })
  return (await res.json()) as never
}

describe.skipIf(!BASE)('live eCamp E2E', () => {
  it('loads all camps of the user and runs the basic rule pack', async () => {
    const userIri = await login()
    const list = await loadCampList(apiGet, userIri)
    console.log(`[live] user ${userIri}: ${list.length} camps`)
    const packs = loadBundledPacks()
    for (const c of list) {
      let facts: CampFacts
      try {
        facts = await loadCampFacts(apiGet, c.iri, undefined, { userIri, instanceBaseUrl: BASE })
      } catch (e) {
        console.log(`[live] ${c.title} (${c.iri}) LOAD FAILED: ${(e as Error).message}`)
        throw e
      }
      const findings = evaluate(packs, {
        facts,
        mapping: null,
        coachInputs: null,
        documents: [],
        settings: DEFAULT_APP_SETTINGS,
        now: new Date(),
        userDisplayName: null,
        overrides: [],
      })
      const counts = countFindings(findings)
      const top = Object.entries(
        findings.reduce<Record<string, number>>((m, f) => ((m[f.ruleId] = (m[f.ruleId] ?? 0) + 1), m), {}),
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, n]) => `${k}x${n}`)
        .join(', ')
      console.log(
        `[live] ${c.title} role=${c.role} act=${facts.activities.length} se=${facts.scheduleEntries.length} ` +
          `days=${facts.days.length} must/should/hint=${counts.must}/${counts.should}/${counts.hint} top: ${top}`,
      )
      expect(facts.camp.iri).toBe(c.iri)
    }
  }, 300_000)

  it.skipIf(!process.env.ECAMP_E2E_POST_COMMENT)(
    'posts one comment, then deletes or resolves it',
    async () => {
      const userIri = await login()
      const list = await loadCampList(apiGet, userIri)
      let picked: { camp: string; activity: string } | null = null
      for (const c of list) {
        const acts = (await apiGet(`/api/activities?camp=${encodeURIComponent(c.iri)}`)) as any
        const a = acts._embedded?.items?.[0]
        if (a) {
          picked = { camp: c.iri, activity: a._links.self.href }
          break
        }
      }
      if (!picked) {
        console.log('[live] no activity found, skipping comment test')
        return
      }
      const res = await req('POST', '/api/comments', {
        camp: picked.camp,
        activity: picked.activity,
        textHtml: 'co-co E2E Test (wird gelöscht)',
      })
      const text = await res.text()
      console.log(`[live] POST comment -> ${res.status}`)
      expect(res.status, text).toBe(201)
      const iri = JSON.parse(text)._links.self.href as string
      const del = await req('DELETE', iri)
      console.log(`[live] DELETE ${iri} -> ${del.status}`)
      if (!del.ok) {
        const p = await req('PATCH', iri, { resolved: true }, 'application/merge-patch+json')
        console.log(`[live] PATCH resolved -> ${p.status}`)
      }
    },
    60_000,
  )
})
