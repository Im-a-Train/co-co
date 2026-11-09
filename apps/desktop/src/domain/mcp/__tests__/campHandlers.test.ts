import { describe, expect, it } from 'vitest'
import { CAMP } from '@/domain/rules/__tests__/factory'
import type { DocumentRecord, ManualFinding, Rule, RuleMeta, RulePack } from '../../types'
import { MCP_CONFIRM, MCP_HANDLERS } from '../handlers'
import { dispatchToolCall } from '../dispatch'
import { DEFAULT_APP_SETTINGS } from '../../types'
import { EMAIL, NAME, makeFakeContext, makeFeedback } from './fakeContext'

const CAMP_ARG = { campId: 'c1' }

async function run(name: keyof typeof MCP_HANDLERS, args: Record<string, unknown>, over?: Parameters<typeof makeFakeContext>[0]) {
  const fake = makeFakeContext(over)
  const value = await MCP_HANDLERS[name](args, fake.ctx)
  return { ...fake, value, json: JSON.stringify(value) }
}

function doc(over: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'd1',
    campIri: CAMP,
    path: 'C:/secret/path/Sicherheitskonzept.pdf',
    name: 'Sicherheitskonzept.pdf',
    kind: 'pdf',
    size: 1234,
    modifiedMs: 0,
    importedAt: '2031-01-01T00:00:00.000Z',
    source: 'import',
    folder: null,
    contentHash: 'abc',
    text: `Notfall: ${NAME} erreichbar unter ${EMAIL}. Weiterer Text.`,
    extractError: null,
    activityIris: ['/api/activities/a1'],
    linkSuggestions: [],
    docCheck: { items: [{ key: 'emergencyNumbers', found: false, snippets: [] }] as never, complete: false, checkedAt: '2031-01-01T00:00:00.000Z' },
    gpx: null,
    zone: 'yellow',
    aiAllowed: false,
    aiSummary: null,
    ...over,
  } as DocumentRecord
}

function manual(over: Partial<ManualFinding> = {}): ManualFinding {
  return {
    id: 'manual:m1',
    campIri: CAMP,
    scope: 'activity',
    activityIri: '/api/activities/a1',
    category: 'safety',
    comment: `Bitte ${NAME} fragen.`,
    createdAt: '2031-01-01T00:00:00.000Z',
    updatedAt: '2031-01-01T00:00:00.000Z',
    ...over,
  }
}

describe('list_manual_findings', () => {
  it('redacts, resolves titles and filters by activity', async () => {
    const m2 = manual({ id: 'manual:m2', scope: 'camp', activityIri: undefined, category: 'positive', comment: 'Tolles Konzept' })
    const { value, json } = await run('list_manual_findings', CAMP_ARG, { manualFindings: [manual(), m2] })
    expect(value as unknown[]).toHaveLength(2)
    expect(json).not.toContain(NAME)
    expect(json).toContain('Leiter A')
    const only = await run('list_manual_findings', { ...CAMP_ARG, activityId: 'a1' }, { manualFindings: [manual(), m2] })
    expect((only.value as { id: string }[]).map((m) => m.id)).toEqual(['manual:m1'])
  })

  it('never returns comments quoting MiData/NDS', async () => {
    const { value } = await run('list_manual_findings', CAMP_ARG, { manualFindings: [manual({ comment: 'Quelle: MiData sagt' })] })
    expect(value).toEqual([])
  })
})

describe('get_feedback_structure / list_general_feedback_points', () => {
  it('groups general and activity items and hides red-derived ones', async () => {
    const feedback = [
      makeFeedback({ id: 'g1', scope: 'camp', activityIri: undefined, generalPointId: 'siko', text: 'Siko prüfen' }),
      makeFeedback({ id: 'a1', text: `Hallo ${NAME}` }),
      makeFeedback({ id: 'red', redDerived: true, text: 'geheim' }),
    ]
    const { value, json } = await run('get_feedback_structure', CAMP_ARG, { feedback })
    const v = value as { general: { id: string }[]; days: { activities: { items: { id: string }[] }[] }[] }
    expect(v.general.map((i) => i.id)).toEqual(['g1'])
    expect(v.days.flatMap((d) => d.activities.flatMap((a) => a.items.map((i) => i.id)))).toEqual(['a1'])
    expect(json).not.toContain('geheim')
    expect(json).not.toContain(NAME)
  })

  it('lists the default points with used state', async () => {
    const feedback = [makeFeedback({ id: 'g1', scope: 'camp', activityIri: undefined, generalPointId: 'siko' })]
    const { value } = await run('list_general_feedback_points', CAMP_ARG, { feedback })
    const pts = value as { id: string; used: boolean; title: string; checks: string[]; feedbackIds: string[] }[]
    expect(pts.map((p) => p.id)).toEqual(expect.arrayContaining(['siko', 'psa', 'notfall', 'rega', 'js-admin']))
    expect(pts.find((p) => p.id === 'siko')).toMatchObject({ used: true, feedbackIds: ['g1'] })
    expect(pts.find((p) => p.id === 'psa')!.used).toBe(false)
    for (const p of pts) {
      expect(p.title).not.toMatch(/^feedback\./)
      expect(p.checks.length).toBeGreaterThan(0)
    }
  })
})

