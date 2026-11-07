/**
 * Guard (ADR 0005): only src/domain/zones/aiGateway.ts may use the AI command wrapper.
 * FROZEN (architect). Test files (__tests__) are exempt so the gateway can be tested with mocks.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../../', import.meta.url))
const ALLOWED = new Set(['lib/tauriAi.ts', 'domain/zones/aiGateway.ts'])
/** Static/dynamic imports of lib/tauriAi, or invoking the raw command name. */
const PATTERN = /(from|import\()\s*['"`][^'"`]*tauriAi(\.ts)?['"`]|['"`]ai_complete['"`]/

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : walk(p)
    return /\.(ts|vue|js)$/.test(name) ? [p] : []
  })
}

describe('AI guard', () => {
  it('only aiGateway.ts references the AI command wrapper', () => {
    const offenders = walk(SRC)
      .map((p) => relative(SRC, p).split(sep).join('/'))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => PATTERN.test(readFileSync(join(SRC, rel), 'utf-8')))
    expect(offenders).toEqual([])
  })

  it('the gateway file exists', () => {
    expect(statSync(join(SRC, 'domain/zones/aiGateway.ts')).isFile()).toBe(true)
  })
})
