import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyRuleEdits, applyRulePatch, diffPatch, mergePatches, validateRuleEditPatch } from '../edits'
import { cachedRuleEdits, knownSourceKeys, listRuleEdits, loadEffectivePacks, reloadRuleEdits, resetRuleEdit, saveRuleEdit, skippedRuleEdits } from '../editsStore'
import { evaluate } from '../engine'
import { loadBundledPacks } from '../packs'
import { getDb, lockDb, resetLocalData } from '../../storage/db'
import { unlockTestDb } from '../../storage/__tests__/testKey'
import type { Rule, RuleEditRecord, RuleMeta, RulePack } from '@/domain/types'
import { FactsBuilder, makeCtx } from './factory'

const known = knownSourceKeys()
const allRules = (): Rule[] => loadBundledPacks().flatMap((p) => p.rules)
const rule = (id: string) => allRules().find((r) => r.meta.id === id)!
const must = allRules().find((r) => r.meta.severity === 'must' && r.meta.confidence === 'verified' && r.meta.messageVariants)!.meta
const firstKey = [...known][0]!

describe('validateRuleEditPatch', () => {
  it('accepts a harmless manual edit', () => {
    expect(validateRuleEditPatch(must, { title: 'Neuer Titel', tags: ['x'] }, 'manual', known)).toEqual([])
  })
  it('rejects empty texts, unknown fields, bad dates and ranges', () => {
    expect(validateRuleEditPatch(must, { title: ' ' }, 'manual', known)[0]).toMatch(/Titel/)
    expect(validateRuleEditPatch(must, { scope: 'camp' } as never, 'manual', known)[0]).toMatch(/scope/)
    expect(validateRuleEditPatch(must, { validFrom: '1.1.2026' }, 'manual', known)[0]).toMatch(/Datum/)
    expect(validateRuleEditPatch(must, { validFrom: '2030-01-01', validTo: '2029-01-01' }, 'manual', known).join()).toMatch(/liegt nach/)
  })
  it('requires known sources, at least one', () => {
    expect(validateRuleEditPatch(must, { sources: [{ key: 'NOPE', page: '' }] }, 'manual', known)[0]).toMatch(/NOPE/)
    expect(validateRuleEditPatch(must, { sources: [] }, 'manual', known)[0]).toMatch(/Quelle/)
    expect(validateRuleEditPatch(must, { sources: [{ key: firstKey, page: 'S. 1' }] }, 'manual', known)).toEqual([])
  })
  it('only existing message variants and known placeholders', () => {
    expect(validateRuleEditPatch(must, { messageVariants: { gibtEsNicht: 'x' } }, 'manual', known)[0]).toMatch(/gibt es in dieser Regel nicht/)
    expect(validateRuleEditPatch(must, { message: 'Hallo {unbekannt}' }, 'manual', known)[0]).toMatch(/Platzhalter/)
  })
  it('must needs verified (effective)', () => {
    expect(validateRuleEditPatch(must, { confidence: 'unverified' }, 'manual', known).join()).toMatch(/verlangt/)
    expect(validateRuleEditPatch(must, { severity: 'should', confidence: 'unverified' }, 'manual', known)).toEqual([])
  })
  it('ai and mcp may not set must or verified', () => {
    const should = allRules().find((r) => r.meta.severity === 'should')!.meta
    for (const origin of ['ai', 'mcp'] as const) {
      expect(validateRuleEditPatch(should, { severity: 'must' }, origin, known).join()).toMatch(/nicht auf «muss»/)
      expect(validateRuleEditPatch(should, { confidence: 'verified' }, origin, known).join()).toMatch(/nicht auf «geprüft»/)
      expect(validateRuleEditPatch(should, { title: 'ok' }, origin, known)).toEqual([])
    }
    expect(validateRuleEditPatch({ ...should, confidence: 'verified' }, { severity: 'must' }, 'manual', known)).toEqual([])
  })
})

describe('applyRulePatch / diffPatch / mergePatches', () => {
  it('applies fields, removes bounds with null, merges variants, derives source', () => {
    const m: RuleMeta = { ...must, validFrom: '2026-01-01' }
    const key = Object.keys(m.messageVariants!)[0]!
    const out = applyRulePatch(m, { title: 'T', validFrom: null, validTo: '2030-01-01', messageVariants: { [key]: 'Neu' }, sources: [{ key: firstKey, page: 'S. 2' }] })
    expect(out.title).toBe('T')
    expect(out.validFrom).toBeUndefined()
    expect(out.validTo).toBe('2030-01-01')
    expect(out.messageVariants![key]).toBe('Neu')
    expect(Object.keys(out.messageVariants!).length).toBe(Object.keys(m.messageVariants!).length)
    expect(out.sources[0]).toEqual({ key: firstKey, page: 'S. 2' })
    expect(out.id).toBe(m.id)
    expect(out.formerIds).toEqual(m.formerIds)
  })
  it('diffPatch keeps only differences', () => {
    expect(diffPatch({ ...must, validFrom: undefined, validTo: undefined }, { title: must.title, message: 'x', validFrom: null, tags: must.tags ?? [], sources: must.sources })).toEqual({ message: 'x' })
    expect(diffPatch(must, { validFrom: null, validTo: null })).toEqual(must.validFrom ? { validFrom: null } : {})
  })
  it('mergePatches merges variants per key', () => {
    expect(mergePatches({ messageVariants: { a: '1', b: '2' }, title: 'x' }, { messageVariants: { b: '3' } })).toEqual({ messageVariants: { a: '1', b: '3' }, title: 'x' })
  })
})

