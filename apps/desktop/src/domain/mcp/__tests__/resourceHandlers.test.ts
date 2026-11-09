import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResourceRecord, Rule, RuleMeta, RulePack } from '../../types'

const hits = vi.hoisted(() => ({ list: [] as unknown[] }))
vi.mock('../../resources', () => ({
  searchResources: vi.fn((_records: unknown, _query: string, opts?: { limit?: number }) => (hits.list as unknown[]).slice(0, opts?.limit ?? 8)),
}))

import { searchResources } from '../../resources'
import { dispatchToolCall } from '../dispatch'
import { MCP_CONFIRM, MCP_HANDLERS } from '../handlers'
import { RESOURCE_PAGE_MAX } from '../resourceHandlers'
import { McpToolError } from '../types'
import { DEFAULT_APP_SETTINGS } from '../../types'
import { makeFakeContext } from './fakeContext'

function resource(over: Partial<ResourceRecord> = {}): ResourceRecord {
  return {
    key: 'LEITFADEN', title: 'Leitfaden', edition: '2027', url: 'https://www.jugendundsport.ch/x', weight: 'binding',
    pageConvention: 'printed', partlyRead: [], origin: 'bundled', modified: false,
    updatedAt: '2031-01-01T00:00:00.000Z', updatedBy: 'manual', ...over,
  }
}

function meta(over: Partial<RuleMeta> = {}): RuleMeta {
  return {
    id: 'JS-X-01', version: '1', module: 'js', group: 'js', status: 'active', kind: 'hard', title: 'T', description: 'D', message: 'M',
    severity: 'should', confidence: 'unverified', scope: 'camp', sources: [{ key: 'LEITFADEN', page: 'S. 5' }],
    source: { title: 'S', url: 'https://x.test' }, ...over,
  }
}
const packs = (): RulePack[] => [{ id: 'basis', name: 'B', version: '1', description: '', rules: [{ meta: meta(), check: () => [] } as Rule] }]

async function run(name: keyof typeof MCP_HANDLERS, args: Record<string, unknown>, over?: Parameters<typeof makeFakeContext>[0]) {
  const fake = makeFakeContext(over)
  return { ...fake, value: (await MCP_HANDLERS[name](args, fake.ctx)) as Record<string, unknown> & unknown[] }
}

const settingsWith = (tools: Record<string, boolean> = {}) => ({
  ...DEFAULT_APP_SETTINGS,
  ai: { ...DEFAULT_APP_SETTINGS.ai, enabled: true },
  mcp: { ...DEFAULT_APP_SETTINGS.mcp, enabled: true, confirmWrites: false, tools },
})

beforeEach(() => {
  hits.list = []
})

describe('resource read tools', () => {
  it('list_resources shows metadata, content length and citing rules (no content)', async () => {
    const { value } = await run('list_resources', {}, { resources: [resource({ content: 'abc def' }), resource({ key: 'ANDERE', modified: true })], packs: packs() })
    expect(value).toHaveLength(2)
    expect(value[0]).toMatchObject({ key: 'LEITFADEN', hasContent: true, contentLength: 7, citedByRules: ['JS-X-01'], origin: 'bundled' })
    expect(value[0]).not.toHaveProperty('content')
    expect(value[1]).toMatchObject({ key: 'ANDERE', hasContent: false, modified: true, citedByRules: [] })
  })

  it('search_resources passes limit and scrubs contact data in snippets', async () => {
    hits.list = [{ key: 'LEITFADEN', title: 'Leitfaden', url: null, snippet: 'Kontakt info@jugendundsport.ch oder 031 123 45 67', score: 3, in: 'content' }]
    const { value } = await run('search_resources', { query: 'Sicherheit', limit: 5 }, { resources: [resource()] })
    const json = JSON.stringify(value)
    expect(searchResources).toHaveBeenCalledWith(expect.anything(), 'Sicherheit', { limit: 5 })
    expect(value[0]).toMatchObject({ key: 'LEITFADEN', matchedIn: 'content' })
    expect(json).not.toContain('@')
    expect(json).not.toContain('031 123')
  })

  it('get_resource pages the content', async () => {
    const content = 'x '.repeat(15_000) // 30'000 chars
    const resources = [resource({ content })]
    const first = (await run('get_resource', { key: 'LEITFADEN' }, { resources })).value
    expect((first.content as string).length).toBe(RESOURCE_PAGE_MAX)
    expect(first).toMatchObject({ totalLength: 30_000, offset: 0, nextOffset: RESOURCE_PAGE_MAX })
    const second = (await run('get_resource', { key: 'LEITFADEN', offset: RESOURCE_PAGE_MAX, length: 50_000 }, { resources })).value
    expect((second.content as string).length).toBe(10_000)
    expect(second.nextOffset).toBeNull()
    await expect(run('get_resource', { key: 'NOPE' })).rejects.toThrow(McpToolError)
  })

  it('dispatcher does not refuse resource text with contact lines', async () => {
    const fake = makeFakeContext({ resources: [resource({ content: 'Fragen an info@jugendundsport.ch, Tel. 058 463 33 33. Hex abcdef0123456789.' })] })
    const out = await dispatchToolCall({ callId: '1', name: 'get_resource', kind: 'read', arguments: { key: 'LEITFADEN' } }, fake.ctx, settingsWith())
    expect(out.isError).toBe(false)
  })
})