describe('get_camp_progress', () => {
  it('returns German labels and counts', async () => {
    const { value } = await run('get_camp_progress', CAMP_ARG, {
      manualFindings: [manual()],
      documents: [doc()],
      feedback: [makeFeedback({ status: 'posted' })],
      reviewContext: { coachInputsPresent: true, checklist: { done: 1, total: 2 }, moduleStates: {}, disabledRuleIds: [] },
    })
    const v = value as { percent: number; steps: { key: string; label: string; done: boolean; value: number; total: number; hint: string | null }[] }
    expect(v.percent).toBeGreaterThan(0)
    expect(v.steps.map((s) => s.key)).toEqual(['mapping', 'inputs', 'triage', 'documents', 'checklist', 'feedback', 'status'])
    expect(v.steps.find((s) => s.key === 'mapping')!.label).toBe('Zuordnung bestätigt')
    expect(v.steps.find((s) => s.key === 'inputs')!.done).toBe(true)
    expect(v.steps.find((s) => s.key === 'checklist')).toMatchObject({ value: 1, total: 2 })
    expect(v.steps.find((s) => s.key === 'documents')).toMatchObject({ value: 1, total: 1 })
    expect(v.steps.filter((s) => s.hint !== null)).toHaveLength(1)
  })
})

describe('documents', () => {
  it('list_documents returns metadata, never the path, no red documents', async () => {
    const red = doc({ id: 'd2', name: 'rot.pdf', zone: 'red' })
    const { value, json } = await run('list_documents', CAMP_ARG, { documents: [doc(), red], manualFindings: [manual({ scope: 'document', documentId: 'd1' })] })
    const list = value as { id: string; manualFindingCount: number; docCheck: { missing: string[] } }[]
    expect(list.map((d) => d.id)).toEqual(['d1'])
    expect(list[0].manualFindingCount).toBe(1)
    expect(list[0].docCheck.missing).toEqual(['emergencyNumbers'])
    expect(json).not.toContain('secret')
    expect(json).not.toContain('"path"')
    expect(json).not.toContain('Notfall:')
  })

  it('get_document_text needs aiAllowed, redacts and pages', async () => {
    await expect(run('get_document_text', { ...CAMP_ARG, documentId: 'd1' }, { documents: [doc()] })).rejects.toThrow('nicht für KI freigegeben')
    await expect(run('get_document_text', { ...CAMP_ARG, documentId: 'nope' }, { documents: [doc()] })).rejects.toThrow('nicht gefunden')
    await expect(run('get_document_text', { ...CAMP_ARG, documentId: 'd2' }, { documents: [doc({ id: 'd2', zone: 'red', aiAllowed: true })] })).rejects.toThrow('nicht gefunden')
    const ok = await run('get_document_text', { ...CAMP_ARG, documentId: 'd1', length: 10 }, { documents: [doc({ aiAllowed: true })] })
    expect(ok.value).toMatchObject({ offset: 0, length: 10, nextOffset: 10 })
    const full = await run('get_document_text', { ...CAMP_ARG, documentId: 'd1' }, { documents: [doc({ aiAllowed: true })] })
    expect(full.json).not.toContain(NAME)
    expect(full.json).not.toContain(EMAIL)
    expect(full.json).toContain('Leiter A')
    expect((full.value as { nextOffset: number | null }).nextOffset).toBeNull()
  })
})

