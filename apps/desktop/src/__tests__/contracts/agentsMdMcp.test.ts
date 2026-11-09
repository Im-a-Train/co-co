/**
 * Contract: AGENTS.md carries a table of ALL MCP tools (name, read/write, purpose, zone notes).
 * Every change to domain/mcp/catalog.ts must update that table in the same change.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MCP_TOOLS } from '@/domain/mcp/catalog'

const AGENTS_MD = fileURLToPath(new URL('../../../../../AGENTS.md', import.meta.url))
const text = readFileSync(AGENTS_MD, 'utf-8')
const section = text.includes('## MCP tools') ? text.slice(text.indexOf('## MCP tools')) : ''
const rows = section.split(/\r?\n/).filter((l) => l.startsWith('| `'))

describe('AGENTS.md MCP tool table', () => {
  it('has an "MCP tools" section with the maintenance rule', () => {
    expect(section).not.toBe('')
    expect(section).toContain('Every change to `domain/mcp/catalog.ts`')
  })

  it('lists every tool of MCP_TOOLS with the right kind', () => {
    for (const t of MCP_TOOLS) {
      const row = rows.find((r) => r.startsWith(`| \`${t.name}\` |`))
      expect(row, `AGENTS.md table is missing the MCP tool ${t.name}`).toBeDefined()
      expect(row!.split('|')[2].trim(), `kind of ${t.name}`).toBe(t.kind)
    }
  })

  it('lists no tool that is not in the catalogue', () => {
    const names = new Set<string>(MCP_TOOLS.map((t) => t.name))
    for (const r of rows) {
      const name = r.split('|')[1].trim().replace(/`/g, '')
      expect(names.has(name), `AGENTS.md lists unknown MCP tool ${name}`).toBe(true)
    }
  })
})
