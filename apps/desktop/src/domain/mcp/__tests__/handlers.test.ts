import { describe, expect, it } from 'vitest'
import { MCP_TOOLS } from '../catalog'
import { MCP_CONFIRM, MCP_HANDLERS } from '../handlers'
import { McpToolError } from '../types'
import type { Rule, RuleMeta, RulePack } from '../../types'
import { EMAIL, NAME, makeFakeContext, makeFeedback, makeFinding } from './fakeContext'

const CAMP = { campId: 'c1' }

async function run(name: keyof typeof MCP_HANDLERS, args: Record<string, unknown>, over?: Parameters<typeof makeFakeContext>[0]) {
  const fake = makeFakeContext(over)
  const value = await MCP_HANDLERS[name](args, fake.ctx)
  return { ...fake, value, json: JSON.stringify(value) }
}

function expectNoPii(json: string) {
  expect(json).not.toContain(NAME)
  expect(json).not.toContain('Anna')
  expect(json).not.toContain(EMAIL)
  expect(json).not.toContain('@')
  expect(json).not.toContain('/api/users/')
}

describe('handlers cover the catalogue', () => {
  it('has a handler for every tool and a confirm builder for every write tool', () => {
    for (const t of MCP_TOOLS) {
      expect(MCP_HANDLERS[t.name]).toBeTypeOf('function')
      if (t.kind === 'write') expect(MCP_CONFIRM[t.name]).toBeTypeOf('function')
      else expect(MCP_CONFIRM[t.name]).toBeUndefined()
    }
  })
})