describe('get_review_guidance', () => {
  const meta = (over: Partial<RuleMeta>): RuleMeta =>
    ({
      id: 'X-1', version: '1', module: 'js', group: 'js', status: 'active', kind: 'ai', title: 'Titel', description: 'Beschreibung', message: 'M',
      severity: 'hint', confidence: 'heuristic', scope: 'camp', sources: [{ key: 'manual', page: '1' }], source: { title: 'S', url: 'https://x.test' },
      ...over,
    }) as RuleMeta
  const packs = (metas: RuleMeta[]): RulePack[] => [
    { id: 'basis', name: 'Basis', version: '1', description: '', rules: metas.map((m): Rule => ({ meta: m, check: () => [] })) },
  ]

  it('returns guidance rules, honouring disabled rules and modules', async () => {
    const metas = [meta({ id: 'A-1' }), meta({ id: 'A-2' }), meta({ id: 'P-1', module: 'pbs', group: 'pbs' }), meta({ id: 'H-1', kind: 'hard' })]
    const { value } = await run('get_review_guidance', CAMP_ARG, {
      packs: packs(metas),
      reviewContext: { coachInputsPresent: false, checklist: { done: 0, total: 0 }, moduleStates: { pbs: 'off' }, disabledRuleIds: ['A-2'] },
    })
    const v = value as { ruleCount: number; rules: { id: string; kind: string }[]; guidance: string }
    expect(v.rules.map((r) => r.id)).toEqual(['A-1', 'H-1'])
    expect(v.rules[0].kind).toBe('ai')
    expect(v.guidance).toContain('A-1')
    expect(v.guidance).not.toContain('A-2')
  })

  it('get_rule_catalog includes kind and filters by it', async () => {
    const p = packs([meta({ id: 'A-1' }), meta({ id: 'H-1', kind: 'hard' })])
    const all = await run('get_rule_catalog', {}, { packs: p })
    expect((all.value as { rules: { id: string; kind: string }[] }).rules.map((r) => r.kind).sort()).toEqual(['ai', 'hard'])
    const ai = await run('get_rule_catalog', { kind: 'ai' }, { packs: p })
    expect((ai.value as { rules: { id: string }[] }).rules.map((r) => r.id)).toEqual(['A-1'])
  })
})

