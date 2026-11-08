/**
 * Guard (ADR 0008): the Personen data (red zone) never reaches the AI, Dexie or backups.
 * Test files (__tests__) are exempt.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../../', import.meta.url))

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : walk(p)
    return /\.(ts|vue|js)$/.test(name) ? [p] : []
  })
}
const rel = (p: string) => relative(SRC, p).split(sep).join('/')
const read = (r: string) => readFileSync(join(SRC, r), 'utf-8')
const PERSONS_REF = /domain\/persons|\.\.\/persons|\.\/persons|usePersons|components\/persons|commands\.persons|persons_[a-z_]+|__red/

describe('Persons guard', () => {
  it('aiGateway and tauriAi do not reference domain/persons or persons commands', () => {
    for (const f of ['domain/zones/aiGateway.ts', 'lib/tauriAi.ts']) {
      // the gateway may name the `__red` brand in order to refuse it
      const code = read(f).replace(/__red/g, '')
      expect(code, f).not.toMatch(/domain\/persons|usePersons|commands\.persons|persons_[a-z_]+/)
    }
  })

  it('no Dexie table, schema or backup code references persons', () => {
    const offenders = [...walk(join(SRC, 'domain/storage')), ...walk(join(SRC, 'domain/backup'))]
      .map(rel)
      .filter((r) => PERSONS_REF.test(read(r)))
    expect(offenders).toEqual([])
  })

  it('persons code does not use Dexie or Web Storage', () => {
    const files = [
      ...walk(join(SRC, 'domain/persons')),
      ...walk(join(SRC, 'components/persons')),
      ...walk(join(SRC, 'views/persons')),
      join(SRC, 'composables/usePersons.ts'),
    ].filter(existsSync)
    const offenders = files
      .map(rel)
      .filter((r) => {
        const code = read(r).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
        return /storage\/db|getDb|localStorage|sessionStorage|indexedDB|dexie/i.test(code)
      })
    expect(offenders).toEqual([])
  })
})
