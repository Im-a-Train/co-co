/**
 * Guard (ADR 0012): the MCP code path must never touch red-zone (MiData/NDS) data or the AI command,
 * and domain/mcp stays framework/IO free (only composables/mcpBridge.ts may talk to Dexie/Tauri).
 * Test files (__tests__) are exempt. domain/mcp/sanitize.ts may name midataFields/ndsFields on purpose
 * (it strips them), so only the `.midata.` / `.nds.` table-access patterns are checked there.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MCP_TOOLS, defaultToolEnabled } from '@/domain/mcp/catalog'

const SRC = fileURLToPath(new URL('../../', import.meta.url))

const RED_IMPORT =
  /(from|import\()\s*['"`][^'"`]*(domain\/midata|domain\/nds|\.\/midata|\.\.\/midata|\.\/nds|\.\.\/nds|composables\/useMidata|composables\/useNds|composables\/midataSignal|composables\/ndsSignal|useMidata|useNds|midataSignal|ndsSignal|components\/midata|components\/nds)[^'"`]*['"`]/
const RED_NAMES = /midata_[a-z_]+|nds_[a-z_]+|commands\.midata|commands\.nds|getMidataRecord|getNdsRecord|\.midata\.|\.nds\./
const AI_IMPORT = /(from|import\()\s*['"`][^'"`]*tauriAi(\.ts)?['"`]|['"`]ai_complete['"`]/
const IO_IMPORT = /(from|import\()\s*['"`](dexie|[^'"`]*lib\/tauri(\.ts)?|[^'"`]*\.\.\/lib\/tauri|@\/lib\/tauri)['"`]/

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : walk(p)
    return /\.(ts|vue|js)$/.test(name) ? [p] : []
  })
}
const rel = (p: string) => relative(SRC, p).split(sep).join('/')
const read = (r: string) => readFileSync(join(SRC, r), 'utf-8')

const mcpDomain = walk(join(SRC, 'domain/mcp')).map(rel)
const guarded = [...mcpDomain, 'composables/mcpBridge.ts', 'domain/zones/mcpZone.ts']

describe('MCP guard', () => {
  it('finds the files it guards', () => {
    expect(mcpDomain).toEqual(expect.arrayContaining(['domain/mcp/catalog.ts', 'domain/mcp/handlers.ts', 'domain/mcp/dispatch.ts']))
    for (const r of guarded) expect(statSync(join(SRC, r)).isFile()).toBe(true)
  })

  it('MCP code does not import MiData/NDS modules or use their commands/tables', () => {
    const offenders = guarded.filter((r) => RED_IMPORT.test(read(r)) || (r !== 'domain/mcp/sanitize.ts' && /midataFields|ndsFields/.test(read(r))) || RED_NAMES.test(read(r)))
    expect(offenders).toEqual([])
  })

  it('MCP code never imports the AI command wrapper', () => {
    expect(guarded.filter((r) => AI_IMPORT.test(read(r)))).toEqual([])
  })

  it('domain/mcp stays free of Dexie and the Tauri wrapper', () => {
    expect(mcpDomain.filter((r) => IO_IMPORT.test(read(r)))).toEqual([])
  })

  it('write tools default off, read tools default on', () => {
    expect(MCP_TOOLS.some((t) => t.kind === 'write')).toBe(true)
    for (const t of MCP_TOOLS) expect(defaultToolEnabled(t)).toBe(t.kind === 'read')
  })
})