describe('manual finding writes', () => {
  it('add_manual_finding on the camp, an activity and a document', async () => {
    const camp = await run('add_manual_finding', { ...CAMP_ARG, category: 'positive', comment: 'Super, Leiter A!' })
    expect(camp.state.manualFindings[0]).toMatchObject({ scope: 'camp', category: 'positive', comment: `Super, ${NAME}!` })
    expect(camp.state.manualFindings[0].id).toBe('manual:new-1')

    const act = await run('add_manual_finding', { ...CAMP_ARG, category: 'safety', comment: 'x', activityId: 'a1' })
    expect(act.state.manualFindings[0]).toMatchObject({ scope: 'activity', activityIri: '/api/activities/a1' })

    const d = await run('add_manual_finding', { ...CAMP_ARG, category: 'documents', comment: 'x', documentId: 'd1', page: 3 }, { documents: [doc()] })
    expect(d.state.manualFindings[0]).toMatchObject({ scope: 'document', documentId: 'd1', anchor: { page: 3 } })
  })

  it('add_manual_finding validates', async () => {
    await expect(run('add_manual_finding', { ...CAMP_ARG, category: 'safety', comment: 'x', activityId: 'nope' })).rejects.toThrow('gehört nicht')
    await expect(run('add_manual_finding', { ...CAMP_ARG, category: 'safety', comment: 'x', documentId: 'zzz' })).rejects.toThrow('gehört nicht')
    await expect(run('add_manual_finding', { ...CAMP_ARG, category: 'safety', comment: 'x', page: 2 })).rejects.toThrow('documentId')
    await expect(run('add_manual_finding', { ...CAMP_ARG, category: 'bogus', comment: 'x' })).rejects.toThrow('Kategorie')
    await expect(run('add_manual_finding', { ...CAMP_ARG, category: 'safety', comment: 'Quelle: MiData' })).rejects.toThrow('MiData')
    await expect(run('add_manual_finding', { ...CAMP_ARG, category: 'safety', comment: 'x'.repeat(1001) })).rejects.toThrow('länger')
    await expect(run('add_manual_finding', { ...CAMP_ARG, category: 'safety', comment: 'x', documentId: 'd2' }, { documents: [doc({ id: 'd2', zone: 'red' })] })).rejects.toThrow('gehört nicht')
  })

  it('update and delete', async () => {
    const upd = await run('update_manual_finding', { findingId: 'manual:m1', comment: 'Neu, Leiter A', category: 'program' }, { manualFindings: [manual()] })
    expect(upd.state.manualFindings[0]).toMatchObject({ category: 'program', comment: `Neu, ${NAME}` })
    await expect(run('update_manual_finding', { findingId: 'manual:m1' }, { manualFindings: [manual()] })).rejects.toThrow('Nichts zu ändern')
    await expect(run('update_manual_finding', { findingId: 'f1' }, { manualFindings: [manual()] })).rejects.toThrow('Ungültige')
    await expect(run('update_manual_finding', { findingId: 'manual:zz', comment: 'x' })).rejects.toThrow('nicht gefunden')
    const del = await run('delete_manual_finding', { findingId: 'manual:m1' }, { manualFindings: [manual()] })
    expect(del.state.manualFindings).toEqual([])
  })

  it('confirm builders show de-redacted details', async () => {
    const { ctx } = makeFakeContext({ manualFindings: [manual()], documents: [doc()] })
    const add = await MCP_CONFIRM.add_manual_finding!({ ...CAMP_ARG, category: 'safety', comment: 'Danke Leiter A', documentId: 'd1', page: 2 }, ctx)
    expect(add.details.join('\n')).toContain(`Danke ${NAME}`)
    expect(add.details.join('\n')).toContain('S. 2')
    expect(add.kind).toBe('write')
    const upd = await MCP_CONFIRM.update_manual_finding!({ findingId: 'manual:m1', comment: 'neu' }, ctx)
    expect(upd.details[0]).toContain('Bisher')
    const del = await MCP_CONFIRM.delete_manual_finding!({ findingId: 'manual:m1' }, ctx)
    expect(del.summary).toContain('löschen')
  })

  it('writes are refused when the tool is off and need confirmation when on', async () => {
    const { ctx, state } = makeFakeContext()
    const settings = structuredClone(DEFAULT_APP_SETTINGS)
    settings.ai.enabled = true
    settings.mcp.enabled = true
    const call = { callId: '1', name: 'add_manual_finding', kind: 'write' as const, arguments: { ...CAMP_ARG, category: 'safety', comment: 'x' } }
    expect((await dispatchToolCall(call, ctx, settings)).isError).toBe(true)
    settings.mcp.tools.add_manual_finding = true
    state.confirmAnswer = false
    expect((await dispatchToolCall(call, ctx, settings)).isError).toBe(true)
    expect(state.manualFindings).toEqual([])
    state.confirmAnswer = true
    expect((await dispatchToolCall(call, ctx, settings)).isError).toBe(false)
    expect(state.manualFindings).toHaveLength(1)
  })
})

describe('feedback links', () => {
  it('add_feedback accepts document, general point and manual finding of the camp', async () => {
    const r = await run(
      'add_feedback',
      { ...CAMP_ARG, kind: 'suggestion', text: 'x', documentId: 'd1', generalPointId: 'siko', manualFindingId: 'manual:m1' },
      { documents: [doc()], manualFindings: [manual()] },
    )
    expect(r.state.feedback[0]).toMatchObject({ documentId: 'd1', generalPointId: 'siko', manualFindingId: 'manual:m1', findingId: 'manual:m1' })
  })

  it('add_feedback rejects foreign or unknown links', async () => {
    const base = { ...CAMP_ARG, kind: 'suggestion', text: 'x' }
    await expect(run('add_feedback', { ...base, documentId: 'zz' })).rejects.toThrow('gehört nicht')
    await expect(run('add_feedback', { ...base, generalPointId: 'nope' })).rejects.toThrow('Unbekannter')
    await expect(run('add_feedback', { ...base, manualFindingId: 'manual:m1' }, { manualFindings: [manual({ campIri: '/api/camps/other' })] })).rejects.toThrow('gehört nicht')
  })

  it('update_feedback can set links on its own', async () => {
    const r = await run('update_feedback', { feedbackId: 'f1', generalPointId: 'psa' }, { feedback: [makeFeedback()] })
    expect(r.state.feedback[0].generalPointId).toBe('psa')
    await expect(run('update_feedback', { feedbackId: 'f1', documentId: 'zz' }, { feedback: [makeFeedback()] })).rejects.toThrow('gehört nicht')
  })
})