describe('update_resource', () => {
  it('updates via the context (origin mcp is set by the bridge) and reports the changed fields', async () => {
    const { value, ctx } = await run('update_resource', { key: 'LEITFADEN', content: 'neuer Text', edition: '2028' }, { resources: [resource()] })
    expect(ctx.updateResource).toHaveBeenCalledWith('LEITFADEN', { edition: '2028', content: 'neuer Text' })
    expect(value).toMatchObject({ key: 'LEITFADEN', hasContent: true, modified: true, updatedBy: 'mcp', changed: ['edition', 'content'] })
  })

  it('refuses empty patches, unknown keys and store errors', async () => {
    await expect(run('update_resource', { key: 'LEITFADEN' }, { resources: [resource()] })).rejects.toThrow('Keine Änderung')
    await expect(run('update_resource', { key: 'X', title: 'a' })).rejects.toThrow('nicht gefunden')
    const fake = makeFakeContext({ resources: [resource()] })
    fake.ctx.updateResource = vi.fn(async () => {
      throw new Error('Ungültige URL.')
    })
    await expect(MCP_HANDLERS.update_resource({ key: 'LEITFADEN', url: 'ftp://x' }, fake.ctx)).rejects.toThrow('Ungültige URL.')
  })

  it('confirmation shows old and new values', async () => {
    const fake = makeFakeContext({ resources: [resource({ content: 'alt' })] })
    const req = await MCP_CONFIRM.update_resource!({ key: 'LEITFADEN', edition: '2028', content: 'neu!' }, fake.ctx)
    expect(req.details).toContain('edition: 2027 -> 2028')
    expect(req.details.join('\n')).toContain('3 -> 4 Zeichen')
  })
})

describe('update_rule', () => {
  it('saves with the reason, merges earlier edits and returns the effective rule', async () => {
    const edit = { ruleId: 'JS-X-01', baseVersion: '1', patch: { title: 'Alt-Titel' }, updatedAt: '', updatedBy: 'manual' as const }
    const { value, ctx } = await run(
      'update_rule',
      { ruleId: 'JS-X-01', reason: 'Manual 2027 S. 21', message: 'Neu', validTo: '', resourceKeys: ['LEITFADEN'] },
      { packs: packs(), ruleEdits: [edit] },
    )
    expect(ctx.saveRuleEdit).toHaveBeenCalledWith('JS-X-01', { title: 'Alt-Titel', message: 'Neu', validTo: null }, { reason: 'Manual 2027 S. 21', resourceKeys: ['LEITFADEN'] })
    expect(value).toMatchObject({ saved: true, rule: { id: 'JS-X-01', message: 'Neu', edited: true, updatedBy: 'mcp', editReason: 'Manual 2027 S. 21' } })
  })

  it('returns store policy errors as tool errors', async () => {
    const fake = makeFakeContext({ packs: packs() })
    fake.ctx.saveRuleEdit = vi.fn(async () => {
      throw new Error('Per MCP kann «Muss» nicht gesetzt werden.')
    })
    await expect(MCP_HANDLERS.update_rule({ ruleId: 'JS-X-01', reason: 'r', title: 'x' }, fake.ctx)).rejects.toThrow('«Muss»')
  })

  it('validates input', async () => {
    await expect(run('update_rule', { ruleId: 'NOPE', reason: 'r', title: 'x' }, { packs: packs() })).rejects.toThrow('nicht gefunden')
    await expect(run('update_rule', { ruleId: 'JS-X-01', reason: 'r' }, { packs: packs() })).rejects.toThrow('Keine Änderung')
    await expect(run('update_rule', { ruleId: 'JS-X-01', reason: 'r', sources: [{ page: 'x' }] }, { packs: packs() })).rejects.toThrow('key')
  })

  it('schema rejects severity must before the handler runs', async () => {
    const fake = makeFakeContext({ packs: packs() })
    const out = await dispatchToolCall(
      { callId: '1', name: 'update_rule', kind: 'write', arguments: { ruleId: 'JS-X-01', reason: 'r', severity: 'must' } },
      fake.ctx,
      settingsWith({ update_rule: true }),
    )
    expect(out.isError).toBe(true)
    expect(fake.ctx.saveRuleEdit).not.toHaveBeenCalled()
  })

  it('get_rule_catalog marks edited rules', async () => {
    const edit = { ruleId: 'JS-X-01', baseVersion: '1', patch: {}, updatedAt: '', updatedBy: 'mcp' as const }
    const { value } = await run('get_rule_catalog', {}, { packs: packs(), ruleEdits: [edit] })
    expect((value as unknown as { rules: unknown[] }).rules[0]).toMatchObject({ id: 'JS-X-01', edited: true, updatedBy: 'mcp' })
  })
})
