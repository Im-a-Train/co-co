/**
 * Guard (M8, red zone): AI-related code must never touch NDS data or commands.
 * Test files (__tests__) are exempt.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../../', import.meta.url))
/** Imports of domain/nds (any relative depth or alias), nds tauri commands or aggregate marker. */
const PATTERN =
  /(from|import\()\s*['"`][^'"`]*(domain\/nds|\.\/nds|\.\.\/nds|composables\/useNds|composables\/ndsSignal|components\/nds)[^'"`]*['"`]|nds_[a-z_]+|commands\.nds|onNdsStatus|Quelle:\s*NDS|red-derived/

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : walk(p)
    return /\.(ts|vue|js)$/.test(name) ? [p] : []
  })
}

const rel = (p: string) => relative(SRC, p).split(sep).join('/')

describe('NDS guard', () => {
  const aiFiles = [
    ...walk(join(SRC, 'domain/zones')),
    ...walk(join(SRC, 'components/ai')),
    join(SRC, 'composables/useAi.ts'),
    join(SRC, 'lib/tauriAi.ts'),
  ]

  it('finds the AI files it guards', () => {
    expect(aiFiles.map(rel)).toContain('domain/zones/aiGateway.ts')
  })

  it('AI code does not import NDS modules or use NDS commands', () => {
    const offenders = aiFiles
      .filter((p) => {
        try {
          return statSync(p).isFile()
        } catch {
          return false
        }
      })
      // the gateway and the feedback feature name the red-derived tag / «Quelle: NDS» marker defensively
      .filter((p) => !['domain/zones/aiGateway.ts', 'domain/zones/features.ts'].includes(rel(p)))
      .filter((p) => PATTERN.test(readFileSync(p, 'utf-8')))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('aiGateway itself neither imports NDS nor calls its commands', () => {
    const text = readFileSync(join(SRC, 'domain/zones/aiGateway.ts'), 'utf-8')
    expect(/from\s*['"][^'"]*\/nds[^'"]*['"]|commands\.nds|nds_[a-z]/.test(text)).toBe(false)
  })

  it('the gateway refuses NDS source marker text', () => {
    const text = readFileSync(join(SRC, 'domain/zones/aiGateway.ts'), 'utf-8')
    expect(text.includes('(MiData|NDS)')).toBe(true)
  })
})
