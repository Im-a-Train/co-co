/** Cross-feature wiring: documents -> rules, rounds KPI, review status, AI availability, auth redirects, posting. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const saved: unknown[] = []
const postComment = vi.fn(async () => ({ _links: { self: { href: '/api/comments/9' } } }))
vi.mock('@/domain/feedback/store', () => ({
  listFeedback: async () => [],
  saveFeedback: async (i: unknown) => void saved.push(i),
  deleteFeedback: async () => {},
}))
vi.mock('@/lib/tauri', () => ({ commands: { apiPostComment: (...a: unknown[]) => postComment(...(a as [])) }, isTauri: () => false }))

import { evaluate } from '@/domain/rules/engine'
import { loadBundledPacks } from '@/domain/rules/packs'
import { allowedTransitions, canTransition, reviewStatusColor } from '@/domain/rounds'
import { roundDeltaParams } from '@/domain/cockpit'
import { itemFromFinding } from '@/domain/feedback'
import { aiAvailable } from '@/domain/zones/availability'
import { parseSafetyFindings } from '@/domain/zones/features'
import { authRedirect } from '@/lib/authRedirect'
import { useFeedback } from '@/composables/useFeedback'
import type { ActivityFact, Diff, GpxStats } from '@/domain/types'
import { CAT_LS, FactsBuilder, MAPPING, makeCtx, makeDoc } from '@/domain/rules/__tests__/factory'

const gpx: GpxStats = {
  name: 'Route',
  pointCount: 10,
  distanceKm: 10,
  ascentM: 500,
  descentM: 500,
  lkm: 20,
  lkmWithDescent: 23,
  paceLkmPerHour: 4,
  estimatedMinutes: 300,
  highestPointM: 2000,
  lowestPointM: 1000,
}

describe('documents -> rules (full engine, bundled packs)', () => {
  const build = () => {
    const b = new FactsBuilder()
    const a = b.activity('Gipfelwanderung', CAT_LS)
    b.entry(a, 2, '08:00', '12:00')
    return { b, a }
  }
  it('a linked GPX document covers route + time in LST-TREK-01 and triggers LST-TREK-02 when too slow', () => {
    const { b, a } = build()
    const doc = makeDoc({ id: 'g1', name: 'route.gpx', kind: 'gpx', activityIris: [a.iri], gpx })
    const withDoc = evaluate(loadBundledPacks(), makeCtx(b.facts, { mapping: MAPPING, documents: [doc] }))
    const trek01With = withDoc.find((f) => f.ruleId === 'LST-TREK-01' && f.targets.includes(a.iri))
    const slow = withDoc.find((f) => f.ruleId === 'LST-TREK-02')
    expect(slow?.targets).toEqual([a.iri, 'g1'])

    const without = evaluate(loadBundledPacks(), makeCtx(b.facts, { mapping: MAPPING, documents: [] }))
    const trek01Without = without.find((f) => f.ruleId === 'LST-TREK-01' && f.targets.includes(a.iri))
    expect(trek01Without).toBeDefined()
    // With the GPX linked, fewer planning parts are missing (route and time calculation are covered).
    expect((trek01With?.message.length ?? 0) < (trek01Without?.message.length ?? 0)).toBe(true)
    expect(without.some((f) => f.ruleId === 'LST-TREK-02')).toBe(false)
  })
  it('LST-LAGER-01 (formerly SAFE-DOC-01) reacts to documents (no safety concept)', () => {
    const { b } = build()
    const none = evaluate(loadBundledPacks(), makeCtx(b.facts, { mapping: MAPPING, documents: [] }))
    expect(none.some((f) => f.ruleId === 'LST-LAGER-01')).toBe(true)
  })
})

describe('rounds KPI + review status', () => {
  it('roundDeltaParams uses the latest round number and the live diff counts', () => {
    const diff = { counts: { added: 2, changed: 3, removed: 1 } } as Diff
    expect(roundDeltaParams([{ number: 1 }, { number: 2 }], diff)).toEqual({ n: 2, added: 2, changed: 3, removed: 1 })
    expect(roundDeltaParams([], diff)).toBeNull()
    expect(roundDeltaParams([{ number: 1 }], null)).toBeNull()
  })
  it('offers only allowed transitions', () => {
    expect(allowedTransitions('neu')).toEqual(['in_review'])
    expect(allowedTransitions('in_review')).toEqual(['aenderungen_angefragt', 'bewilligt', 'bewilligt_mit_auflagen'])
    expect(canTransition('neu', 'bewilligt')).toBe(false)
    expect(reviewStatusColor('bewilligt')).toBe('success')
    expect(reviewStatusColor('neu')).toBe('grey')
  })
})

describe('AI availability + AI findings', () => {
  it('needs both the switch and a stored key', () => {
    expect(aiAvailable(true, true)).toBe(true)
    expect(aiAvailable(true, false)).toBe(false)
    expect(aiAvailable(false, true)).toBe(false)
  })
  it('AI findings are origin ai, never must, and can be turned into draft feedback', () => {
    const act = { iri: '/api/activities/a1', title: 'Seilbrücke' } as ActivityFact
    const [f] = parseSafetyFindings('[{"title":"Sicherung","message":"Unklar","severity":"must"}]', act)
    expect(f).toMatchObject({ origin: 'ai', severity: 'hint' })
    const item = itemFromFinding(f!, '/api/camps/c1')
    expect(item).toMatchObject({ scope: 'activity', activityIri: act.iri, ruleId: 'AI-SAFETY-01', kind: 'suggestion', status: 'draft' })
  })
})

describe('auth redirects', () => {
  it('logged out on a protected route -> /verbindung', () => {
    expect(authRedirect(false, { requiresAuth: true, name: 'camps' })).toBe('/verbindung')
    expect(authRedirect(false, { requiresAuth: false, name: 'settings' })).toBeNull()
  })
  it('after login on /verbindung -> /lager or a safe redirect', () => {
    expect(authRedirect(true, { requiresAuth: false, name: 'connection' })).toBe('/lager')
    expect(authRedirect(true, { requiresAuth: false, name: 'connection', redirect: '/lager/c1/befunde' })).toBe('/lager/c1/befunde')
    expect(authRedirect(true, { requiresAuth: false, name: 'connection', redirect: '//evil.example' })).toBe('/lager')
    expect(authRedirect(true, { requiresAuth: false, name: 'settings' })).toBeNull()
  })
})

describe('posting feedback as eCamp comment', () => {
  beforeEach(() => {
    saved.length = 0
    postComment.mockClear()
  })
  it('posts an activity item via api_post_comment and marks it posted', async () => {
    const fb = useFeedback('/api/camps/c1')
    const item = await fb.add({ scope: 'activity', kind: 'must', text: 'Bitte Sicherung klären?', activityIri: '/api/activities/a1' })
    await fb.postAsComment(item.id)
    expect(postComment).toHaveBeenCalledWith('/api/camps/c1', '/api/activities/a1', 'Bitte Sicherung klären?')
    expect(fb.items.value.find((i) => i.id === item.id)).toMatchObject({ status: 'posted', postedCommentIri: '/api/comments/9' })
    await expect(fb.postAsComment(item.id)).rejects.toThrow()
  })
  it('refuses camp-level items (copy only)', async () => {
    const fb = useFeedback('/api/camps/c1')
    const item = await fb.add({ scope: 'camp', kind: 'kudos', text: 'Tolles Lager' })
    await expect(fb.postAsComment(item.id)).rejects.toThrow()
    expect(postComment).not.toHaveBeenCalled()
  })
})
