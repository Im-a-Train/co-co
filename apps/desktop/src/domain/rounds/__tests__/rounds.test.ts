import { describe, expect, it } from 'vitest'
import {
  RoundsError,
  applyStatusChange,
  approvalBlockers,
  reviewStepMarks,
  canTransition,
  diffEntities,
  diffIsEmpty,
  exportReminderDue,
  fastHash,
  groupDiff,
  planNewRound,
  sha256Hex,
  snapshotEntities,
  stableStringify,
} from '../index'
import type { FeedbackItem, Finding, Round } from '../../types'
import { makeFacts } from './factsFixture'

describe('hashing', () => {
  it('stableStringify ignores key order', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe(stableStringify({ a: [2, { d: 1 }], b: 1 }))
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }))
  })
  it('fastHash is deterministic and sensitive', () => {
    expect(fastHash('abc')).toBe(fastHash('abc'))
    expect(fastHash('abc')).not.toBe(fastHash('abd'))
    expect(fastHash('abc')).toHaveLength(28)
  })
  it('sha256Hex matches the known vector', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('snapshotEntities is stable and covers all entity types', async () => {
    const a = await snapshotEntities(makeFacts())
    const b = await snapshotEntities({ ...makeFacts(), loadedAt: '2030-01-01T00:00:00.000Z' })
    expect(a).toEqual(b)
    const types = new Set(Object.values(a).map((e) => e.type))
    expect([...types].sort()).toEqual(['activity', 'activityContent', 'camp', 'category', 'day', 'period', 'scheduleEntry'])
    expect(a['/api/activities/a1#content']).toBeDefined()
  })
})

describe('diffEntities', () => {
  it('null from = everything added', async () => {
    const e = await snapshotEntities(makeFacts())
    const d = diffEntities('/api/camps/camp1', null, { roundId: null, entities: e })
    expect(d.counts.added).toBe(Object.keys(e).length)
    expect(d.fromRoundId).toBeNull()
  })
  it('identical facts give an empty diff', async () => {
    const e = await snapshotEntities(makeFacts())
    const d = diffEntities('c', { roundId: 'r1', entities: e }, { roundId: null, entities: await snapshotEntities(makeFacts()) })
    expect(diffIsEmpty(d)).toBe(true)
    expect(d.fromRoundId).toBe('r1')
  })
  it('detects added, changed, removed with field names', async () => {
    const before = makeFacts(2)
    const after = makeFacts(3)
    after.activities[0]!.title = 'Neuer Titel'
    after.activities[1]!.content.safetyText = 'Sicherung beachten'
    after.scheduleEntries = after.scheduleEntries.filter((s) => s.iri !== '/api/schedule_entries/s2')
    after.scheduleEntries[0]!.end = '2027-07-10T11:00:00+00:00'
    const d = diffEntities(
      'c',
      { roundId: 'r1', entities: await snapshotEntities(before) },
      { roundId: null, entities: await snapshotEntities(after) },
    )
    const find = (key: string) => d.entries.find((e) => e.key === key)
    expect(find('/api/activities/a1')).toMatchObject({ change: 'changed', fields: ['title'] })
    expect(find('/api/activities/a2#content')).toMatchObject({
      change: 'changed',
      fields: ['safetyText'],
      activityIri: '/api/activities/a2',
    })
    expect(find('/api/activities/a3')?.change).toBe('added')
    expect(find('/api/schedule_entries/s2')).toMatchObject({ change: 'removed', activityIri: '/api/activities/a2' })
    expect(find('/api/schedule_entries/s1')).toMatchObject({ change: 'changed', fields: ['end'] })
    expect(d.counts.removed).toBe(1)
  })
  it('groups by activity and keeps camp-level entries general', async () => {
    const after = makeFacts(2)
    after.camp.title = 'Anders'
    after.activities[0]!.location = 'Wald'
    after.scheduleEntries[0]!.start = '2027-07-10T08:00:00+00:00'
    const d = diffEntities(
      'c',
      { roundId: 'r1', entities: await snapshotEntities(makeFacts(2)) },
      { roundId: null, entities: await snapshotEntities(after) },
    )
    const g = groupDiff(d, (iri) => (iri === '/api/activities/a1' ? 'Aktivität 1' : undefined))
    expect(g.general.map((e) => e.type)).toEqual(['camp'])
    expect(g.activities).toHaveLength(1)
    expect(g.activities[0]!.title).toBe('Aktivität 1')
    expect(g.activities[0]!.entries.map((e) => e.type).sort()).toEqual(['activity', 'scheduleEntry'])
  })
})