describe('applyRuleEdits', () => {
  const rec = (ruleId: string, patch: RuleEditRecord['patch'], updatedBy: RuleEditRecord['updatedBy'] = 'manual'): RuleEditRecord => ({ ruleId, baseVersion: '1', patch, updatedAt: 'x', updatedBy })
  it('applies valid edits, skips invalid ones, leaves the input untouched', () => {
    const packs = loadBundledPacks()
    const before = JSON.stringify(packs.map((p) => p.rules.map((r) => r.meta)))
    const ids = allRules().map((r) => r.meta.id)
    const { packs: out, errors } = applyRuleEdits(packs, [rec(ids[0]!, { title: 'Geändert' }), rec(ids[1]!, { severity: 'must' }, 'ai'), rec('GIBT-ES-01', { title: 'x' })], known)
    expect(out.flatMap((p) => p.rules).find((r) => r.meta.id === ids[0])!.meta.title).toBe('Geändert')
    expect(errors.map((e) => e.ruleId).sort()).toEqual([ids[1], 'GIBT-ES-01'].sort())
    expect(JSON.stringify(packs.map((p) => p.rules.map((r) => r.meta)))).toBe(before)
  })
  it('keeps predicate and formerIds; the engine still caps unverified rules', () => {
    const r = allRules().find((x) => x.meta.severity === 'should')!
    const packs: RulePack[] = [{ id: 'p', name: 'P', version: '1', description: '', rules: [{ meta: { ...r.meta, formerIds: ['OLD-RULE-01'] }, check: () => [{ targets: ['/api/camps/c1'] }] }] }]
    const { packs: out } = applyRuleEdits(packs, [rec(r.meta.id, { confidence: 'unverified', status: 'active' })], known)
    expect(out[0]!.rules[0]!.meta.formerIds).toEqual(['OLD-RULE-01'])
    expect(out[0]!.rules[0]!.check).toBe(packs[0]!.rules[0]!.check)
    const findings = evaluate(out, makeCtx(new FactsBuilder().facts))
    expect(findings.every((f) => f.severity !== 'must')).toBe(true)
  })
  it('retired status is applied', () => {
    const id = allRules()[0]!.meta.id
    const { packs } = applyRuleEdits(loadBundledPacks(), [rec(id, { status: 'retired' })], known)
    expect(packs.flatMap((p) => p.rules).find((r) => r.meta.id === id)!.meta.status).toBe('retired')
  })
})

describe('editsStore', () => {
  const OPTS = {}
  beforeEach(async () => {
    await resetLocalData(OPTS)
    await unlockTestDb(OPTS)
    await reloadRuleEdits()
  })
  afterEach(async () => {
    await lockDb()
  })
  const id = rule('JS-CAMP-01').meta.id

  it('saves minimal patches, applies them to the effective packs, resets', async () => {
    expect(loadEffectivePacks()).toBe(loadBundledPacks())
    const rec = await saveRuleEdit(id, { title: 'Neu', description: rule(id).meta.description }, { origin: 'manual', reason: 'Test' })
    expect(rec!.patch).toEqual({ title: 'Neu' })
    expect(rec!.baseVersion).toBe(rule(id).meta.version)
    expect(loadEffectivePacks().flatMap((p) => p.rules).find((r) => r.meta.id === id)!.meta.title).toBe('Neu')
    expect(rule(id).meta.title).not.toBe('Neu')
    await resetRuleEdit(id)
    expect(await listRuleEdits()).toEqual([])
    expect(loadEffectivePacks()).toBe(loadBundledPacks())
  })

  it('merges partial patches, keeps max 10 history entries, empty patch deletes', async () => {
    await saveRuleEdit(id, { title: 'A' }, { origin: 'manual' })
    await saveRuleEdit(id, { message: 'Das Lager dauert {days} Tage ({min}).' }, { origin: 'mcp', reason: 'Quelle' })
    const rec = (await listRuleEdits())[0]!
    expect(rec.patch.title).toBe('A')
    expect(rec.updatedBy).toBe('mcp')
    expect(rec.history![0]!.updatedBy).toBe('manual')
    for (let i = 0; i < 14; i++) await saveRuleEdit(id, { title: `T${i}` }, { origin: 'manual' })
    expect((await getDb().ruleEdits.get(id))!.history).toHaveLength(10)
    expect(cachedRuleEdits()).toHaveLength(1)
    const gone = await saveRuleEdit(id, { title: rule(id).meta.title, message: rule(id).meta.message }, { origin: 'manual' })
    expect(gone).toBeNull()
    expect(await listRuleEdits()).toEqual([])
  })

  it('throws German errors for policy violations and unknown rules', async () => {
    const should = allRules().find((r) => r.meta.severity === 'should')!.meta.id
    await expect(saveRuleEdit(should, { severity: 'must' }, { origin: 'ai' })).rejects.toThrow(/nicht auf «muss»/)
    await expect(saveRuleEdit('NOPE-01', { title: 'x' }, { origin: 'manual' })).rejects.toThrow(/gibt es nicht/)
    expect(await listRuleEdits()).toEqual([])
  })

  it('skips stored edits that no longer validate on reload', async () => {
    await getDb().ruleEdits.put({ ruleId: id, baseVersion: '1', patch: { sources: [{ key: 'GONE', page: '' }] }, updatedAt: 'x', updatedBy: 'manual' })
    await reloadRuleEdits()
    expect(skippedRuleEdits()[0]!.ruleId).toBe(id)
    expect(loadEffectivePacks().flatMap((p) => p.rules).find((r) => r.meta.id === id)!.meta.sources[0]!.key).not.toBe('GONE')
  })
})
