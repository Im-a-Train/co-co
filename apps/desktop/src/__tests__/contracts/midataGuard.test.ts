/**
 * Guard (M7, red zone): AI-related code must never touch MiData data or commands.
 * Test files (__tests__) are exempt.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../../', import.meta.url))
/** Imports of domain/midata (any relative depth or alias), midata tauri commands or aggregate marker. */
const PATTERN =
  /(from|import\()\s*['"`][^'"`]*(domain\/midata|\.\/midata|\.\.\/midata|composables\/useMidata|components\/midata)[^'"`]*['"`]|midata_[a-z_]+|commands\.midata|onMidataStatus|red-derived/

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : walk(p)
    return /\.(ts|vue|js)$/.test(name) ? [p] : []
  })
}

const rel = (p: string) => relative(SRC, p).split(sep).join('/')

describe('MiData guard', () => {
  const aiFiles = [
    ...walk(join(SRC, 'domain/zones')),
    ...walk(join(SRC, 'components/ai')),
    join(SRC, 'composables/useAi.ts'),
    join(SRC, 'lib/tauriAi.ts'),
  ]

  it('finds the AI files it guards', () => {
    expect(aiFiles.map(rel)).toContain('domain/zones/aiGateway.ts')
  })

  it('AI code does not import MiData modules or use MiData commands', () => {
    const offenders = aiFiles
      .filter((p) => {
        try {
          return statSync(p).isFile()
        } catch {
          return false
        }
      })
      // zones/types may legitimately name the 'red-derived' tag in the defensive gateway check
      .filter((p) => rel(p) !== 'domain/zones/aiGateway.ts')
      .filter((p) => PATTERN.test(readFileSync(p, 'utf-8')))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('aiGateway itself neither imports MiData nor calls its commands', () => {
    const text = readFileSync(join(SRC, 'domain/zones/aiGateway.ts'), 'utf-8')
    expect(/from\s*['"][^'"]*midata[^'"]*['"]|commands\.midata|midata_/.test(text)).toBe(false)
  })

  it('lib/tauriAi.ts is only imported by the gateway', () => {
    const offenders = walk(SRC)
      .map(rel)
      .filter((r) => r !== 'domain/zones/aiGateway.ts' && r !== 'lib/tauriAi.ts')
      .filter((r) => /from\s*['"`][^'"`]*tauriAi['"`]/.test(readFileSync(join(SRC, r), 'utf-8')))
    expect(offenders).toEqual([])
  })
})