describe('review + rounds planning', () => {
  it('follows the transition table', () => {
    expect(canTransition('neu', 'in_review')).toBe(true)
    expect(canTransition('neu', 'bewilligt')).toBe(false)
    expect(canTransition('aenderungen_angefragt', 'in_review')).toBe(true)
    expect(canTransition('bewilligt', 'neu')).toBe(false)
  })
  it('applyStatusChange appends history and rejects invalid transitions', () => {
    const now = new Date('2026-11-07T10:00:00Z')
    const s1 = applyStatusChange(null, '/api/camps/x', 'in_review', ' los ', now)
    expect(s1.history).toEqual([{ status: 'in_review', at: now.toISOString(), note: 'los' }])
    const s2 = applyStatusChange(s1, '/api/camps/x', 'bewilligt_mit_auflagen', null, now)
    expect(s2.history).toHaveLength(2)
    expect(() => applyStatusChange(null, 'x', 'bewilligt')).toThrow(RoundsError)
    expect(() => applyStatusChange(s2, 'x', 'aenderungen_angefragt')).toThrow(/->/)
  })
  it('planNewRound closes the open round and numbers n+1', () => {
    const r1: Round = {
      id: 'r1',
      campIri: 'c',
      number: 1,
      startedAt: 'a',
      closedAt: 'b',
      snapshotId: 's1',
      note: '',
      exportedAt: null,
    }
    const r2: Round = { ...r1, id: 'r2', number: 2, closedAt: null, snapshotId: 's2' }
    const p = planNewRound([r1, r2], 'c', { roundId: 'r3', snapshotId: 's3' }, 'n')
    expect(p.closed?.id).toBe('r2')
    expect(p.closed?.closedAt).toBeTruthy()
    expect(p.round).toMatchObject({ number: 3, closedAt: null, note: 'n', exportedAt: null })
    expect(planNewRound([], 'c', { roundId: 'r', snapshotId: 's' }).round.number).toBe(1)
    expect(planNewRound([], 'c', { roundId: 'r', snapshotId: 's' }).closed).toBeNull()
  })
  it('exportReminderDue', () => {
    const r: Round = {
      id: 'r',
      campIri: 'c',
      number: 1,
      startedAt: 'a',
      closedAt: null,
      snapshotId: 's',
      note: '',
      exportedAt: null,
    }
    expect(exportReminderDue({ remindAfterRound: true }, [r])).toBe(true)
    expect(exportReminderDue({ remindAfterRound: false }, [r])).toBe(false)
    expect(exportReminderDue({ remindAfterRound: true }, [{ ...r, exportedAt: 'x' }])).toBe(false)
    expect(exportReminderDue({ remindAfterRound: true }, [])).toBe(false)
  })
})

