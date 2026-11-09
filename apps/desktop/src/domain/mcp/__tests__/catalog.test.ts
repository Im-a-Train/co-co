import { describe, expect, it } from 'vitest'
import { messages } from '@/locales/messages'
import { DEFAULT_APP_SETTINGS } from '@/domain/types'
import { MCP_TOOLS, MCP_TOOL_NAMES, defaultToolEnabled, isToolEnabled, mcpToolByName, mcpToolRegistrations } from '../catalog'

function lookup(path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), (messages as { de: unknown }).de)
}

describe('MCP catalogue', () => {
  it('has unique tool names and object schemas', () => {
    expect(new Set(MCP_TOOL_NAMES).size).toBe(MCP_TOOLS.length)
    for (const t of MCP_TOOLS) {
      expect(t.inputSchema.type).toBe('object')
      expect(t.inputSchema.additionalProperties).toBe(false)
      for (const req of t.inputSchema.required ?? []) expect(t.inputSchema.properties).toHaveProperty(req)
      expect(t.description.length).toBeGreaterThan(20)
    }
  })

  it('defaults: read tools on, write tools off', () => {
    const reads = MCP_TOOLS.filter((t) => t.kind === 'read')
    const writes = MCP_TOOLS.filter((t) => t.kind === 'write')
    expect(reads).toHaveLength(12)
    expect(writes).toHaveLength(7)
    for (const t of reads) expect(defaultToolEnabled(t)).toBe(true)
    for (const t of writes) expect(defaultToolEnabled(t)).toBe(false)
    expect(DEFAULT_APP_SETTINGS.mcp.enabled).toBe(false)
  })

  it('registers only enabled tools', () => {
    const regs = mcpToolRegistrations({})
    expect(regs.map((r) => r.name).sort()).toEqual(MCP_TOOLS.filter((t) => t.kind === 'read').map((t) => t.name).sort())
    const withWrite = mcpToolRegistrations({ add_feedback: true, list_camps: false })
    expect(withWrite.map((r) => r.name)).toContain('add_feedback')
    expect(withWrite.map((r) => r.name)).not.toContain('list_camps')
    expect(isToolEnabled(mcpToolByName('list_camps')!, { list_camps: false })).toBe(false)
  })

  it('has German texts for every tool', () => {
    for (const t of MCP_TOOLS) {
      expect(typeof lookup(t.titleKey), t.titleKey).toBe('string')
      expect(typeof lookup(t.descriptionKey), t.descriptionKey).toBe('string')
    }
  })
})
