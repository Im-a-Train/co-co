import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import de from '@/locales/de/camps.json'
import { messages } from '@/locales/messages'

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) {
      if (e === '__tests__' || e === 'locales' || e === 'node_modules') continue
      walk(p, out)
    } else if (/\.(vue|ts)$/.test(e)) out.push(p)
  }
  return out
}

function has(key: string): boolean {
  let cur: unknown = messages.de
  for (const part of key.split('.')) {
    if (typeof cur !== 'object' || cur === null || !(part in cur)) return false
    cur = (cur as Record<string, unknown>)[part]
  }
  return true
}

describe('i18n keys', () => {
  it('camps.json nests everything under "camps"', () => {
    expect(Object.keys(de)).toEqual(['camps'])
  })

  it('every literal t(...) key used in source exists in the de locale', () => {
    const missing: string[] = []
    const re = /(?:\$t|\bt|\.t)\(\s*'([a-zA-Z]+(?:\.[a-zA-Z0-9_]+)+)'/g
    for (const file of walk(join(process.cwd(), 'src'))) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(re)) if (!has(m[1])) missing.push(`${file.split('src')[1]}: ${m[1]}`)
    }
    expect(missing).toEqual([])
  })
})