describe('approvalBlockers', () => {
  const f = (id: string, over: Partial<Finding> = {}): Finding =>
    ({ id, ruleId: id, severity: 'should', scope: 'camp', targets: [], evidence: [], override: null, ...over }) as unknown as Finding
  const fb = (over: Partial<FeedbackItem>): FeedbackItem =>
    ({ id: 'i', campIri: 'c', scope: 'camp', kind: 'suggestion', text: 't', status: 'draft', createdAt: '', updatedAt: '', ...over }) as FeedbackItem
  const base = { findings: [], feedback: [], jsDays: null, mappingConfirmed: true }

  it('has no blockers for an empty, confirmed camp', () => {
    expect(approvalBlockers(base)).toEqual({
      openMust: 0, untriaged: 0, unsentMust: 0, unsentDrafts: 0, jsDays: null, mappingUnconfirmed: false, any: false,
    })
  })
  it('counts open Muss and untriaged findings; ignored ones are not open', () => {
    const b = approvalBlockers({
      ...base,
      findings: [
        f('A', { severity: 'must' }),
        f('B', { severity: 'must', override: { reason: 'x' } as Finding['override'] }),
        f('C'),
        f('D', { override: { reason: 'x' } as Finding['override'] }),
      ],
    })
    expect(b).toMatchObject({ openMust: 1, untriaged: 2, any: true })
  })
  it('findings covered by feedback are triaged; coach todos are not untriaged but a todo Muss is open', () => {
    const b = approvalBlockers({
      ...base,
      findings: [f('A'), f('T', { needsInput: 'coachInputs' }), f('M', { severity: 'must', needsInput: 'mapping' })],
      feedback: [fb({ findingId: 'A', status: 'sent' })],
    })
    expect(b.untriaged).toBe(0)
    expect(b.openMust).toBe(1)
  })
  it('a grouped feedback item covers all its findings', () => {
    const b = approvalBlockers({
      ...base,
      findings: [f('A:1'), f('A:2')],
      feedback: [fb({ findingId: 'A:1', findingIds: ['A:1', 'A:2'], status: 'sent' })],
    })
    expect(b.untriaged).toBe(0)
  })
  it('splits unsent drafts into must and others; posted/sent are fine', () => {
    const b = approvalBlockers({
      ...base,
      feedback: [fb({ kind: 'must' }), fb({}), fb({ kind: 'kudos' }), fb({ status: 'sent', kind: 'must' }), fb({ status: 'posted' })],
    })
    expect(b).toMatchObject({ unsentMust: 1, unsentDrafts: 2, any: true })
  })
  it('jsDays only when below the minimum', () => {
    expect(approvalBlockers({ ...base, jsDays: { valid: 5, required: 6 } }).jsDays).toEqual({ valid: 5, required: 6 })
    expect(approvalBlockers({ ...base, jsDays: { valid: 6, required: 6 } }).jsDays).toBeNull()
    expect(approvalBlockers({ ...base, jsDays: { valid: 6, required: 6 } }).any).toBe(false)
  })
  it('unconfirmed mapping blocks', () => {
    expect(approvalBlockers({ ...base, mappingConfirmed: false })).toMatchObject({ mappingUnconfirmed: true, any: true })
  })
})

describe('reviewStepMarks', () => {
  const h = (...s: Parameters<typeof reviewStepMarks>[0][number]['status'][]) => s.map((status) => ({ status, at: '2026-01-01T00:00:00Z', note: null }))
  it('no history, neu is current', () => {
    expect(reviewStepMarks([], 'neu')).toEqual({
      neu: 'current', in_review: 'future', aenderungen_angefragt: 'future', bewilligt: 'future', bewilligt_mit_auflagen: 'future',
    })
  })
  it('only statuses in history are done; skipped steps are marked skipped', () => {
    expect(reviewStepMarks(h('in_review', 'bewilligt'), 'bewilligt')).toEqual({
      neu: 'done', in_review: 'done', aenderungen_angefragt: 'skipped', bewilligt: 'current', bewilligt_mit_auflagen: 'future',
    })
  })
  it('jumping straight to approved skips in_review without history', () => {
    const m = reviewStepMarks([], 'bewilligt_mit_auflagen')
    expect(m.in_review).toBe('skipped')
    expect(m.aenderungen_angefragt).toBe('skipped')
    expect(m.bewilligt).toBe('future')
  })
  it('a revoked approval (camp reopened) is no longer done, and nothing ahead counts as skipped', () => {
    expect(reviewStepMarks(h('in_review', 'bewilligt', 'in_review'), 'in_review')).toEqual({
      neu: 'done', in_review: 'current', aenderungen_angefragt: 'future', bewilligt: 'future', bewilligt_mit_auflagen: 'future',
    })
  })
  it('the other approval variant is never skipped or done', () => {
    expect(reviewStepMarks(h('in_review', 'bewilligt', 'in_review', 'bewilligt_mit_auflagen'), 'bewilligt_mit_auflagen')).toMatchObject({
      aenderungen_angefragt: 'skipped', bewilligt: 'future', bewilligt_mit_auflagen: 'current',
    })
  })
  it('after a round trip the earlier steps are done', () => {
    const m = reviewStepMarks(h('in_review', 'aenderungen_angefragt', 'in_review'), 'in_review')
    expect(m).toMatchObject({ neu: 'done', in_review: 'current', aenderungen_angefragt: 'done', bewilligt: 'future' })
  })
})