describe('read tools', () => {
  it('list_camps', async () => {
    const { value } = await run('list_camps', {})
    expect(value).toEqual([expect.objectContaining({ id: 'c1', title: 'Sommerlager', role: 'manager' })])
  })

  it('get_camp_overview', async () => {
    const { value, json } = await run('get_camp_overview', CAMP)
    expect(value).toMatchObject({
      camp: { id: 'c1', title: 'Sommerlager' },
      activityCount: 2,
      dayCount: 5,
      jsDays: null,
      reviewStatus: 'neu',
      roundCount: 0,
      findingCounts: { must: 1, should: 0, hint: 0, overridden: 0 },
    })
    expectNoPii(json)
  })

  it('list_activities redacts names and e-mails, filters by day and truncates content', async () => {
    const all = await run('list_activities', { ...CAMP, includeContent: true })
    expect(all.value as unknown[]).toHaveLength(2)
    expect((all.value as { title: string }[])[0].title).toMatch(/Leiter A/)
    expect(all.json).toContain('[E-Mail]')
    expectNoPii(all.json)
    const day2 = await run('list_activities', { ...CAMP, day: 2 })
    expect(day2.value).toEqual([expect.objectContaining({ title: 'Abendspiel', day: 2 })])
  })

  it('get_activity returns content and findings, redacted', async () => {
    const { value, json } = await run('get_activity', { ...CAMP, activityId: 'a1' })
    expect(value).toMatchObject({ activityId: '/api/activities/a1', category: 'LS' })
    expect((value as { findings: unknown[] }).findings).toHaveLength(1)
    expectNoPii(json)
    await expect(run('get_activity', { ...CAMP, activityId: 'zzz' })).rejects.toThrow(McpToolError)
  })

  it('list_findings strips red findings, filters severity and ignored', async () => {
    const red = makeFinding({ id: 'R:1', tags: ['midata'], title: 'Rot' })
    const ignored = makeFinding({
      id: 'JS-X-02:/api/activities/a2',
      severity: 'hint',
      targets: ['/api/activities/a2'],
      override: { id: 'o', campIri: '/api/camps/c1', findingId: 'x', ruleId: 'JS-X-02', reason: `Rücksprache mit ${NAME}`, createdAt: '' },
    })
    const findings = [makeFinding(), red, ignored]
    const def = await run('list_findings', CAMP, { findings })
    expect((def.value as { id: string }[]).map((f) => f.id)).toEqual(['JS-X-01:/api/activities/a1'])
    expect(def.json).not.toContain('Rot')
    const withIgnored = await run('list_findings', { ...CAMP, includeIgnored: true }, { findings })
    expect(withIgnored.value as unknown[]).toHaveLength(2)
    expect(withIgnored.json).toContain('"status":"ignored"')
    expectNoPii(withIgnored.json)
    const hints = await run('list_findings', { ...CAMP, severity: 'hint', includeIgnored: true }, { findings })
    expect(hints.value as unknown[]).toHaveLength(1)
  })

  it('list_findings reports feedback status', async () => {
    const { value } = await run('list_findings', CAMP, { feedback: [makeFeedback({ findingId: 'JS-X-01:/api/activities/a1' })] })
    expect((value as { status: string }[])[0].status).toBe('feedback')
  })

  it('get_rule_catalog', async () => {
    const meta = {
      id: 'JS-X-01', version: '1', module: 'js', group: 'js', status: 'active', kind: 'hard', title: 'T', description: 'D', message: 'M',
      severity: 'must', confidence: 'verified', scope: 'camp', sources: [], source: { title: 'S', url: 'https://x.test' },
    } satisfies RuleMeta
    const rules: Rule[] = [
      { meta, check: () => [] },
      { meta: { ...meta, id: 'PBS-1', module: 'pbs', group: 'pbs' }, check: () => [] },
      { meta: { ...meta, id: 'JS-OLD-1', status: 'retired' }, check: () => [] },
    ]
    const packs: RulePack[] = [{ id: 'basis', name: 'Basis', version: '1', description: '', rules }]
    const all = await run('get_rule_catalog', {}, { packs })
    expect((all.value as { rules: unknown[] }).rules).toHaveLength(2)
    const js = await run('get_rule_catalog', { module: 'js' }, { packs })
    expect((js.value as { rules: { id: string }[] }).rules.map((r) => r.id)).toEqual(['JS-X-01'])
  })

  it('list_deadlines adds the status', async () => {
    const deadlines = [{ campIri: '/api/camps/c1', campTitle: 'Sommerlager', kind: 'nds-registration' as const, due: '2030-12-01', done: false, ruleId: null, source: null }]
    const { value } = await run('list_deadlines', {}, { deadlines })
    expect(value).toEqual([expect.objectContaining({ kind: 'nds-registration', status: 'overdue' })])
  })

  it('list_feedback redacts and drops red items', async () => {
    const feedback = [
      makeFeedback({ id: 'f1', text: `Danke ${NAME}, mail ${EMAIL}` }),
      makeFeedback({ id: 'f2', text: 'Rot', redDerived: true }),
      makeFeedback({ id: 'f3', text: 'Fehlt (Quelle: MiData, Stand 01.06.2026)' }),
    ]
    const { value, json } = await run('list_feedback', CAMP, { feedback })
    expect((value as { id: string }[]).map((f) => f.id)).toEqual(['f1'])
    expectNoPii(json)
  })

  it('list_rounds', async () => {
    const { value } = await run('list_rounds', CAMP, {
      rounds: [{ id: 'r1', campIri: '/api/camps/c1', number: 1, startedAt: 'a', closedAt: null, snapshotId: 's', note: `von ${NAME}`, exportedAt: null }],
      review: { campIri: '/api/camps/c1', status: 'in_review', history: [], updatedAt: '' },
    })
    expect(value).toMatchObject({ reviewStatus: 'in_review', rounds: [{ number: 1 }] })
  })

  it('rejects invalid camp ids', async () => {
    await expect(run('list_feedback', { campId: '../x' })).rejects.toThrow('Ungültige Lager-ID')
  })
})

