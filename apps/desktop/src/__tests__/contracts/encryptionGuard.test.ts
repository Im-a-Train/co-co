/**
 * Guard (ADR 0010): every table is covered by the encryption middleware, Dexie is only used where allowed,
 * and localStorage holds nothing but the boot/UI keys. Test files (__tests__) are exempt.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CocoDb, TABLE_NAMES } from '@/domain/storage/db'
import { TABLE_ENCRYPTION } from '@/domain/storage/encryptionConfig'

const SRC = fileURLToPath(new URL('../../', import.meta.url))

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : walk(p)
    return /\.(ts|vue|js)$/.test(name) ? [p] : []
  })
}
const files = walk(SRC).map((p) => ({ rel: relative(SRC, p).split(sep).join('/'), code: readFileSync(p, 'utf-8') }))

/** Files besides domain/storage that may import `dexie` (only for liveQuery, never for opening a database). */
const DEXIE_ALLOWED = new Set(['composables/useFindings.ts', 'composables/useRuleState.ts', 'composables/useCampRuleConfig.ts'])

/** localStorage keys (boot data + UI toggles); everything else must live in the encrypted store. */
const LOCAL_STORAGE_KEYS = [/^coco\.instances\.v1$/, /^coco\.selectedInstance\.v1$/, /^co-co\.camps\.phaseFilter$/, /^co-co\.deadlines\./, /^co-co\.gpxMap\.v3$/]

describe('encryption guard', () => {
  it('every table has an encryption config with an allowlist containing its primary key', () => {
    const db = new CocoDb('guard-test')
    for (const name of TABLE_NAMES) {
      const cfg = TABLE_ENCRYPTION[name]
      expect(cfg, name).toBeDefined()
      const table = db.table(name)
      const pk = table.schema.primKey.keyPath
      for (const f of Array.isArray(pk) ? pk : pk ? [pk] : []) expect(cfg.plain, name).toContain(f)
      // every plaintext index (single or compound) is allowlisted
      for (const idx of table.schema.indexes) for (const f of Array.isArray(idx.keyPath) ? idx.keyPath : [idx.keyPath]) expect(cfg.plain, `${name}.${idx.name}`).toContain(f)
    }
    expect(Object.keys(TABLE_ENCRYPTION).sort()).toEqual([...TABLE_NAMES].sort())
  })

  it('dexie is imported only in domain/storage and the allowed composables', () => {
    const offenders = files
      .filter((f) => !f.rel.startsWith('domain/storage/') && !DEXIE_ALLOWED.has(f.rel))
      .filter((f) => /(from|import\()\s*['"`]dexie['"`]/.test(f.code))
      .map((f) => f.rel)
    expect(offenders).toEqual([])
  })

  it('only the allowed files open Dexie databases or use the raw IndexedDB / legacy db', () => {
    const offenders = files
      .filter((f) => !f.rel.startsWith('domain/storage/'))
      .filter((f) => /\bindexedDB\b|new\s+(CocoDb|LegacyCocoDb|Dexie)\b|legacyDb/.test(f.code))
      .map((f) => f.rel)
    expect(offenders).toEqual([])
  })

  it('localStorage keys come from the allowlist', () => {
    const keys: string[] = []
    for (const f of files) {
      if (!/localStorage/.test(f.code)) continue
      // resolve `const X_KEY = '...'` constants, then every key argument of get/set/removeItem
      const consts = new Map([...f.code.matchAll(/const\s+(\w+)\s*=\s*['"`]([^'"`]+)['"`]/g)].map((m) => [m[1], m[2]]))
      for (const m of f.code.matchAll(/(?:getItem|setItem|removeItem)\(\s*([^,)]+)/g)) {
        const arg = m[1].trim()
        if (/^\w+\s*:/.test(arg)) continue // interface declaration, not a call
        const lit = /^['"`](.*)['"`]$/.exec(arg)
        const resolved = lit ? lit[1] : consts.get(arg)
        keys.push(`${f.rel}: ${resolved ?? 'UNRESOLVED ' + arg}`)
      }
    }
    const bad = keys.filter((k) => {
      const key = k.slice(k.indexOf(': ') + 2)
      return !LOCAL_STORAGE_KEYS.some((re) => re.test(key))
    })
    expect(bad).toEqual([])
  })
})