describe('write tools', () => {
  it('add_feedback de-redacts the pseudonym and creates a draft', async () => {
    const { ctx, state, value } = await run('add_feedback', { ...CAMP, kind: 'kudos', text: 'Super gemacht, Leiter A!', activityId: 'a1', findingId: 'JS-X-01:/api/activities/a1' })
    expect(value).toEqual({ id: 'new-1', status: 'draft' })
    expect(ctx.saveFeedback).toHaveBeenCalledOnce()
    expect(state.feedback[0]).toMatchObject({
      scope: 'activity',
      activityIri: '/api/activities/a1',
      ruleId: 'JS-X-01',
      status: 'draft',
      text: expect.stringContaining('Beispiel'),
    })
    expect(state.feedback[0].text).not.toContain('Leiter A')
  })

  it('add_feedback camp scope and unknown activity', async () => {
    const ok = await run('add_feedback', { ...CAMP, kind: 'must', text: 'Bitte klären.' })
    expect(ok.state.feedback[0].scope).toBe('camp')
    expect(ok.state.feedback[0].activityIri).toBeUndefined()
    await expect(run('add_feedback', { ...CAMP, kind: 'must', text: 'x', activityId: 'nope' })).rejects.toThrow('gehört nicht')
  })

  it('update_feedback changes drafts only', async () => {
    const ok = await run('update_feedback', { feedbackId: 'f1', text: 'Neu für Leiter A' }, { feedback: [makeFeedback()] })
    expect(ok.state.feedback[0].text).toContain('Beispiel')
    await expect(
      run('update_feedback', { feedbackId: 'f1', text: 'x' }, { feedback: [makeFeedback({ status: 'posted' })] }),
    ).rejects.toThrow('Nur Entwürfe können geändert werden')
    await expect(
      run('update_feedback', { feedbackId: 'f1', text: 'x' }, { feedback: [makeFeedback({ redDerived: true })] }),
    ).rejects.toThrow(McpToolError)
    await expect(run('update_feedback', { feedbackId: 'nope', text: 'x' })).rejects.toThrow('nicht gefunden')
    await expect(run('update_feedback', { feedbackId: 'f1' }, { feedback: [makeFeedback()] })).rejects.toThrow('Nichts zu ändern')
  })

  it('ignore_finding stores an override', async () => {
    const { ctx, value } = await run('ignore_finding', { ...CAMP, findingId: 'JS-X-01:/api/activities/a1', reason: 'Trifft nicht zu' })
    expect(value).toEqual({ findingId: 'JS-X-01:/api/activities/a1', ignored: true })
    expect(ctx.addOverride).toHaveBeenCalledWith('/api/camps/c1', 'JS-X-01:/api/activities/a1', 'JS-X-01', 'Trifft nicht zu')
    await expect(run('ignore_finding', { ...CAMP, findingId: 'nope', reason: 'x' })).rejects.toThrow('Befund nicht gefunden')
  })

  it('set_review_status follows the workflow', async () => {
    const ok = await run('set_review_status', { ...CAMP, status: 'in_review', note: 'Start' })
    expect(ok.value).toEqual({ status: 'in_review' })
    const bad = run('set_review_status', { ...CAMP, status: 'bewilligt' })
    await expect(bad).rejects.toThrow(/nicht erlaubt.*in_review/)
  })

  it('post_feedback_comment posts activity drafts only', async () => {
    const ok = await run('post_feedback_comment', { feedbackId: 'f1' }, { feedback: [makeFeedback()] })
    expect(ok.value).toEqual({ id: 'f1', status: 'posted', postedParts: 1 })
    const camp = run('post_feedback_comment', { feedbackId: 'f1' }, { feedback: [makeFeedback({ scope: 'camp', activityIri: undefined })] })
    await expect(camp).rejects.toThrow('Nur Aktivitäts-Punkte')
    await expect(
      run('post_feedback_comment', { feedbackId: 'f1' }, { feedback: [makeFeedback({ status: 'posted' })] }),
    ).rejects.toThrow('Nur Entwürfe')
    await expect(
      run('post_feedback_comment', { feedbackId: 'f1' }, { feedback: [makeFeedback({ redDerived: true })] }),
    ).rejects.toThrow(McpToolError)
  })
})

describe('confirmation texts', () => {
  it('show the camp and the exact de-redacted text', async () => {
    const { ctx } = makeFakeContext({ feedback: [makeFeedback()] })
    const add = await MCP_CONFIRM.add_feedback!({ ...CAMP, kind: 'kudos', text: 'Danke Leiter A', activityId: 'a1' }, ctx)
    expect(add.summary).toContain('Sommerlager')
    expect(add.kind).toBe('write')
    expect(add.details.join('\n')).toContain(`Danke ${NAME}`)
    const post = await MCP_CONFIRM.post_feedback_comment!({ feedbackId: 'f1' }, ctx)
    expect(post.details).toContain('Wird als Kommentar in eCamp gepostet (für die Lagerleitung sichtbar)')
    expect(post.details.join('\n')).toContain('Bitte ergänzen.')
    const ign = await MCP_CONFIRM.ignore_finding!({ ...CAMP, findingId: 'JS-X-01:/api/activities/a1', reason: 'Grund Leiter A' }, ctx)
    expect(ign.details.join('\n')).toContain(`Grund ${NAME}`)
    const st = await MCP_CONFIRM.set_review_status!({ ...CAMP, status: 'in_review' }, ctx)
    expect(st.details.join('\n')).toContain('in_review')
    const upd = await MCP_CONFIRM.update_feedback!({ feedbackId: 'f1', text: 'Neu' }, ctx)
    expect(upd.details.join('\n')).toContain('Neuer Text: Neu')
  })
})
